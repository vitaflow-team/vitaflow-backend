/**
 * Integration tests for PRD `ai-meal-plan-generator` (task_01, backend).
 *
 * Runs the real MealPlansController/MealPlansService/MealPlanGenerationService/
 * MealPlanLlmService/repositories/guards and the app's global ValidationPipe
 * against an isolated database. Only the OpenAI client is replaced with a
 * mock (no automated test makes a real network call) — everything else runs
 * unmocked.
 *
 * Requires `TEST_DATABASE_URL` pointing at an isolated, migrated database.
 *
 * IT-006 (regression: the existing workout-conversation coverage passes
 * unchanged after the `ConversationStore<TState>` generalization) is the
 * existing `test/ai-workout-generator.e2e-spec.ts` suite, re-run as-is —
 * not duplicated here.
 */
import { AuthGuard } from '@/auth/auth.guard';
import { ConversationStore } from '@/common/conversation/conversationStore';
import { ProfessionalGuard } from '@/common/guards/professional.guard';
import { ProfessionalPremiumGuard } from '@/common/guards/professionalPremium.guard';
import { createValidationPipe } from '@/config/validationPipe';
import { PrismaService } from '@/database/prisma.service';
import { MealPlansController } from '@/meal-plans/mealPlans.controller';
import { MealPlanGenerationService } from '@/meal-plans/mealPlanGeneration.service';
import { MealPlanLlmService } from '@/meal-plans/mealPlanLlm.service';
import { MealPlansService } from '@/meal-plans/mealPlans.service';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { ClientNutritionProfileRepository } from '@/repositories/meal-plans/clientNutritionProfile.repository';
import { MealPlansRepository } from '@/repositories/meal-plans/mealPlans.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { OPENAI_CLIENT } from '@/workouts/openaiClient.provider';
import { INestApplication } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import {
  Client,
  ProductTier,
  ProductType,
  Users,
  Weekday,
} from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';

jest.setTimeout(60_000);

const RUN_TAG = `ai-meal-plan-${Date.now()}`;

function completion(content: unknown) {
  return { choices: [{ message: { content: JSON.stringify(content) } }] };
}

function isGenerationRequest(req: {
  response_format?: { json_schema?: { name?: string } };
}): boolean {
  return req.response_format?.json_schema?.name === 'meal_plan_generation';
}

function sevenDays() {
  return (Object.values(Weekday) as Weekday[]).map((weekday) => ({
    weekday,
    meals: [{ label: 'Almoço', text: 'Arroz, feijão e frango grelhado' }],
  }));
}

// Three canned conversation turns in order: ask goal, ask restrictions,
// signal done — shared by every test that needs to drive the LLM-driven
// phase of the intake.
function mockConversationThenGeneration(createMock: jest.Mock): void {
  let callCount = 0;
  createMock.mockImplementation((req: unknown) => {
    const typed = req as {
      response_format?: { json_schema?: { name?: string } };
    };
    if (isGenerationRequest(typed)) {
      return completion({ days: sevenDays() });
    }
    callCount += 1;
    if (callCount === 1) {
      return completion({
        answers: { goal: null, restrictions: null },
        field: 'goal',
        question: 'Qual é o objetivo?',
        done: false,
        reprompt: false,
      });
    }
    if (callCount === 2) {
      return completion({
        answers: { goal: 'Perda de peso', restrictions: null },
        field: 'restrictions',
        question: 'Tem restrições?',
        done: false,
        reprompt: false,
      });
    }
    return completion({
      answers: { goal: 'Perda de peso', restrictions: 'nenhuma' },
      field: null,
      question: '',
      done: true,
      reprompt: false,
    });
  });
}

describe('AI meal-plan generator integration', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let groupId: string;
  let premiumNutritionist: Users;
  let standardNutritionist: Users;
  let patient: Client;
  const openAiCreate = jest.fn();
  const jwtSecret = 'ai-meal-plan-generator-integration-jwt-secret';

  beforeAll(async () => {
    if (!process.env.TEST_DATABASE_URL) {
      throw new Error(
        'TEST_DATABASE_URL must point to an isolated migrated test database',
      );
    }
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    process.env.JWT_SECRET = jwtSecret;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: jwtSecret })],
      controllers: [MealPlansController],
      providers: [
        PrismaService,
        UserRepository,
        ClientsRepository,
        MealPlansRepository,
        MealPlansService,
        ClientNutritionProfileRepository,
        ConversationStore,
        MealPlanLlmService,
        MealPlanGenerationService,
        ProfessionalGuard,
        ProfessionalPremiumGuard,
        AuthGuard,
        {
          provide: OPENAI_CLIENT,
          useValue: { chat: { completions: { create: openAiCreate } } },
        },
      ],
    }).compile();
    moduleFixture.useLogger(false);

    app = moduleFixture.createNestApplication<App>();
    app.useGlobalPipes(createValidationPipe());
    await app.init();
    prisma = moduleFixture.get(PrismaService);
    jwtService = moduleFixture.get(JwtService);

    await seed();
  });

  afterEach(() => {
    openAiCreate.mockReset();
  });

  afterAll(async () => {
    const ids = [premiumNutritionist.id, standardNutritionist.id];
    await prisma.clientNutritionProfile.deleteMany({
      where: { client: { professionalId: { in: ids } } },
    });
    await prisma.client.deleteMany({ where: { professionalId: { in: ids } } });
    await prisma.users.deleteMany({ where: { id: { in: ids } } });
    await prisma.product.deleteMany({ where: { groupId } });
    await prisma.productGroup.deleteMany({ where: { id: groupId } });
    await prisma.$disconnect();
    await app.close();
  });

  async function seed(): Promise<void> {
    const group = await prisma.productGroup.create({
      data: {
        name: `${RUN_TAG} group`,
        products: {
          create: [
            {
              name: `${RUN_TAG} premium nutri`,
              price: 59.9,
              tier: ProductTier.PREMIUM,
              type: ProductType.NUTRITIONIST,
            },
            {
              name: `${RUN_TAG} standard nutri`,
              price: 29.9,
              tier: ProductTier.STANDARD,
              type: ProductType.NUTRITIONIST,
            },
          ],
        },
      },
      include: { products: true },
    });
    groupId = group.id;
    const premiumProductId = group.products.find(
      (p) => p.tier === ProductTier.PREMIUM,
    )!.id;
    const standardProductId = group.products.find(
      (p) => p.tier === ProductTier.STANDARD,
    )!.id;

    premiumNutritionist = await prisma.users.create({
      data: {
        name: `Premium ${RUN_TAG}`,
        email: `${RUN_TAG}-premium@integration.test`,
        password: 'unused-in-integration-test',
        active: true,
        productId: premiumProductId,
        subscriptionStatus: 'active',
      },
    });
    standardNutritionist = await prisma.users.create({
      data: {
        name: `Standard ${RUN_TAG}`,
        email: `${RUN_TAG}-standard@integration.test`,
        password: 'unused-in-integration-test',
        active: true,
        productId: standardProductId,
        subscriptionStatus: 'active',
      },
    });
    patient = await prisma.client.create({
      data: {
        name: 'Paciente AI meal plan',
        email: `${RUN_TAG}-patient@client.test`,
        phone: '',
        professionalId: premiumNutritionist.id,
      },
    });
  }

  async function as(target: Users) {
    const token = await jwtService.signAsync({
      id: target.id,
      email: target.email,
    });
    const auth = `Bearer ${token}`;
    const server = app.getHttpServer();
    return {
      get: (url: string) => request(server).get(url).set('Authorization', auth),
      post: (url: string, body: object = {}) =>
        request(server).post(url).set('Authorization', auth).send(body),
      put: (url: string, body: object) =>
        request(server).put(url).set('Authorization', auth).send(body),
    };
  }

  async function createClientFor(professionalId: string, label: string) {
    return await prisma.client.create({
      data: {
        name: `Paciente ${label}`,
        email: `${RUN_TAG}-${label}@client.test`,
        phone: '',
        professionalId,
      },
    });
  }

  function conversationUrl(clientId: string): string {
    return `/professionals/clients/${clientId}/meal-plan/generation/conversation`;
  }

  function draftUrl(clientId: string): string {
    return `/professionals/clients/${clientId}/meal-plan/draft`;
  }

  describe('IT-001 guard stack', () => {
    it('401 with no token', async () => {
      const response = await request(app.getHttpServer()).post(
        conversationUrl(patient.id),
      );
      expect(response.status).toBe(401);
    });

    it('404 for a client not owned by the caller (assertOwnedClient, reused unchanged)', async () => {
      const other = await createClientFor(standardNutritionist.id, 'other');
      const n = await as(premiumNutritionist);

      const response = await n.post(conversationUrl(other.id));

      expect(response.status).toBe(404);
      expect(response.body.code).toBe('client_not_found');
      await prisma.client.delete({ where: { id: other.id } });
    });

    it('403 for a non-Premium nutritionist (ProfessionalPremiumGuard, reused unchanged from invoices/billing)', async () => {
      const ownClient = await createClientFor(
        standardNutritionist.id,
        'standard-client',
      );
      const n = await as(standardNutritionist);

      const response = await n.post(conversationUrl(ownClient.id));

      expect(response.status).toBe(403);
      expect(response.body.code).toBe('premium_required');
      await prisma.client.delete({ where: { id: ownClient.id } });
    });

    it('200 (next conversation turn) for an owning, Premium nutritionist', async () => {
      mockConversationThenGeneration(openAiCreate);
      const n = await as(premiumNutritionist);

      const response = await n.post(conversationUrl(patient.id));

      expect(response.status).toBe(200);
      expect(response.body.field).toBe('goal');
      expect(response.body.conversationId).toBeDefined();
    });
  });

  describe('IT-002/IT-003 confirm-overwrite', () => {
    it('IT-002 200 (proceeds) when the current draft is empty, no confirmOverwrite needed', async () => {
      const client = await createClientFor(
        premiumNutritionist.id,
        'empty-draft',
      );
      mockConversationThenGeneration(openAiCreate);
      const n = await as(premiumNutritionist);

      const response = await n.post(conversationUrl(client.id));

      expect(response.status).toBe(200);
      await prisma.client.delete({ where: { id: client.id } });
    });

    it('IT-002 409 confirm_overwrite_required when the draft has at least one meal and confirmOverwrite is not true', async () => {
      const client = await createClientFor(
        premiumNutritionist.id,
        'nonempty-draft',
      );
      const n = await as(premiumNutritionist);
      await n.get(draftUrl(client.id));
      const saved = await n.put(`${draftUrl(client.id)}/days/MONDAY`, {
        meals: [{ label: 'Almoço', text: 'Arroz e feijão' }],
      });
      expect(saved.status).toBe(200);

      const response = await n.post(conversationUrl(client.id));

      expect(response.status).toBe(409);
      expect(response.body.code).toBe('confirm_overwrite_required');
      await prisma.client.delete({ where: { id: client.id } });
    });

    it('IT-003 200 (proceeds, eventually overwriting) when confirmOverwrite: true is passed on a non-empty draft', async () => {
      const client = await createClientFor(
        premiumNutritionist.id,
        'confirmed-overwrite',
      );
      const n = await as(premiumNutritionist);
      await n.get(draftUrl(client.id));
      const saved = await n.put(`${draftUrl(client.id)}/days/MONDAY`, {
        meals: [{ label: 'Almoço', text: 'Arroz e feijão' }],
      });
      expect(saved.status).toBe(200);
      mockConversationThenGeneration(openAiCreate);

      const response = await n.post(conversationUrl(client.id), {
        confirmOverwrite: true,
      });

      expect(response.status).toBe(200);
      await prisma.client.delete({ where: { id: client.id } });
    });
  });

  describe('IT-004/IT-005 full generation flow', () => {
    async function driveThroughIntake(
      n: Awaited<ReturnType<typeof as>>,
      clientId: string,
    ) {
      const start = await n.post(conversationUrl(clientId));
      expect(start.body.field).toBe('goal');
      const afterGoal = await n.post(conversationUrl(clientId), {
        conversationId: start.body.conversationId,
        answer: 'Perda de peso',
      });
      expect(afterGoal.body.field).toBe('restrictions');
      const afterRestrictions = await n.post(conversationUrl(clientId), {
        conversationId: start.body.conversationId,
        answer: 'nenhuma',
      });
      expect(afterRestrictions.body.field).toBe('targetCalories');
      const afterCalories = await n.post(conversationUrl(clientId), {
        conversationId: start.body.conversationId,
        answer: '1800',
      });
      expect(afterCalories.body.field).toBe('mealsPerDay');

      return await n.post(conversationUrl(clientId), {
        conversationId: start.body.conversationId,
        answer: '3',
      });
    }

    it('IT-004 full happy path: 7 weekdays populated and ClientNutritionProfile upserted', async () => {
      const client = await createClientFor(
        premiumNutritionist.id,
        'happy-path',
      );
      const n = await as(premiumNutritionist);
      mockConversationThenGeneration(openAiCreate);

      const final = await driveThroughIntake(n, client.id);

      expect(final.status).toBe(200);
      expect(final.body.days).toHaveLength(7);
      for (const day of final.body.days as { meals: unknown[] }[]) {
        expect(day.meals.length).toBeGreaterThan(0);
      }

      const profile = await prisma.clientNutritionProfile.findUnique({
        where: { clientId: client.id },
      });
      expect(profile).toMatchObject({
        goal: 'Perda de peso',
        restrictions: 'nenhuma',
        targetCalories: 1800,
        mealsPerDay: 3,
      });

      await prisma.client.delete({ where: { id: client.id } });
    });

    it('IT-005 a simulated LLM failure on the final generatePlan call leaves the draft completely unchanged', async () => {
      const client = await createClientFor(
        premiumNutritionist.id,
        'llm-failure',
      );
      const n = await as(premiumNutritionist);
      const draftBefore = await n.get(draftUrl(client.id));
      expect(draftBefore.body.days).toEqual([]);

      mockConversationThenGeneration(openAiCreate);
      openAiCreate.mockImplementation((req: unknown) => {
        const typed = req as {
          response_format?: { json_schema?: { name?: string } };
        };
        if (isGenerationRequest(typed)) {
          throw new Error('simulated OpenAI outage');
        }
        return completion({
          answers: { goal: 'Perda de peso', restrictions: 'nenhuma' },
          field: null,
          question: '',
          done: true,
          reprompt: false,
        });
      });

      const start = await n.post(conversationUrl(client.id));
      const afterCalories = await n.post(conversationUrl(client.id), {
        conversationId: start.body.conversationId,
        answer: '1800',
      });
      expect(afterCalories.body.field).toBe('mealsPerDay');
      const failed = await n.post(conversationUrl(client.id), {
        conversationId: start.body.conversationId,
        answer: '3',
      });

      expect(failed.status).toBe(502);
      expect(failed.body.code).toBe('llm_call_failed');

      const draftAfter = await n.get(draftUrl(client.id));
      expect(draftAfter.body.days).toEqual([]);
      const profile = await prisma.clientNutritionProfile.findUnique({
        where: { clientId: client.id },
      });
      expect(profile).toBeNull();

      await prisma.client.delete({ where: { id: client.id } });
    });
  });
});
