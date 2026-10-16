/**
 * Integration tests for PRD `nutritionist-module` (task_02, backend).
 *
 * Runs the real clinical-records controllers/services (templates, form
 * records), ProgressController/ProgressService (for the dashboard merge),
 * the repositories, AuthGuard/ProfessionalGuard/AcademiaOwnerGuard and the
 * app's global ValidationPipe against an isolated database.
 *
 * Requires `TEST_DATABASE_URL` pointing at an isolated, migrated database.
 */
import { AuthGuard } from '@/auth/auth.guard';
import { ConsentRepository } from '@/common/consent/consent.repository';
import { ConsentService } from '@/common/consent/consent.service';
import { AcademiaOwnerGuard } from '@/common/guards/academiaOwner.guard';
import { ProfessionalGuard } from '@/common/guards/professional.guard';
import { createValidationPipe } from '@/config/validationPipe';
import { PrismaService } from '@/database/prisma.service';
import { AcademiaTemplatesController } from '@/clinical-records/templates/academiaTemplates.controller';
import { ProfessionalTemplatesController } from '@/clinical-records/templates/professionalTemplates.controller';
import { TemplatesService } from '@/clinical-records/templates/templates.service';
import { AcademiaFormRecordsController } from '@/clinical-records/records/academiaFormRecords.controller';
import { ProfessionalFormRecordsController } from '@/clinical-records/records/professionalFormRecords.controller';
import { FormRecordsService } from '@/clinical-records/records/formRecords.service';
import { ProgressController } from '@/progress/progress.controller';
import { ProgressService } from '@/progress/progress.service';
import { EmploymentRepository } from '@/repositories/academia/employment.repository';
import { AssessmentTemplatesRepository } from '@/repositories/clinical-records/assessmentTemplates.repository';
import { FormRecordsRepository } from '@/repositories/clinical-records/formRecords.repository';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { MeasurementRecordsRepository } from '@/repositories/progress/measurementRecords.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { INestApplication } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { Academia, Prisma, ProductType, Users } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';

jest.setTimeout(60_000);

const RUN_TAG = `clinical-records-${Date.now()}`;
const RANDOM_UUID = '01890a5d-ac96-774b-bcce-b302099a8099';

describe('Clinical records integration', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let groupId: string;
  let nutritionist: Users;
  let educatorA: Users;
  let educatorB: Users;
  let academiaOwner: Users;
  let otherAcademiaOwner: Users;
  let academia: Academia;
  let otherAcademia: Academia;
  let student: Users;
  const jwtSecret = 'clinical-records-integration-jwt-secret';

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
      controllers: [
        ProfessionalTemplatesController,
        AcademiaTemplatesController,
        ProfessionalFormRecordsController,
        AcademiaFormRecordsController,
        ProgressController,
      ],
      providers: [
        PrismaService,
        UserRepository,
        ClientsRepository,
        EmploymentRepository,
        ConsentRepository,
        ConsentService,
        AssessmentTemplatesRepository,
        FormRecordsRepository,
        MeasurementRecordsRepository,
        TemplatesService,
        FormRecordsService,
        ProgressService,
        AuthGuard,
        ProfessionalGuard,
        AcademiaOwnerGuard,
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

  afterEach(async () => {
    const ids = [
      nutritionist.id,
      educatorA.id,
      educatorB.id,
      academiaOwner.id,
      otherAcademiaOwner.id,
    ];
    await prisma.client.deleteMany({
      where: {
        OR: [
          { professionalId: { in: ids } },
          { academiaId: { in: [academia.id, otherAcademia.id] } },
        ],
      },
    });
    await prisma.measurementRecord.deleteMany({
      where: { userId: student.id },
    });
    await prisma.featureConsent.deleteMany({ where: { userId: { in: ids } } });
    await prisma.employment.deleteMany({
      where: { academiaId: { in: [academia.id, otherAcademia.id] } },
    });
  });

  afterAll(async () => {
    const ids = [
      nutritionist.id,
      educatorA.id,
      educatorB.id,
      academiaOwner.id,
      otherAcademiaOwner.id,
      student.id,
    ];
    await prisma.assessmentTemplate.deleteMany({
      where: {
        OR: [
          { professionalId: { in: ids } },
          { academiaId: { in: [academia.id, otherAcademia.id] } },
        ],
      },
    });
    await prisma.featureConsent.deleteMany({ where: { userId: { in: ids } } });
    await prisma.users.deleteMany({ where: { id: { in: ids } } });
    await prisma.academia.deleteMany({
      where: { id: { in: [academia.id, otherAcademia.id] } },
    });
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
              name: `${RUN_TAG} educator`,
              price: 10,
              type: ProductType.PHYSICAL_EDUCATOR,
            },
            {
              name: `${RUN_TAG} academia`,
              price: 10,
              type: ProductType.ACADEMIA,
            },
          ],
        },
      },
      include: { products: true },
    });
    groupId = group.id;
    const nutriProduct = group.products.find(
      (p) => p.type === ProductType.NUTRITIONIST,
    )!;
    const educatorProduct = group.products.find(
      (p) => p.type === ProductType.PHYSICAL_EDUCATOR,
    )!;
    const academiaProduct = group.products.find(
      (p) => p.type === ProductType.ACADEMIA,
    )!;

    nutritionist = await createUser('nutri', { productId: nutriProduct.id });
    educatorA = await createUser('educator-a', {
      productId: educatorProduct.id,
    });
    educatorB = await createUser('educator-b', {
      productId: educatorProduct.id,
    });
    academiaOwner = await createUser('owner', {
      productId: academiaProduct.id,
    });
    otherAcademiaOwner = await createUser('other-owner', {
      productId: academiaProduct.id,
    });
    student = await createUser('student', { name: 'Diego Aluno' });

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

    otherAcademia = await prisma.academia.create({
      data: { name: `${RUN_TAG} other academia` },
    });
    await prisma.users.update({
      where: { id: otherAcademiaOwner.id },
      data: { academiaId: otherAcademia.id },
    });
    otherAcademiaOwner = await prisma.users.findUniqueOrThrow({
      where: { id: otherAcademiaOwner.id },
    });
  }

  async function createUser(
    label: string,
    extra: Partial<Prisma.UsersUncheckedCreateInput>,
  ): Promise<Users> {
    return await prisma.users.create({
      data: {
        name: `Clinical ${label}`,
        email: `${RUN_TAG}-${label}@integration.test`,
        password: 'unused-in-integration-test',
        active: true,
        ...extra,
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
      patch: (url: string, body: object) =>
        request(server).patch(url).set('Authorization', auth).send(body),
    };
  }

  async function makeClient(
    owner: {
      professionalId?: string;
      academiaId?: string;
      userId?: string;
    },
    label: string,
  ) {
    return await prisma.client.create({
      data: {
        name: `Paciente ${label}`,
        email: `${RUN_TAG}-${label}@client.test`,
        phone: '',
        ...owner,
      },
    });
  }

  function anamneseTemplate() {
    return {
      name: 'Anamnese',
      purpose: 'ANAMNESE',
      fields: [{ label: 'Objetivo principal', fieldType: 'SHORT_TEXT' }],
    };
  }

  function assessmentTemplate() {
    return {
      name: 'Avaliação',
      purpose: 'ASSESSMENT',
      fields: [
        { label: 'Peso (kg)', fieldType: 'NUMBER', weightRole: true },
        { label: 'Altura (cm)', fieldType: 'NUMBER', heightRole: true },
      ],
    };
  }

  it('IT-002 a template edit never changes an already-filled record, and future fills use the new shape', async () => {
    const n = await as(nutritionist);
    const patientA = await makeClient({ professionalId: nutritionist.id }, 'a');
    const patientB = await makeClient({ professionalId: nutritionist.id }, 'b');

    const created = await n.post(
      '/professionals/templates',
      anamneseTemplate(),
    );
    expect(created.status).toBe(201);
    const templateId = created.body.id as string;
    const fieldId = created.body.fields[0].id as string;

    const firstFill = await n.post(
      `/professionals/clients/${patientA.id}/form-records`,
      {
        templateId,
        values: [{ templateFieldId: fieldId, value: 'Emagrecimento' }],
        acceptDeclaration: true,
      },
    );
    expect(firstFill.status).toBe(201);
    expect(firstFill.body.values[0]).toMatchObject({
      fieldLabel: 'Objetivo principal',
      value: 'Emagrecimento',
    });

    const edited = await n.patch(`/professionals/templates/${templateId}`, {
      fields: [{ label: 'Nova pergunta', fieldType: 'SHORT_TEXT' }],
    });
    expect(edited.status).toBe(200);
    const newFieldId = edited.body.fields[0].id as string;

    const secondFill = await n.post(
      `/professionals/clients/${patientB.id}/form-records`,
      {
        templateId,
        values: [{ templateFieldId: newFieldId, value: 'Resposta nova' }],
      },
    );
    expect(secondFill.status).toBe(201);
    expect(secondFill.body.values[0]).toMatchObject({
      fieldLabel: 'Nova pergunta',
      value: 'Resposta nova',
    });

    const historyA = await n.get(
      `/professionals/clients/${patientA.id}/form-records?purpose=ANAMNESE`,
    );
    expect(historyA.body[0].values[0]).toMatchObject({
      fieldLabel: 'Objetivo principal',
      value: 'Emagrecimento',
    });
  });

  it('IT-003 a freshly provisioned owner has exactly one ANAMNESE and one ASSESSMENT template with no manual setup', async () => {
    const templates = app.get(TemplatesService);
    const freshNutritionist = await createUser('fresh-nutri', {
      productId: nutritionist.productId!,
    });

    await templates.ensureStarterTemplates(
      { professionalId: freshNutritionist.id },
      ProductType.NUTRITIONIST,
    );

    const n = await as(freshNutritionist);
    const list = await n.get('/professionals/templates');
    expect(list.status).toBe(200);
    expect(list.body.map((t: { purpose: string }) => t.purpose).sort()).toEqual(
      ['ANAMNESE', 'ASSESSMENT'],
    );

    // Idempotent: calling it again (e.g. a second webhook retry) is a no-op.
    await templates.ensureStarterTemplates(
      { professionalId: freshNutritionist.id },
      ProductType.NUTRITIONIST,
    );
    const again = await n.get('/professionals/templates');
    expect(again.body).toHaveLength(2);

    await prisma.assessmentTemplate.deleteMany({
      where: { professionalId: freshNutritionist.id },
    });
    await prisma.users.delete({ where: { id: freshNutritionist.id } });
  });

  it('IT-004 assessment history returns every record with its own frozen fields across a template edit', async () => {
    const e = await as(educatorA);
    const patient = await makeClient({ professionalId: educatorA.id }, 'hist');

    const created = await e.post(
      '/professionals/templates',
      assessmentTemplate(),
    );
    const templateId = created.body.id as string;
    const weightFieldId = created.body.fields[0].id as string;
    const heightFieldId = created.body.fields[1].id as string;

    for (const weight of [70, 69]) {
      const saved = await e.post(
        `/professionals/clients/${patient.id}/form-records`,
        {
          templateId,
          values: [
            { templateFieldId: weightFieldId, value: weight },
            { templateFieldId: heightFieldId, value: 179 },
          ],
          acceptDeclaration: true,
        },
      );
      expect(saved.status).toBe(201);
    }

    // Editing the template between recordings must not retroactively change
    // the first two records' own frozen field labels/values (ADR-010).
    const edited = await e.patch(`/professionals/templates/${templateId}`, {
      fields: [
        { label: 'Peso corporal (kg)', fieldType: 'NUMBER', weightRole: true },
        { label: 'Altura (cm)', fieldType: 'NUMBER', heightRole: true },
      ],
    });
    const newWeightFieldId = edited.body.fields[0].id as string;
    const newHeightFieldId = edited.body.fields[1].id as string;
    const third = await e.post(
      `/professionals/clients/${patient.id}/form-records`,
      {
        templateId,
        values: [
          { templateFieldId: newWeightFieldId, value: 78 },
          { templateFieldId: newHeightFieldId, value: 179 },
        ],
      },
    );
    expect(third.status).toBe(201);

    const history = await e.get(
      `/professionals/clients/${patient.id}/form-records?purpose=ASSESSMENT`,
    );
    expect(history.body).toHaveLength(3);
    const [newest, middle, oldest] = history.body;
    expect(newest.values[0]).toMatchObject({
      fieldLabel: 'Peso corporal (kg)',
      value: 78,
    });
    expect(middle.values[0]).toMatchObject({
      fieldLabel: 'Peso (kg)',
      value: 69,
    });
    expect(oldest.values[0]).toMatchObject({
      fieldLabel: 'Peso (kg)',
      value: 70,
    });
    expect(
      history.body.every(
        (r: { bmi: { classification: string } | null }) =>
          r.bmi?.classification === 'PESO_NORMAL',
      ),
    ).toBe(true);
  });

  it('IT-008 a physical educator records a real assessment for an existing student end to end', async () => {
    const e = await as(educatorA);
    const patient = await makeClient({ professionalId: educatorA.id }, 'cont');

    const created = await e.post(
      '/professionals/templates',
      assessmentTemplate(),
    );
    expect(created.status).toBe(201);
    const templateId = created.body.id as string;
    const weightFieldId = created.body.fields[0].id as string;
    const heightFieldId = created.body.fields[1].id as string;

    const saved = await e.post(
      `/professionals/clients/${patient.id}/form-records`,
      {
        templateId,
        values: [
          { templateFieldId: weightFieldId, value: 78.2 },
          { templateFieldId: heightFieldId, value: 179 },
        ],
        acceptDeclaration: true,
      },
    );
    expect(saved.status).toBe(201);
    expect(saved.body.bmi).toMatchObject({ classification: 'PESO_NORMAL' });
  });

  it('IT-009 an academia catalog is shared by its employed educators and never mixes with a private template', async () => {
    const owner = await as(academiaOwner);
    await prisma.employment.create({
      data: { academiaId: academia.id, educatorId: educatorA.id },
    });
    await prisma.employment.create({
      data: { academiaId: academia.id, educatorId: educatorB.id },
    });
    const gymStudent = await makeClient(
      { academiaId: academia.id, professionalId: educatorA.id },
      'gym',
    );
    const privateStudent = await makeClient(
      { professionalId: educatorB.id },
      'private',
    );

    const created = await owner.post(
      '/academia/templates',
      assessmentTemplate(),
    );
    expect(created.status).toBe(201);
    const templateId = created.body.id as string;
    const weightFieldId = created.body.fields[0].id as string;
    const heightFieldId = created.body.fields[1].id as string;

    const a = await as(educatorA);
    const discovered = await a.get(
      `/academia/clients/${gymStudent.id}/form-records/templates?purpose=ASSESSMENT`,
    );
    expect(discovered.status).toBe(200);
    expect(discovered.body.map((t: { id: string }) => t.id)).toEqual([
      templateId,
    ]);

    const viaGym = await a.post(
      `/academia/clients/${gymStudent.id}/form-records`,
      {
        templateId,
        values: [
          { templateFieldId: weightFieldId, value: 70 },
          { templateFieldId: heightFieldId, value: 170 },
        ],
        acceptDeclaration: true,
      },
    );
    expect(viaGym.status).toBe(201);

    const b = await as(educatorB);
    const privateCreated = await b.post(
      '/professionals/templates',
      assessmentTemplate(),
    );
    expect(privateCreated.status).toBe(201);
    const privateFill = await b.post(
      `/professionals/clients/${privateStudent.id}/form-records`,
      {
        templateId: privateCreated.body.id,
        values: [
          { templateFieldId: privateCreated.body.fields[0].id, value: 65 },
          { templateFieldId: privateCreated.body.fields[1].id, value: 160 },
        ],
        acceptDeclaration: true,
      },
    );
    expect(privateFill.status).toBe(201);

    // Educator B never sees the academia catalog's template via their own
    // private listing, and vice versa.
    const bOwnTemplates = await b.get(
      '/professionals/templates?purpose=ASSESSMENT',
    );
    expect(
      bOwnTemplates.body.some((t: { id: string }) => t.id === templateId),
    ).toBe(false);
  });

  it('IT-010 an academia owner records an unassigned student directly, later an assigned educator also records one', async () => {
    const owner = await as(academiaOwner);
    const unassigned = await makeClient(
      { academiaId: academia.id },
      'unassigned',
    );

    const created = await owner.post(
      '/academia/templates',
      assessmentTemplate(),
    );
    const templateId = created.body.id as string;
    const weightFieldId = created.body.fields[0].id as string;
    const heightFieldId = created.body.fields[1].id as string;

    const byOwner = await owner.post(
      `/academia/clients/${unassigned.id}/form-records`,
      {
        templateId,
        values: [
          { templateFieldId: weightFieldId, value: 90 },
          { templateFieldId: heightFieldId, value: 180 },
        ],
        acceptDeclaration: true,
      },
    );
    expect(byOwner.status).toBe(201);

    await prisma.client.update({
      where: { id: unassigned.id },
      data: { professionalId: educatorA.id },
    });
    await prisma.employment.create({
      data: { academiaId: academia.id, educatorId: educatorA.id },
    });

    const a = await as(educatorA);
    const byEducator = await a.post(
      `/academia/clients/${unassigned.id}/form-records`,
      {
        templateId,
        values: [
          { templateFieldId: weightFieldId, value: 89 },
          { templateFieldId: heightFieldId, value: 180 },
        ],
        acceptDeclaration: true,
      },
    );
    expect(byEducator.status).toBe(201);

    const history = await owner.get(
      `/academia/clients/${unassigned.id}/form-records?purpose=ASSESSMENT`,
    );
    expect(history.body).toHaveLength(2);
    expect(
      history.body.map((r: { recordedByUserId: string }) => r.recordedByUserId),
    ).toEqual(expect.arrayContaining([academiaOwner.id, educatorA.id]));
  });

  it('IT-011 cross-academia isolation rejects a foreign owner with 403, including a crafted direct id', async () => {
    const student1 = await makeClient({ academiaId: academia.id }, 'iso1');
    const other = await as(otherAcademiaOwner);

    const response = await other.post(
      `/academia/clients/${student1.id}/form-records`,
      { templateId: RANDOM_UUID, values: [] },
    );
    expect(response.status).toBe(403);

    const historyResponse = await other.get(
      `/academia/clients/${student1.id}/form-records?purpose=ASSESSMENT`,
    );
    expect(historyResponse.status).toBe(403);
  });

  it('IT-012 ending an employment immediately cuts off access, re-validated live', async () => {
    const student1 = await makeClient(
      { academiaId: academia.id, professionalId: educatorA.id },
      'cutoff',
    );
    const employment = await prisma.employment.create({
      data: { academiaId: academia.id, educatorId: educatorA.id },
    });
    const owner = await as(academiaOwner);
    const created = await owner.post(
      '/academia/templates',
      assessmentTemplate(),
    );
    const templateId = created.body.id as string;

    const a = await as(educatorA);
    const beforeEnd = await a.post(
      `/academia/clients/${student1.id}/form-records`,
      {
        templateId,
        values: [
          { templateFieldId: created.body.fields[0].id, value: 70 },
          { templateFieldId: created.body.fields[1].id, value: 170 },
        ],
        acceptDeclaration: true,
      },
    );
    expect(beforeEnd.status).toBe(201);

    await prisma.employment.update({
      where: { id: employment.id },
      data: { status: 'ENDED', endedAt: new Date() },
    });

    const afterEnd = await a.post(
      `/academia/clients/${student1.id}/form-records`,
      {
        templateId,
        values: [
          { templateFieldId: created.body.fields[0].id, value: 69 },
          { templateFieldId: created.body.fields[1].id, value: 170 },
        ],
      },
    );
    expect(afterEnd.status).toBe(403);
  });

  it('IT-013 Progress Dashboard merges self-reported entries with weight-tagged records from multiple linked professionals', async () => {
    const patientOfNutri = await makeClient(
      { professionalId: nutritionist.id, userId: student.id },
      'progress-n',
    );
    const patientOfEducator = await makeClient(
      { professionalId: educatorA.id, userId: student.id },
      'progress-e',
    );
    await prisma.measurementRecord.create({
      data: { userId: student.id, weightKg: 70, heightCm: 168 },
    });

    const n = await as(nutritionist);
    const nTemplate = await n.post(
      '/professionals/templates',
      assessmentTemplate(),
    );
    await n.post(`/professionals/clients/${patientOfNutri.id}/form-records`, {
      templateId: nTemplate.body.id,
      values: [
        { templateFieldId: nTemplate.body.fields[0].id, value: 68 },
        { templateFieldId: nTemplate.body.fields[1].id, value: 168 },
      ],
      acceptDeclaration: true,
    });

    const e = await as(educatorA);
    const eTemplate = await e.post(
      '/professionals/templates',
      assessmentTemplate(),
    );
    await e.post(
      `/professionals/clients/${patientOfEducator.id}/form-records`,
      {
        templateId: eTemplate.body.id,
        values: [
          { templateFieldId: eTemplate.body.fields[0].id, value: 69 },
          { templateFieldId: eTemplate.body.fields[1].id, value: 168 },
        ],
        acceptDeclaration: true,
      },
    );

    const s = await as(student);
    const dashboard = await s.get('/progress-records/dashboard');
    expect(dashboard.status).toBe(200);
    const sources = dashboard.body.history.map(
      (p: { source: string }) => p.source,
    );
    expect(sources.filter((src: string) => src === 'EDUCATOR')).toHaveLength(2);
    expect(sources).toContain('SELF');
  });

  it('IT-014 the health-record consent gate blocks the first FormRecord and never re-prompts afterward', async () => {
    const n = await as(nutritionist);
    const patient = await makeClient(
      { professionalId: nutritionist.id },
      'consent',
    );
    const created = await n.post(
      '/professionals/templates',
      anamneseTemplate(),
    );
    const templateId = created.body.id as string;
    const fieldId = created.body.fields[0].id as string;

    const refused = await n.post(
      `/professionals/clients/${patient.id}/form-records`,
      { templateId, values: [{ templateFieldId: fieldId, value: 'x' }] },
    );
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe('declaration_required');

    const accepted = await n.post(
      `/professionals/clients/${patient.id}/form-records`,
      {
        templateId,
        values: [{ templateFieldId: fieldId, value: 'x' }],
        acceptDeclaration: true,
      },
    );
    expect(accepted.status).toBe(201);

    const patient2 = await makeClient(
      { professionalId: nutritionist.id },
      'consent2',
    );
    const again = await n.post(
      `/professionals/clients/${patient2.id}/form-records`,
      { templateId, values: [{ templateFieldId: fieldId, value: 'y' }] },
    );
    expect(again.status).toBe(201);
  });
});
