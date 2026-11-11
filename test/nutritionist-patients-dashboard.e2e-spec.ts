/**
 * Integration tests for PRD `role-management-dashboards`, task_04: the
 * Nutricionista portfolio dashboard (`GET /nutritionist/patients/dashboard`).
 *
 * Requires `TEST_DATABASE_URL` pointing at an isolated, migrated database.
 */
import { AuthGuard } from '@/auth/auth.guard';
import { NutritionistGuard } from '@/common/guards/nutritionist.guard';
import { PrismaService } from '@/database/prisma.service';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { MealsRepository } from '@/repositories/food-diary/meals.repository';
import { WaterLogRepository } from '@/repositories/food-diary/waterLog.repository';
import { MealPlansRepository } from '@/repositories/meal-plans/mealPlans.repository';
import { MeasurementRecordsRepository } from '@/repositories/progress/measurementRecords.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { NutritionistDashboardController } from '@/nutritionist-patients/dashboard/nutritionistDashboard.controller';
import { NutritionistDashboardService } from '@/nutritionist-patients/dashboard/nutritionistDashboard.service';
import { Clock } from '@/scheduling/clock.service';
import { INestApplication } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { ProductType, Users } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';

jest.setTimeout(60_000);

const RUN_TAG = `nutri-dash-${Date.now()}`;
const DAY_MS = 24 * 60 * 60 * 1000;
const jwtSecret = 'nutritionist-patients-dashboard-integration-jwt-secret';

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * DAY_MS);
}

describe('Nutritionist patients dashboard integration (IT-005, IT-006)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let groupId: string;
  const clientIds: string[] = [];
  const userIds: string[] = [];
  const linkedUserIds: string[] = [];

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
      controllers: [NutritionistDashboardController],
      providers: [
        PrismaService,
        UserRepository,
        ClientsRepository,
        MealsRepository,
        WaterLogRepository,
        MealPlansRepository,
        MeasurementRecordsRepository,
        NutritionistDashboardService,
        Clock,
        AuthGuard,
        NutritionistGuard,
      ],
    }).compile();
    moduleFixture.useLogger(false);

    app = moduleFixture.createNestApplication<App>();
    await app.init();
    prisma = moduleFixture.get(PrismaService);
    jwtService = moduleFixture.get(JwtService);

    const group = await prisma.productGroup.create({
      data: {
        name: `${RUN_TAG} group`,
        products: {
          create: [
            {
              name: `${RUN_TAG} nutri product`,
              price: 10,
              type: ProductType.NUTRITIONIST,
            },
          ],
        },
      },
      include: { products: true },
    });
    groupId = group.id;
  });

  afterAll(async () => {
    await prisma.measurementRecord.deleteMany({
      where: { userId: { in: linkedUserIds } },
    });
    await prisma.meal.deleteMany({ where: { userId: { in: linkedUserIds } } });
    await prisma.waterLog.deleteMany({
      where: { userId: { in: linkedUserIds } },
    });
    await prisma.mealPlan.deleteMany({
      where: { clientId: { in: clientIds } },
    });
    await prisma.client.deleteMany({ where: { id: { in: clientIds } } });
    await prisma.users.deleteMany({
      where: { id: { in: [...userIds, ...linkedUserIds] } },
    });
    await prisma.product.deleteMany({ where: { groupId } });
    await prisma.productGroup.deleteMany({ where: { id: groupId } });
    await prisma.$disconnect();
    await app.close();
  });

  async function createNutritionist(label: string): Promise<Users> {
    const product = await prisma.product.findFirstOrThrow({
      where: { groupId, type: ProductType.NUTRITIONIST },
    });
    const user = await prisma.users.create({
      data: {
        name: `${RUN_TAG} ${label}`,
        email: `${RUN_TAG}-${label}@integration.test`,
        password: 'unused-in-integration-test',
        active: true,
        productId: product.id,
      },
    });
    userIds.push(user.id);
    return user;
  }

  async function createRegularUser(label: string): Promise<Users> {
    const user = await prisma.users.create({
      data: {
        name: `${RUN_TAG} ${label}`,
        email: `${RUN_TAG}-${label}@integration.test`,
        password: 'unused-in-integration-test',
        active: true,
      },
    });
    userIds.push(user.id);
    return user;
  }

  async function createLinkedAccount(label: string): Promise<Users> {
    const user = await prisma.users.create({
      data: {
        name: `${RUN_TAG} ${label}`,
        email: `${RUN_TAG}-${label}@integration.test`,
        password: 'unused-in-integration-test',
        active: true,
      },
    });
    linkedUserIds.push(user.id);
    return user;
  }

  async function createPatient(
    professionalId: string,
    label: string,
    linkedUserId: string | null = null,
  ): Promise<string> {
    const client = await prisma.client.create({
      data: {
        name: `${RUN_TAG} ${label}`,
        phone: '11999990000',
        email: `${RUN_TAG}-${label}-${Math.random().toString(36).slice(2, 7)}@integration.test`,
        professionalId,
        userId: linkedUserId,
        createdAt: daysAgo(365),
      },
    });
    clientIds.push(client.id);
    return client.id;
  }

  async function publishPlan(clientId: string, publishedAt: Date) {
    await prisma.mealPlan.create({
      data: { clientId, status: 'PUBLISHED', version: 1, publishedAt },
    });
  }

  async function logMeal(userId: string, loggedAt: Date) {
    await prisma.meal.create({
      data: {
        userId,
        mealType: 'LUNCH',
        description: 'meal',
        calories: 500,
        loggedAt,
      },
    });
  }

  async function createMeasurement(
    userId: string,
    recordedAt: Date,
    weightKg: number,
  ) {
    await prisma.measurementRecord.create({
      data: { userId, recordedAt, weightKg, heightCm: 170 },
    });
  }

  async function as(target: Users) {
    const token = await jwtService.signAsync({
      id: target.id,
      email: target.email,
    });
    return {
      get: (url: string) =>
        request(app.getHttpServer())
          .get(url)
          .set('Authorization', `Bearer ${token}`),
    };
  }

  it('IT-005: 200 with correct bucket classification and no-diary-entry alert; wrong role 403; cross-patient isolation', async () => {
    const nutritionist = await createNutritionist('it005-nutri');
    const otherNutritionist = await createNutritionist('it005-other-nutri');

    const compliantPatient = await createPatient(
      nutritionist.id,
      'it005-compliant',
    );
    await publishPlan(compliantPatient, daysAgo(10));
    const compliantUser = await createLinkedAccount('it005-compliant-user');
    await prisma.client.update({
      where: { id: compliantPatient },
      data: { userId: compliantUser.id },
    });
    for (let i = 0; i < 10; i++) {
      await logMeal(compliantUser.id, daysAgo(i));
    }

    const staleePatient = await createPatient(nutritionist.id, 'it005-stale');
    await publishPlan(staleePatient, daysAgo(30));
    const staleUser = await createLinkedAccount('it005-stale-user');
    await prisma.client.update({
      where: { id: staleePatient },
      data: { userId: staleUser.id },
    });
    await logMeal(staleUser.id, daysAgo(20)); // last entry 20 days ago, well past the 10-day threshold

    const otherPatient = await createPatient(
      otherNutritionist.id,
      'it005-other-patient',
    );
    await publishPlan(otherPatient, daysAgo(5));

    const res = await (
      await as(nutritionist)
    ).get('/nutritionist/patients/dashboard');

    expect(res.status).toBe(200);
    expect(res.body.adherenceBuckets.compliant).toEqual([
      expect.objectContaining({ clientId: compliantPatient }),
    ]);
    const allBucketedIds = [
      ...res.body.adherenceBuckets.compliant,
      ...res.body.adherenceBuckets.struggling,
      ...res.body.adherenceBuckets.nonAdherent,
      ...res.body.adherenceBuckets.noDataYet,
    ].map((e: { clientId: string }) => e.clientId);
    expect(allBucketedIds).not.toContain(otherPatient);
    expect(res.body.noDiaryEntryAlerts).toEqual([
      expect.objectContaining({
        clientId: staleePatient,
        daysSinceLastEntry: 20,
      }),
    ]);

    const regularUser = await createRegularUser('it005-regular');
    const forbidden = await (
      await as(regularUser)
    ).get('/nutritionist/patients/dashboard');
    expect(forbidden.status).toBe(403);
  });

  it('IT-006: portfolioWeightEvolution aggregates only linked patients with data, contributingPatientCount correct', async () => {
    const nutritionist = await createNutritionist('it006-nutri');

    const linkedUserA = await createLinkedAccount('it006-linked-a');
    const linkedUserB = await createLinkedAccount('it006-linked-b');
    await createPatient(nutritionist.id, 'it006-a', linkedUserA.id);
    await createPatient(nutritionist.id, 'it006-b', linkedUserB.id);
    await createMeasurement(
      linkedUserA.id,
      new Date('2026-09-05T12:00:00Z'),
      80,
    );
    await createMeasurement(
      linkedUserA.id,
      new Date('2026-10-05T12:00:00Z'),
      76,
    );
    await createMeasurement(
      linkedUserB.id,
      new Date('2026-09-10T12:00:00Z'),
      60,
    );

    await createPatient(nutritionist.id, 'it006-unlinked', null);

    const res = await (
      await as(nutritionist)
    ).get('/nutritionist/patients/dashboard');

    expect(res.status).toBe(200);
    expect(res.body.portfolioWeightEvolution.length).toBeGreaterThan(0);
    for (const point of res.body.portfolioWeightEvolution) {
      expect(point.contributingPatientCount).toBeGreaterThanOrEqual(1);
      expect(point.contributingPatientCount).toBeLessThanOrEqual(2);
    }
  });
});
