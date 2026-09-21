import { AuthGuard } from '@/auth/auth.guard';
import { MeasurementRecordsRepository } from '@/repositories/progress/measurementRecords.repository';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Test, TestingModule } from '@nestjs/testing';
import {
  MeasurementRecordsRepositoryMock,
  measurementRecordMock,
} from 'mock/measurementRecords.repository.mock';
import request from 'supertest';
import { App } from 'supertest/types';
import { ProgressController } from './progress.controller';
import { ProgressService } from './progress.service';

describe('ProgressController', () => {
  let app: INestApplication<App>;
  let repository: jest.Mocked<MeasurementRecordsRepository>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [ProgressController],
      providers: [ProgressService, MeasurementRecordsRepositoryMock],
    })
      .overrideGuard(AuthGuard)
      .useValue({
        canActivate: (context: {
          switchToHttp: () => { getRequest: () => { user: { id: string } } };
        }) => {
          context.switchToHttp().getRequest().user = { id: 'User1' };
          return true;
        },
      })
      .compile();

    app = moduleFixture.createNestApplication<App>();
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    await app.init();
    repository = moduleFixture.get(MeasurementRecordsRepository);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    repository.findLatestByUser.mockResolvedValue(measurementRecordMock[0]);
    repository.findRecentByUser.mockResolvedValue(measurementRecordMock);
    repository.findByUserSince.mockResolvedValue(
      [...measurementRecordMock].reverse(),
    );
    repository.findById.mockResolvedValue(measurementRecordMock[0]);
    repository.create.mockImplementation((userId, data) =>
      Promise.resolve({
        ...measurementRecordMock[0],
        ...data,
        userId,
        waistCm: data.waistCm ?? null,
        hipCm: data.hipCm ?? null,
      }),
    );
    repository.update.mockImplementation((id, data) =>
      Promise.resolve({
        ...measurementRecordMock[0],
        ...data,
        id,
        waistCm: data.waistCm ?? null,
        hipCm: data.hipCm ?? null,
      }),
    );
    repository.delete.mockResolvedValue(undefined);
  });

  afterAll(async () => {
    await app.close();
  });

  it('applies AuthGuard at the controller class level', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      ProgressController,
    ) as unknown[];
    expect(guards).toContain(AuthGuard);
  });

  it('wires GET /progress-records/dashboard to the authenticated user', async () => {
    const response = await request(app.getHttpServer())
      .get('/progress-records/dashboard')
      .expect(200);

    expect(repository.findRecentByUser.mock.calls).toContainEqual([
      'User1',
      10,
    ]);
    expect(response.body.latest).toEqual(
      expect.objectContaining({ id: 'record-1', bmi: expect.any(Number) }),
    );
  });

  it('UT-014 passes explicit and default weeks to the service', async () => {
    const service = {
      getDashboard: jest.fn().mockResolvedValue(undefined),
    };
    const controller = new ProgressController(
      service as unknown as ProgressService,
    );
    const authenticatedRequest = { user: { id: 'User1' } };

    await controller.getDashboard(authenticatedRequest, { weeks: 12 });
    await controller.getDashboard(authenticatedRequest, {});

    expect(service.getDashboard.mock.calls).toEqual([
      ['User1', 12],
      ['User1', 8],
    ]);
  });

  it('wires POST /progress-records and returns 201', async () => {
    const response = await request(app.getHttpServer())
      .post('/progress-records')
      .send({ weightKg: 61.4, heightCm: 168 })
      .expect(201);

    expect(repository.create.mock.calls).toContainEqual([
      'User1',
      { weightKg: 61.4, heightCm: 168 },
    ]);
    expect(response.body).toEqual(
      expect.objectContaining({ bmi: 21.8, bmiClassification: 'PESO_NORMAL' }),
    );
  });

  it('rejects invalid DTO values before repository access', async () => {
    await request(app.getHttpServer())
      .post('/progress-records')
      .send({ weightKg: 900, heightCm: 168 })
      .expect(400);
    expect(repository.create.mock.calls).toHaveLength(0);
  });

  it('wires PATCH /progress-records/:id with the authenticated user', async () => {
    await request(app.getHttpServer())
      .patch('/progress-records/record-1')
      .send({ weightKg: 60.5, heightCm: 168 })
      .expect(200);
    expect(repository.update.mock.calls).toContainEqual([
      'record-1',
      { weightKg: 60.5, heightCm: 168 },
    ]);
  });

  it('wires DELETE /progress-records/:id and returns 204', async () => {
    await request(app.getHttpServer())
      .delete('/progress-records/record-1')
      .expect(204);
    expect(repository.delete.mock.calls).toContainEqual(['record-1']);
  });

  describe('latest record', () => {
    it('wires GET /progress-records/latest to the authenticated user', async () => {
      const response = await request(app.getHttpServer())
        .get('/progress-records/latest')
        .expect(200);

      expect(repository.findLatestByUser.mock.calls).toContainEqual(['User1']);
      expect(response.body.latest).toEqual(
        expect.objectContaining({ id: 'record-1', bmi: expect.any(Number) }),
      );
    });

    it('UT-005 uses only the authenticated user id, never one from the request', async () => {
      const service = {
        getLatest: jest.fn().mockResolvedValue({ latest: null }),
      };
      const controller = new ProgressController(
        service as unknown as ProgressService,
      );

      await controller.getLatest({ user: { id: 'u1' } });
      await controller.getLatest({
        user: { id: 'u1' },
        params: { id: 'u2' },
        query: { userId: 'u2' },
        body: { userId: 'u2' },
      } as unknown as { user: { id: string } });

      expect(service.getLatest.mock.calls).toEqual([['u1'], ['u1']]);
    });
  });
});
