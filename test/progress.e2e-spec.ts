import { AuthGuard } from '@/auth/auth.guard';
import { PrismaService } from '@/database/prisma.service';
import { ProgressController } from '@/progress/progress.controller';
import { ProgressService } from '@/progress/progress.service';
import { MeasurementRecordsRepository } from '@/repositories/progress/measurementRecords.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { Users } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';

jest.setTimeout(30_000);

describe('Progress records integration', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let service: ProgressService;
  let owner: Users;
  let otherUser: Users;
  const jwtSecret = 'progress-integration-jwt-secret';
  const createdUserIds = new Set<string>();
  let sequence = 0;

  beforeAll(async () => {
    process.env.JWT_SECRET = jwtSecret;
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: jwtSecret })],
      controllers: [ProgressController],
      providers: [
        PrismaService,
        UserRepository,
        MeasurementRecordsRepository,
        ProgressService,
        AuthGuard,
      ],
    }).compile();

    app = moduleFixture.createNestApplication<App>();
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    await app.init();
    prisma = moduleFixture.get(PrismaService);
    jwtService = moduleFixture.get(JwtService);
    service = moduleFixture.get(ProgressService);
  });

  beforeEach(async () => {
    sequence += 1;
    owner = await createUser(`owner-${sequence}`);
    otherUser = await createUser(`other-${sequence}`);
  });

  afterEach(async () => {
    const ids = [...createdUserIds];
    if (ids.length > 0) {
      await prisma.measurementRecord.deleteMany({
        where: { userId: { in: ids } },
      });
      await prisma.users.deleteMany({ where: { id: { in: ids } } });
      createdUserIds.clear();
    }
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  async function createUser(label: string): Promise<Users> {
    const user = await prisma.users.create({
      data: {
        name: `Progress ${label}`,
        email: `progress-${label}-${Date.now()}@integration.test`,
        password: 'unused-in-integration-test',
        active: true,
      },
    });
    createdUserIds.add(user.id);
    return user;
  }

  async function tokenFor(user: Users): Promise<string> {
    return await jwtService.signAsync({ id: user.id, email: user.email });
  }

  async function seedRecord(
    userId: string,
    weightKg: number,
    heightCm: number,
    recordedAt: Date,
  ) {
    return await prisma.measurementRecord.create({
      data: { userId, weightKg, heightCm, recordedAt },
    });
  }

  it('IT-001 returns a populated dashboard with all derived shapes', async () => {
    const now = Date.now();
    await seedRecord(owner.id, 63.4, 168, new Date(now - 14 * 86_400_000));
    await seedRecord(owner.id, 62.6, 168, new Date(now - 7 * 86_400_000));
    await seedRecord(owner.id, 62, 168, new Date(now - 86_400_000));

    const response = await request(app.getHttpServer())
      .get('/progress-records/dashboard')
      .set('Authorization', `Bearer ${await tokenFor(owner)}`)
      .expect(200);

    expect(response.body.latest).toEqual(
      expect.objectContaining({
        weightKg: 62,
        heightCm: 168,
        bmi: 22,
        bmiClassification: 'PESO_NORMAL',
      }),
    );
    expect(response.body.weightVariationKg).toBe(-0.6);
    expect(response.body.history).toHaveLength(3);
    expect(
      response.body.weightSeries.map(
        (point: { weightKg: number }) => point.weightKg,
      ),
    ).toEqual([63.4, 62.6, 62]);
    expect(response.body.bmiSeries).toHaveLength(3);
  });

  it('IT-002 returns the exact empty dashboard shape', async () => {
    const response = await request(app.getHttpServer())
      .get('/progress-records/dashboard')
      .set('Authorization', `Bearer ${await tokenFor(owner)}`)
      .expect(200);

    expect(response.body).toEqual({
      latest: null,
      weightVariationKg: null,
      weightSeries: [],
      bmiSeries: [],
      history: [],
    });
  });

  it('IT-003 creates a record without optional measurements', async () => {
    const response = await request(app.getHttpServer())
      .post('/progress-records')
      .set('Authorization', `Bearer ${await tokenFor(owner)}`)
      .send({ weightKg: 61.4, heightCm: 168, userId: otherUser.id })
      .expect(201);

    expect(response.body).toEqual(
      expect.objectContaining({
        weightKg: 61.4,
        heightCm: 168,
        waistCm: null,
        hipCm: null,
        bmi: 21.8,
        bmiClassification: 'PESO_NORMAL',
      }),
    );
    const stored = await prisma.measurementRecord.findUnique({
      where: { id: response.body.id as string },
    });
    expect(stored?.userId).toBe(owner.id);
  });

  it('IT-004 rejects invalid create and update without changing storage', async () => {
    const existing = await seedRecord(owner.id, 62, 168, new Date());
    const token = await tokenFor(owner);

    await request(app.getHttpServer())
      .post('/progress-records')
      .set('Authorization', `Bearer ${token}`)
      .send({ weightKg: 900, heightCm: 168 })
      .expect(400);
    await request(app.getHttpServer())
      .patch(`/progress-records/${existing.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ weightKg: 900, heightCm: 168 })
      .expect(400);

    const stored = await prisma.measurementRecord.findUnique({
      where: { id: existing.id },
    });
    expect(stored?.weightKg).toBe(62);
    expect(
      await prisma.measurementRecord.count({ where: { userId: owner.id } }),
    ).toBe(1);
  });

  it('IT-005 rejects create when heightCm is omitted', async () => {
    await request(app.getHttpServer())
      .post('/progress-records')
      .set('Authorization', `Bearer ${await tokenFor(owner)}`)
      .send({ weightKg: 61.4 })
      .expect(400);
    expect(
      await prisma.measurementRecord.count({ where: { userId: owner.id } }),
    ).toBe(0);
  });

  it('IT-006 lets the owner edit and exposes recalculated dashboard data', async () => {
    const existing = await seedRecord(owner.id, 62, 168, new Date());
    const token = await tokenFor(owner);

    const updated = await request(app.getHttpServer())
      .patch(`/progress-records/${existing.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ weightKg: 60.5, heightCm: 170 })
      .expect(200);
    expect(updated.body).toEqual(
      expect.objectContaining({ weightKg: 60.5, heightCm: 170, bmi: 20.9 }),
    );

    const dashboard = await request(app.getHttpServer())
      .get('/progress-records/dashboard')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(dashboard.body.latest.heightCm).toBe(170);
  });

  it('IT-007 rejects a non-owner update and preserves the record', async () => {
    const existing = await seedRecord(owner.id, 62, 168, new Date());

    await request(app.getHttpServer())
      .patch(`/progress-records/${existing.id}`)
      .set('Authorization', `Bearer ${await tokenFor(otherUser)}`)
      .send({ weightKg: 60.5, heightCm: 168 })
      .expect(401);

    const stored = await prisma.measurementRecord.findUnique({
      where: { id: existing.id },
    });
    expect(stored?.weightKg).toBe(62);
  });

  it('IT-008 lets the owner delete their only record and returns to empty state', async () => {
    const existing = await seedRecord(owner.id, 62, 168, new Date());
    const token = await tokenFor(owner);

    await request(app.getHttpServer())
      .delete(`/progress-records/${existing.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(204);
    const dashboard = await request(app.getHttpServer())
      .get('/progress-records/dashboard')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(dashboard.body).toEqual({
      latest: null,
      weightVariationKg: null,
      weightSeries: [],
      bmiSeries: [],
      history: [],
    });
  });

  it('IT-009 rejects a non-owner delete and keeps the record visible to its owner', async () => {
    const existing = await seedRecord(owner.id, 62, 168, new Date());

    await request(app.getHttpServer())
      .delete(`/progress-records/${existing.id}`)
      .set('Authorization', `Bearer ${await tokenFor(otherUser)}`)
      .expect(401);
    const dashboard = await request(app.getHttpServer())
      .get('/progress-records/dashboard')
      .set('Authorization', `Bearer ${await tokenFor(owner)}`)
      .expect(200);
    expect(dashboard.body.latest.id).toBe(existing.id);
  });

  it('IT-010 rejects every route without Authorization before service access', async () => {
    const getDashboard = jest.spyOn(service, 'getDashboard');
    const create = jest.spyOn(service, 'create');
    const update = jest.spyOn(service, 'update');
    const remove = jest.spyOn(service, 'delete');

    await request(app.getHttpServer())
      .get('/progress-records/dashboard')
      .expect(401);
    await request(app.getHttpServer())
      .post('/progress-records')
      .send({ weightKg: 62, heightCm: 168 })
      .expect(401);
    await request(app.getHttpServer())
      .patch('/progress-records/missing')
      .send({ weightKg: 62, heightCm: 168 })
      .expect(401);
    await request(app.getHttpServer())
      .delete('/progress-records/missing')
      .expect(401);

    expect(getDashboard).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it('IT-011 persists same-day records separately and selects the later timestamp', async () => {
    const token = await tokenFor(owner);
    const first = await request(app.getHttpServer())
      .post('/progress-records')
      .set('Authorization', `Bearer ${token}`)
      .send({ weightKg: 63, heightCm: 168 })
      .expect(201);
    await prisma.measurementRecord.update({
      where: { id: first.body.id as string },
      data: { recordedAt: new Date(Date.now() - 60_000) },
    });
    const second = await request(app.getHttpServer())
      .post('/progress-records')
      .set('Authorization', `Bearer ${token}`)
      .send({ weightKg: 62.5, heightCm: 168 })
      .expect(201);

    const dashboard = await request(app.getHttpServer())
      .get('/progress-records/dashboard')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(
      await prisma.measurementRecord.count({ where: { userId: owner.id } }),
    ).toBe(2);
    expect(dashboard.body.latest.id).toBe(second.body.id);
    expect(dashboard.body.weightVariationKg).toBe(-0.5);
    expect(dashboard.body.weightSeries).toHaveLength(2);
  });
});
