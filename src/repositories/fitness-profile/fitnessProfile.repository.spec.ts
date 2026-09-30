import { PrismaService } from '@/database/prisma.service';
import { Test, TestingModule } from '@nestjs/testing';
import { FitnessProfile } from '@prisma/client';
import { FitnessProfileRepository } from './fitnessProfile.repository';

function makeProfile(overrides: Partial<FitnessProfile> = {}): FitnessProfile {
  const timestamp = new Date('2026-09-30T09:00:00.000Z');
  return {
    id: 'profile-1',
    userId: 'user-1',
    sex: 'MALE',
    restrictions: [],
    equipment: 'GYM',
    goal: 'MUSCLE_GAIN',
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

describe('FitnessProfileRepository', () => {
  const findUnique = jest.fn();
  const upsert = jest.fn();
  let repository: FitnessProfileRepository;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FitnessProfileRepository,
        {
          provide: PrismaService,
          useValue: { fitnessProfile: { findUnique, upsert } },
        },
      ],
    }).compile();
    repository = module.get(FitnessProfileRepository);
  });

  describe('findByUserId', () => {
    it('returns the profile when one exists for the user', async () => {
      const profile = makeProfile();
      findUnique.mockResolvedValue(profile);

      const result = await repository.findByUserId('user-1');

      expect(findUnique).toHaveBeenCalledWith({ where: { userId: 'user-1' } });
      expect(result).toBe(profile);
    });

    it('returns null when the user has no row, not an error', async () => {
      findUnique.mockResolvedValue(null);

      await expect(repository.findByUserId('user-1')).resolves.toBeNull();
    });
  });

  describe('upsert', () => {
    it('creates a new row when none exists for the user', async () => {
      const created = makeProfile({
        sex: 'FEMALE',
        equipment: null,
        goal: null,
      });
      upsert.mockResolvedValue(created);

      const result = await repository.upsert('user-1', { sex: 'FEMALE' });

      expect(upsert).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        create: { userId: 'user-1', sex: 'FEMALE' },
        update: { sex: 'FEMALE' },
      });
      expect(result).toBe(created);
    });

    it('updates only the provided fields, leaving the rest untouched', async () => {
      const updated = makeProfile({ goal: 'WEIGHT_LOSS' });
      upsert.mockResolvedValue(updated);

      const result = await repository.upsert('user-1', { goal: 'WEIGHT_LOSS' });

      expect(upsert).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        create: { userId: 'user-1', goal: 'WEIGHT_LOSS' },
        update: { goal: 'WEIGHT_LOSS' },
      });
      expect(result.goal).toBe('WEIGHT_LOSS');
      expect(result.sex).toBe('MALE');
      expect(result.equipment).toBe('GYM');
    });
  });
});
