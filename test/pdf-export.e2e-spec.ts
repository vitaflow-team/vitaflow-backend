/**
 * Integration tests for PRD `pdf-export` (task_01, backend).
 *
 * Runs the real PdfExportController classes/PdfExportService, the real
 * repositories they read from (meal plans, AI workouts, EducatorWorkout,
 * form records), AuthGuard/ProfessionalGuard/PhysicalEducatorGuard, and the
 * app's global ValidationPipe against an isolated database — the same
 * convention as clinical-records.e2e-spec.ts / meal-plans.e2e-spec.ts /
 * educator-workouts.e2e-spec.ts. Fixtures are seeded directly via Prisma
 * (not through the source domains' own write APIs), since this suite only
 * needs read-side data to exist, not to exercise those domains' own write
 * paths.
 *
 * Requires `TEST_DATABASE_URL` pointing at an isolated, migrated database.
 */
import { AuthGuard } from '@/auth/auth.guard';
import { PhysicalEducatorGuard } from '@/common/guards/physicalEducator.guard';
import { ProfessionalGuard } from '@/common/guards/professional.guard';
import { createValidationPipe } from '@/config/validationPipe';
import { PrismaService } from '@/database/prisma.service';
import { MealPlansService } from '@/meal-plans/mealPlans.service';
import { EmploymentRepository } from '@/repositories/academia/employment.repository';
import { FormRecordsRepository } from '@/repositories/clinical-records/formRecords.repository';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { EducatorWorkoutsRepository } from '@/repositories/educator-workouts/educatorWorkouts.repository';
import { MealPlansRepository } from '@/repositories/meal-plans/mealPlans.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { WorkoutsRepository } from '@/repositories/workouts/workouts.repository';
import {
  EducatorWorkoutMirrorPdfController,
  EducatorWorkoutPdfController,
  FormRecordAcademiaPdfController,
  FormRecordProfessionalPdfController,
  MealPlanMirrorPdfController,
  MealPlanPdfController,
  WorkoutPdfController,
} from '@/pdf-export/pdfExport.controller';
import { PdfExportService } from '@/pdf-export/pdfExport.service';
import { INestApplication } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import {
  Academia,
  EducatorExerciseSource,
  EducatorWorkoutStatus,
  EmploymentStatus,
  FitnessGoal,
  FormFieldType,
  MealPlanStatus,
  ProductType,
  TemplatePurpose,
  Users,
  Weekday,
} from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';

jest.setTimeout(60_000);

const RUN_TAG = `pdf-export-${Date.now()}`;

describe('PDF export integration', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let formRecordsRepo: FormRecordsRepository;
  let jwtService: JwtService;
  let groupId: string;
  let academia: Academia;
  let nutritionist: Users;
  let educatorA: Users;
  let educatorB: Users;
  let academiaOwner: Users;
  let regularUser: Users;

  beforeAll(async () => {
    if (!process.env.TEST_DATABASE_URL) {
      throw new Error(
        'TEST_DATABASE_URL must point to an isolated migrated test database',
      );
    }
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    process.env.JWT_SECRET = 'pdf-export-integration-jwt-secret';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: process.env.JWT_SECRET })],
      controllers: [
        MealPlanPdfController,
        MealPlanMirrorPdfController,
        WorkoutPdfController,
        EducatorWorkoutPdfController,
        EducatorWorkoutMirrorPdfController,
        FormRecordProfessionalPdfController,
        FormRecordAcademiaPdfController,
      ],
      providers: [
        PrismaService,
        UserRepository,
        ClientsRepository,
        EmploymentRepository,
        MealPlansRepository,
        MealPlansService,
        WorkoutsRepository,
        EducatorWorkoutsRepository,
        FormRecordsRepository,
        ProfessionalGuard,
        PhysicalEducatorGuard,
        AuthGuard,
        PdfExportService,
      ],
    }).compile();
    moduleFixture.useLogger(false);

    app = moduleFixture.createNestApplication<App>();
    app.useGlobalPipes(createValidationPipe());
    await app.init();
    prisma = moduleFixture.get(PrismaService);
    formRecordsRepo = moduleFixture.get(FormRecordsRepository);
    jwtService = moduleFixture.get(JwtService);

    await seed();
  });

  afterAll(async () => {
    const ids = [nutritionist, educatorA, educatorB, academiaOwner, regularUser]
      .filter(Boolean)
      .map((u) => u.id);
    await prisma.formRecord.deleteMany({
      where: {
        client: {
          OR: [{ professionalId: { in: ids } }, { academiaId: academia?.id }],
        },
      },
    });
    await prisma.assessmentTemplate.deleteMany({
      where: {
        OR: [{ professionalId: { in: ids } }, { academiaId: academia?.id }],
      },
    });
    await prisma.educatorWorkout.deleteMany({
      where: {
        client: {
          OR: [{ professionalId: { in: ids } }, { academiaId: academia?.id }],
        },
      },
    });
    await prisma.workout.deleteMany({ where: { userId: { in: ids } } });
    await prisma.mealPlan.deleteMany({
      where: { client: { professionalId: nutritionist?.id } },
    });
    await prisma.employment.deleteMany({ where: { academiaId: academia?.id } });
    await prisma.client.deleteMany({
      where: {
        OR: [{ professionalId: { in: ids } }, { academiaId: academia?.id }],
      },
    });
    await prisma.users.deleteMany({ where: { id: { in: ids } } });
    if (academia)
      await prisma.academia.deleteMany({ where: { id: academia.id } });
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
              name: `${RUN_TAG} nutri`,
              price: 10,
              type: ProductType.NUTRITIONIST,
            },
            {
              name: `${RUN_TAG} edu`,
              price: 10,
              type: ProductType.PHYSICAL_EDUCATOR,
            },
          ],
        },
      },
      include: { products: true },
    });
    groupId = group.id;
    const nutriProductId = group.products.find(
      (p) => p.type === ProductType.NUTRITIONIST,
    )!.id;
    const eduProductId = group.products.find(
      (p) => p.type === ProductType.PHYSICAL_EDUCATOR,
    )!.id;

    nutritionist = await createUser('nutri', { productId: nutriProductId });
    educatorA = await createUser('educator-a', { productId: eduProductId });
    educatorB = await createUser('educator-b', { productId: eduProductId });
    academiaOwner = await createUser('owner', {});
    regularUser = await createUser('regular', {});

    academia = await prisma.academia.create({
      data: { name: `${RUN_TAG} academia` },
    });
    await prisma.users.update({
      where: { id: academiaOwner.id },
      data: { academiaId: academia.id },
    });
    academiaOwner = await prisma.users.findUniqueOrThrow({
      where: { id: academiaOwner.id },
    });
    await prisma.employment.create({
      data: {
        academiaId: academia.id,
        educatorId: educatorB.id,
        status: EmploymentStatus.ACTIVE,
      },
    });
  }

  async function createUser(
    label: string,
    extra: Partial<{ productId: string }>,
  ): Promise<Users> {
    return await prisma.users.create({
      data: {
        name: `PdfExport ${label}`,
        email: `${RUN_TAG}-${label}@integration.test`,
        password: 'unused-in-integration-test',
        active: true,
        ...extra,
      },
    });
  }

  async function makeClient(owner: {
    professionalId?: string | null;
    academiaId?: string | null;
    userId?: string | null;
  }) {
    return await prisma.client.create({
      data: {
        name: `Paciente ${RUN_TAG}`,
        email: `${RUN_TAG}-${Math.random()}@client.test`,
        phone: '',
        ...owner,
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
    };
  }

  describe('GET /professionals/clients/:clientId/meal-plan/draft/pdf', () => {
    it('IT-001 401 without a token; 403/404 for a non-owned client; 200 for the owning professional (empty draft)', async () => {
      const student = await makeClient({ professionalId: nutritionist.id });
      const base = `/professionals/clients/${student.id}/meal-plan/draft/pdf`;

      const unauthenticated = await request(app.getHttpServer()).get(base);
      expect(unauthenticated.status).toBe(401);

      const other = await as(educatorA);
      const notOwned = await other.get(base);
      expect([403, 404]).toContain(notOwned.status);

      const owner = await as(nutritionist);
      const success = await owner.get(base);
      expect(success.status).toBe(200);
      expect(success.headers['content-type']).toContain('application/pdf');
      expect(success.body.slice(0, 4).toString()).toBe('%PDF');
    });
  });

  describe('GET /professionals/clients/:clientId/meal-plan/versions/:version/pdf', () => {
    it('IT-002 404 for an unknown version; 200 for an existing published version', async () => {
      const student = await makeClient({ professionalId: nutritionist.id });
      const plan = await prisma.mealPlan.create({
        data: {
          clientId: student.id,
          status: MealPlanStatus.PUBLISHED,
          version: 1,
          publishedAt: new Date(),
          days: {
            create: [
              {
                weekday: Weekday.MONDAY,
                meals: {
                  create: [{ position: 0, label: 'Café', text: 'Aveia' }],
                },
              },
            ],
          },
        },
      });
      const owner = await as(nutritionist);
      const base = `/professionals/clients/${student.id}/meal-plan/versions`;

      const unknown = await owner.get(`${base}/99/pdf`);
      expect(unknown.status).toBe(404);

      const success = await owner.get(`${base}/${plan.version}/pdf`);
      expect(success.status).toBe(200);
      expect(success.headers['content-type']).toContain('application/pdf');
    });
  });

  describe('GET /me/nutritionist/meal-plan/versions/:version/pdf', () => {
    it('IT-003 404 (no-leak) for no linked nutritionist / unknown version; 200 for a linked client', async () => {
      const linkedUser = await createUser('mp-client', {});
      const student = await makeClient({
        professionalId: nutritionist.id,
        userId: linkedUser.id,
      });
      await prisma.mealPlan.create({
        data: {
          clientId: student.id,
          status: MealPlanStatus.PUBLISHED,
          version: 1,
          publishedAt: new Date(),
        },
      });

      const unlinked = await as(regularUser);
      const notLinked = await unlinked.get(
        '/me/nutritionist/meal-plan/versions/1/pdf',
      );
      expect(notLinked.status).toBe(404);

      const linked = await as(linkedUser);
      const unknownVersion = await linked.get(
        '/me/nutritionist/meal-plan/versions/99/pdf',
      );
      expect(unknownVersion.status).toBe(404);

      const success = await linked.get(
        '/me/nutritionist/meal-plan/versions/1/pdf',
      );
      expect(success.status).toBe(200);

      await prisma.users.delete({ where: { id: linkedUser.id } });
    });
  });

  describe('GET /workouts/current/pdf', () => {
    it('IT-004 401 without a token; 404 with no current workout; 200 success including an unavailable exercise', async () => {
      const user = await createUser('workout-user', {});
      const base = '/workouts/current/pdf';

      const unauthenticated = await request(app.getHttpServer()).get(base);
      expect(unauthenticated.status).toBe(401);

      const noWorkout = await as(user);
      expect((await noWorkout.get(base)).status).toBe(404);

      await prisma.workout.create({
        data: {
          userId: user.id,
          goal: FitnessGoal.MAINTENANCE,
          daysPerWeek: 1,
          explanation: 'Plano de teste',
          days: {
            create: [
              {
                dayOfWeek: 1,
                exercises: {
                  create: [{ exerciseId: null, sets: 3, reps: 10, order: 0 }],
                },
              },
            ],
          },
        },
      });
      const success = await noWorkout.get(base);
      expect(success.status).toBe(200);
      expect(success.headers['content-type']).toContain('application/pdf');

      await prisma.workout.deleteMany({ where: { userId: user.id } });
      await prisma.users.delete({ where: { id: user.id } });
    });
  });

  describe('GET /educator/students/:studentId/workouts/:workoutId/pdf', () => {
    it('IT-005 401 without a token; 403 for a non-educator; 404 for a non-owned workout; 200 for the owning educador', async () => {
      const student = await makeClient({ professionalId: educatorA.id });
      const tree = await prisma.educatorWorkout.create({
        data: {
          clientId: student.id,
          title: 'Treino A',
          status: EducatorWorkoutStatus.ACTIVE,
          sessions: {
            create: [
              {
                name: 'Sessão 1',
                position: 0,
                exercises: {
                  create: [
                    {
                      position: 0,
                      source: EducatorExerciseSource.FREE,
                      name: 'Agachamento',
                      muscleGroup: 'Pernas',
                      sets: 3,
                      reps: '10',
                    },
                  ],
                },
              },
            ],
          },
        },
      });
      const base = `/educator/students/${student.id}/workouts/${tree.id}/pdf`;

      const unauthenticated = await request(app.getHttpServer()).get(base);
      expect(unauthenticated.status).toBe(401);

      const nonEducator = await as(nutritionist);
      expect((await nonEducator.get(base)).status).toBe(403);

      const otherEducator = await as(educatorB);
      expect((await otherEducator.get(base)).status).toBe(404);

      const owner = await as(educatorA);
      const success = await owner.get(base);
      expect(success.status).toBe(200);
      expect(success.headers['content-type']).toContain('application/pdf');
    });
  });

  describe('GET /me/educator-workouts/pdf', () => {
    it('IT-006 401 without a token; the academia-only-unsupported condition; 200 for a directly linked client', async () => {
      const base = '/me/educator-workouts/pdf';
      const unauthenticated = await request(app.getHttpServer()).get(base);
      expect(unauthenticated.status).toBe(401);

      const noWorkout = await as(regularUser);
      expect((await noWorkout.get(base)).status).toBe(404);

      const unassignedUser = await createUser('gym-unassigned', {});
      const unassignedStudent = await makeClient({
        academiaId: academia.id,
        professionalId: null,
        userId: unassignedUser.id,
      });
      await prisma.educatorWorkout.create({
        data: {
          clientId: unassignedStudent.id,
          title: 'Treino academia',
          status: EducatorWorkoutStatus.ACTIVE,
        },
      });
      const unassignedCaller = await as(unassignedUser);
      expect((await unassignedCaller.get(base)).status).toBe(500);

      const linkedUser = await createUser('ew-linked', {});
      const linkedStudent = await makeClient({
        professionalId: educatorA.id,
        userId: linkedUser.id,
      });
      await prisma.educatorWorkout.create({
        data: {
          clientId: linkedStudent.id,
          title: 'Treino vinculado',
          status: EducatorWorkoutStatus.ACTIVE,
        },
      });
      const linkedCaller = await as(linkedUser);
      const success = await linkedCaller.get(base);
      expect(success.status).toBe(200);

      await prisma.users.deleteMany({
        where: { id: { in: [unassignedUser.id, linkedUser.id] } },
      });
    });
  });

  describe('GET /professionals/clients/:clientId/form-records/:id/pdf', () => {
    it('IT-007 401 without a token; 403/404 for a non-owned client/record; 200 success', async () => {
      const student = await makeClient({ professionalId: nutritionist.id });
      const { template, record } = await seedFormRecord({
        professionalId: nutritionist.id,
        clientId: student.id,
      });
      const base = `/professionals/clients/${student.id}/form-records/${record.id}/pdf`;

      const unauthenticated = await request(app.getHttpServer()).get(base);
      expect(unauthenticated.status).toBe(401);

      const other = await as(educatorA);
      expect([403, 404]).toContain((await other.get(base)).status);

      const owner = await as(nutritionist);
      const success = await owner.get(base);
      expect(success.status).toBe(200);
      expect(success.headers['content-type']).toContain('application/pdf');

      await prisma.assessmentTemplate.delete({ where: { id: template.id } });
    });
  });

  describe('GET /academia/clients/:clientId/form-records/:id/pdf', () => {
    it('IT-008 401 without a token; rejected when not authorized; 200 for the owner and for an employed educator', async () => {
      const student = await makeClient({
        academiaId: academia.id,
        professionalId: educatorB.id,
      });
      const { template, record } = await seedFormRecord({
        academiaId: academia.id,
        clientId: student.id,
      });
      const base = `/academia/clients/${student.id}/form-records/${record.id}/pdf`;

      const unauthenticated = await request(app.getHttpServer()).get(base);
      expect(unauthenticated.status).toBe(401);

      const outsider = await as(educatorA);
      expect((await outsider.get(base)).status).toBe(403);

      const owner = await as(academiaOwner);
      const ownerSuccess = await owner.get(base);
      expect(ownerSuccess.status).toBe(200);

      const employedEducator = await as(educatorB);
      const employedSuccess = await employedEducator.get(base);
      expect(employedSuccess.status).toBe(200);

      await prisma.assessmentTemplate.delete({ where: { id: template.id } });
    });
  });

  it('IT-009 findHistory still returns its existing shape after the widened template include', async () => {
    const student = await makeClient({ professionalId: nutritionist.id });
    const { template } = await seedFormRecord({
      professionalId: nutritionist.id,
      clientId: student.id,
    });

    const history = await formRecordsRepo.findHistory(
      student.id,
      TemplatePurpose.ASSESSMENT,
    );

    expect(history).toHaveLength(1);
    expect(history[0].values).toHaveLength(2);
    expect(history[0].values[0].fieldLabel).toBe('Peso');
    // Additive-only: the new field is present without displacing anything
    // findHistory's existing callers (toFormRecordResponse) already read.
    expect(history[0].template?.name).toBe(template.name);

    await prisma.assessmentTemplate.delete({ where: { id: template.id } });
  });

  async function seedFormRecord(owner: {
    professionalId?: string;
    academiaId?: string;
    clientId: string;
  }) {
    const template = await prisma.assessmentTemplate.create({
      data: {
        name: `Template ${RUN_TAG} ${Math.random()}`,
        purpose: TemplatePurpose.ASSESSMENT,
        professionalId: owner.professionalId,
        academiaId: owner.academiaId,
        fields: {
          create: [
            {
              position: 0,
              label: 'Peso',
              fieldType: FormFieldType.NUMBER,
              weightRole: true,
            },
            {
              position: 1,
              label: 'Altura',
              fieldType: FormFieldType.NUMBER,
              heightRole: true,
            },
          ],
        },
      },
    });

    const record = await prisma.formRecord.create({
      data: {
        clientId: owner.clientId,
        templateId: template.id,
        recordedByUserId: owner.professionalId ?? academiaOwner.id,
        values: {
          create: [
            {
              position: 0,
              fieldLabel: 'Peso',
              fieldType: FormFieldType.NUMBER,
              weightRole: true,
              numberValue: 70,
            },
            {
              position: 1,
              fieldLabel: 'Altura',
              fieldType: FormFieldType.NUMBER,
              heightRole: true,
              numberValue: 175,
            },
          ],
        },
      },
    });

    return { template, record };
  }
});
