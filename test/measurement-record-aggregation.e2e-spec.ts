/**
 * Real-test-database coverage for
 * `MeasurementRecordRepository.aggregateByClientAndMonth`
 * (role-management-dashboards task_04, ADR-006): a raw-SQL aggregation
 * (Prisma's typed `groupBy` can't group by a computed year/month of
 * `recordedAt`), so its SQL correctness is verified against a real
 * database rather than a mocked Prisma client.
 *
 * Requires `TEST_DATABASE_URL` pointing at an isolated, migrated database.
 */
import { PrismaService } from '@/database/prisma.service';
import { MeasurementRecordsRepository } from '@/repositories/progress/measurementRecords.repository';
import { Test, TestingModule } from '@nestjs/testing';
import { Users } from '@prisma/client';

jest.setTimeout(60_000);

const RUN_TAG = `nutri-agg-${Date.now()}`;

describe('MeasurementRecordRepository.aggregateByClientAndMonth (UT-037, UT-050)', () => {
  let moduleFixture: TestingModule;
  let prisma: PrismaService;
  let measurementRecords: MeasurementRecordsRepository;
  const userIds: string[] = [];

  beforeAll(async () => {
    if (!process.env.TEST_DATABASE_URL) {
      throw new Error(
        'TEST_DATABASE_URL must point to an isolated migrated test database',
      );
    }
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

    moduleFixture = await Test.createTestingModule({
      providers: [PrismaService, MeasurementRecordsRepository],
    }).compile();
    prisma = moduleFixture.get(PrismaService);
    measurementRecords = moduleFixture.get(MeasurementRecordsRepository);
  });

  afterAll(async () => {
    await prisma.measurementRecord.deleteMany({
      where: { userId: { in: userIds } },
    });
    await prisma.users.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
    await moduleFixture.close();
  });

  async function createPatient(label: string): Promise<Users> {
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

  async function createMeasurement(
    userId: string,
    recordedAt: Date,
    weightKg: number,
  ) {
    await prisma.measurementRecord.create({
      data: { userId, recordedAt, weightKg, heightCm: 170 },
    });
  }

  it('UT-037: returns the normalized avg weight per (userId, year, month), not a flat average of raw absolute weights', async () => {
    const patientA = await createPatient('UT037-A');
    const patientB = await createPatient('UT037-B');
    await createMeasurement(patientA.id, new Date('2026-09-05T12:00:00Z'), 80);
    await createMeasurement(patientA.id, new Date('2026-09-20T12:00:00Z'), 82);
    await createMeasurement(patientA.id, new Date('2026-10-05T12:00:00Z'), 78);
    await createMeasurement(patientB.id, new Date('2026-09-10T12:00:00Z'), 60);

    const result = await measurementRecords.aggregateByClientAndMonth([
      patientA.id,
      patientB.id,
    ]);

    expect(result).toEqual(
      expect.arrayContaining([
        { userId: patientA.id, year: 2026, month: 9, avgWeightKg: 81 },
        { userId: patientA.id, year: 2026, month: 10, avgWeightKg: 78 },
        { userId: patientB.id, year: 2026, month: 9, avgWeightKg: 60 },
      ]),
    );
    expect(result).toHaveLength(3);
  });

  it('UT-050: returns an empty array for an empty clientIds/userIds array, without querying an invalid empty IN ()', async () => {
    await expect(
      measurementRecords.aggregateByClientAndMonth([]),
    ).resolves.toEqual([]);
  });
});
