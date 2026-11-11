/**
 * Integration tests for PRD `role-management-dashboards`, task_03: the
 * Educador Físico portfolio dashboard (`GET /educator/students/dashboard`).
 *
 * Requires `TEST_DATABASE_URL` pointing at an isolated, migrated database.
 */
import { AuthGuard } from '@/auth/auth.guard';
import { PhysicalEducatorGuard } from '@/common/guards/physicalEducator.guard';
import { PrismaService } from '@/database/prisma.service';
import { BillingAccountRepository } from '@/repositories/billing/billingAccount.repository';
import { InvoicesRepository } from '@/repositories/billing/invoices.repository';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { FixedTimesRepository } from '@/repositories/fixed-times/fixedTimes.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { EducatorDashboardController } from '@/educator-students/dashboard/educatorDashboard.controller';
import { EducatorDashboardService } from '@/educator-students/dashboard/educatorDashboard.service';
import { Clock } from '@/scheduling/clock.service';
import { INestApplication } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { InvoiceStatus, ProductType, Users } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';

jest.setTimeout(60_000);

const RUN_TAG = `edu-dash-${Date.now()}`;
const DAY_MS = 24 * 60 * 60 * 1000;
const jwtSecret = 'educator-students-dashboard-integration-jwt-secret';

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * DAY_MS);
}

describe('Educator students dashboard integration (IT-002, IT-003, IT-004)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let groupId: string;
  const clientIds: string[] = [];
  const userIds: string[] = [];
  const academiaIds: string[] = [];

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
      controllers: [EducatorDashboardController],
      providers: [
        PrismaService,
        UserRepository,
        ClientsRepository,
        FixedTimesRepository,
        BillingAccountRepository,
        InvoicesRepository,
        EducatorDashboardService,
        Clock,
        AuthGuard,
        PhysicalEducatorGuard,
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
              name: `${RUN_TAG} educator product`,
              price: 10,
              type: ProductType.PHYSICAL_EDUCATOR,
            },
          ],
        },
      },
      include: { products: true },
    });
    groupId = group.id;
  });

  afterAll(async () => {
    await prisma.invoice.deleteMany({
      where: { billingAccount: { userId: { in: userIds } } },
    });
    await prisma.billingAccount.deleteMany({
      where: { userId: { in: userIds } },
    });
    await prisma.fixedSession.deleteMany({
      where: { clientId: { in: clientIds } },
    });
    await prisma.client.deleteMany({ where: { id: { in: clientIds } } });
    await prisma.users.deleteMany({ where: { id: { in: userIds } } });
    await prisma.academia.deleteMany({ where: { id: { in: academiaIds } } });
    await prisma.product.deleteMany({ where: { groupId } });
    await prisma.productGroup.deleteMany({ where: { id: groupId } });
    await prisma.$disconnect();
    await app.close();
  });

  async function createEducator(label: string): Promise<Users> {
    const product = await prisma.product.findFirstOrThrow({
      where: { groupId, type: ProductType.PHYSICAL_EDUCATOR },
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

  async function createStudent(
    professionalId: string,
    label: string,
    createdAt: Date = daysAgo(365),
  ): Promise<string> {
    const client = await prisma.client.create({
      data: {
        name: `${RUN_TAG} ${label}`,
        phone: '11999990000',
        email: `${RUN_TAG}-${label}-${Math.random().toString(36).slice(2, 7)}@integration.test`,
        professionalId,
        createdAt,
      },
    });
    clientIds.push(client.id);
    return client.id;
  }

  async function createSession(
    clientId: string,
    professionalId: string,
    startAt: Date,
  ) {
    const endAt = new Date(startAt.getTime() + 60 * 60 * 1000);
    await prisma.fixedSession.create({
      data: { clientId, professionalId, startAt, endAt, type: 'PRESENCIAL' },
    });
  }

  async function connectBilling(userId: string) {
    return await prisma.billingAccount.create({
      data: {
        userId,
        provider: 'ASAAS',
        accountName: `${RUN_TAG} account`,
        apiKeyFingerprint: `${RUN_TAG}-${userId}-fp`,
        webhookTokenHash: `${RUN_TAG}-${userId}-wh`,
      },
    });
  }

  async function createInvoice(
    clientId: string,
    billingAccountId: string,
    year: number,
    month: number,
    amountCents: number,
    status: InvoiceStatus,
  ) {
    await prisma.invoice.create({
      data: {
        clientId,
        billingAccountId,
        competenceYear: year,
        competenceMonth: month,
        amountCents,
        dueDate: new Date(`${year}-${String(month).padStart(2, '0')}-10`),
        status,
      },
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

  it('IT-002: 200 with correct counters/risk/no-contact from seeded data; wrong role returns 403', async () => {
    const educator = await createEducator('it002-educator');
    const atRiskStudent = await createStudent(educator.id, 'it002-at-risk');
    const okStudent = await createStudent(educator.id, 'it002-ok');
    await createSession(okStudent, educator.id, daysAgo(2));
    await createSession(atRiskStudent, educator.id, daysAgo(15));

    const res = await (await as(educator)).get('/educator/students/dashboard');

    expect(res.status).toBe(200);
    expect(res.body.counters).toEqual({
      activeCount: 1,
      inactiveCount: 1,
      totalCount: 2,
    });
    expect(res.body.riskRanking).toEqual([
      expect.objectContaining({
        clientId: atRiskStudent,
        reasons: ['NO_CONTACT'],
      }),
    ]);
    expect(res.body.noContactAlerts).toEqual([
      expect.objectContaining({ clientId: atRiskStudent }),
    ]);

    const regularUser = await createRegularUser('it002-regular');
    const forbidden = await (
      await as(regularUser)
    ).get('/educator/students/dashboard');
    expect(forbidden.status).toBe(403);
  });

  it('IT-003: cross-professional isolation; mid-session disconnect excludes the student from counters', async () => {
    const educatorA = await createEducator('it003-a');
    const educatorB = await createEducator('it003-b');
    // studentA is academia-owned (academiaId set) so the disconnect below
    // (professionalId -> null) still satisfies Client_owner_check — the
    // same shape an ended Employment produces (EmploymentRepository.end).
    const academia = await prisma.academia.create({
      data: { name: `${RUN_TAG} it003 academia` },
    });
    academiaIds.push(academia.id);
    const studentA = await prisma.client
      .create({
        data: {
          name: `${RUN_TAG} it003-a-student`,
          phone: '11999990000',
          email: `${RUN_TAG}-it003-a-student-${Math.random().toString(36).slice(2, 7)}@integration.test`,
          professionalId: educatorA.id,
          academiaId: academia.id,
          createdAt: daysAgo(365),
        },
      })
      .then((client) => {
        clientIds.push(client.id);
        return client.id;
      });
    const studentB = await createStudent(educatorB.id, 'it003-b-student');
    await createSession(studentA, educatorA.id, daysAgo(1));
    await createSession(studentB, educatorB.id, daysAgo(1));

    const resA = await (
      await as(educatorA)
    ).get('/educator/students/dashboard');
    expect(resA.body.counters.totalCount).toBe(1);
    const clientIdsInA = [
      ...resA.body.riskRanking.map((e: { clientId: string }) => e.clientId),
      ...resA.body.revenueByStudentMonth.map(
        (e: { clientId: string }) => e.clientId,
      ),
    ];
    expect(clientIdsInA).not.toContain(studentB);

    const resB = await (
      await as(educatorB)
    ).get('/educator/students/dashboard');
    expect(resB.body.counters.totalCount).toBe(1);

    await prisma.client.update({
      where: { id: studentA },
      data: { professionalId: null },
    });

    const resAfterDisconnect = await (
      await as(educatorA)
    ).get('/educator/students/dashboard');
    expect(resAfterDisconnect.body.counters.totalCount).toBe(0);
  });

  it('IT-004: revenue series matches seeded invoices; billingAvailable false with no default overdue flag when unconnected', async () => {
    const connectedEducator = await createEducator('it004-connected');
    const unconnectedEducator = await createEducator('it004-unconnected');
    const studentOne = await createStudent(connectedEducator.id, 'it004-one');
    const studentTwo = await createStudent(connectedEducator.id, 'it004-two');
    const account = await connectBilling(connectedEducator.id);
    await createInvoice(
      studentOne,
      account.id,
      2026,
      9,
      10_000,
      InvoiceStatus.PAID,
    );
    await createInvoice(
      studentTwo,
      account.id,
      2026,
      10,
      5_000,
      InvoiceStatus.PAID,
    );

    const resConnected = await (
      await as(connectedEducator)
    ).get('/educator/students/dashboard');
    expect(resConnected.body.revenueByStudentMonth).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          clientId: studentOne,
          year: 2026,
          month: 9,
          amountCents: 10_000,
        }),
        expect.objectContaining({
          clientId: studentTwo,
          year: 2026,
          month: 10,
          amountCents: 5_000,
        }),
      ]),
    );

    const unconnectedStudent = await createStudent(
      unconnectedEducator.id,
      'it004-unconnected-student',
    );
    await createSession(unconnectedStudent, unconnectedEducator.id, daysAgo(1));

    const resUnconnected = await (
      await as(unconnectedEducator)
    ).get('/educator/students/dashboard');
    expect(resUnconnected.body.revenueByStudentMonth).toEqual([]);
    for (const entry of resUnconnected.body.riskRanking) {
      expect(entry.billingAvailable).toBe(false);
      expect(entry.reasons).not.toContain('OVERDUE_PAYMENT');
    }
  });
});
