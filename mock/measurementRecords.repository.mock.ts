import { MeasurementRecordsRepository } from '@/repositories/progress/measurementRecords.repository';
import { MeasurementRecord } from '@prisma/client';

export const measurementRecordMock = [
  {
    id: 'record-1',
    userId: 'User1',
    weightKg: 62,
    heightCm: 168,
    waistCm: null,
    hipCm: null,
    recordedAt: new Date('2026-09-19T20:00:00.000Z'),
    createdAt: new Date('2026-09-19T20:00:00.000Z'),
    updatedAt: new Date('2026-09-19T20:00:00.000Z'),
  },
  {
    id: 'record-2',
    userId: 'User1',
    weightKg: 62.6,
    heightCm: 168,
    waistCm: 78,
    hipCm: null,
    recordedAt: new Date('2026-09-12T09:00:00.000Z'),
    createdAt: new Date('2026-09-12T09:00:00.000Z'),
    updatedAt: new Date('2026-09-12T09:00:00.000Z'),
  },
] as MeasurementRecord[];

export const MeasurementRecordsRepositoryMock = {
  provide: MeasurementRecordsRepository,
  useValue: {
    create: jest.fn(),
    findById: jest.fn(),
    findRecentByUser: jest.fn(),
    findByUserSince: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
};
