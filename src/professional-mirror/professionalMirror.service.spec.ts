import { ProfessionalDiscoveryService } from '@/professional-discovery/professionalDiscovery.service';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { EducatorWorkoutsRepository } from '@/repositories/educator-workouts/educatorWorkouts.repository';
import { PhysicalAssessmentsRepository } from '@/repositories/physical-assessments/physicalAssessments.repository';
import { Test, TestingModule } from '@nestjs/testing';
import { Client } from '@prisma/client';
import { ProfessionalMirrorService } from './professionalMirror.service';

function makeClient(overrides: Partial<Client> = {}): Client {
  const timestamp = new Date('2026-10-01T09:00:00.000Z');
  return {
    id: 'client-1',
    name: 'Usuária',
    email: 'user@example.com',
    phone: '',
    userId: 'user-1',
    birthDate: null,
    professionalId: 'professional-1',
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

describe('ProfessionalMirrorService', () => {
  const clientsFindByUserAndProfessionalType = jest.fn();
  const professionalDiscoveryGetProfile = jest.fn();
  const findLatestByClient = jest.fn();
  const findActiveByClient = jest.fn();

  let service: ProfessionalMirrorService;

  beforeEach(async () => {
    jest.clearAllMocks();
    findLatestByClient.mockResolvedValue([]);
    findActiveByClient.mockResolvedValue(null);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProfessionalMirrorService,
        {
          provide: ClientsRepository,
          useValue: {
            findByUserAndProfessionalType: clientsFindByUserAndProfessionalType,
          },
        },
        {
          provide: EducatorWorkoutsRepository,
          useValue: { findActiveByClient },
        },
        {
          provide: PhysicalAssessmentsRepository,
          useValue: { findLatestByClient },
        },
        {
          provide: ProfessionalDiscoveryService,
          useValue: { getProfile: professionalDiscoveryGetProfile },
        },
      ],
    }).compile();

    service = module.get(ProfessionalMirrorService);
  });

  describe('getNutritionistMirror', () => {
    it('UT-001 returns the linked nutritionist’s real name and specialty', async () => {
      clientsFindByUserAndProfessionalType.mockResolvedValue(makeClient());
      professionalDiscoveryGetProfile.mockResolvedValue({
        id: 'professional-1',
        name: 'Dra. Ana',
        type: 'NUTRITIONIST',
        specialty: 'Nutrição esportiva',
        priceFrom: 150,
        attendsOnline: true,
        bio: 'Bio',
      });

      const result = await service.getNutritionistMirror('user-1');

      expect(clientsFindByUserAndProfessionalType).toHaveBeenCalledWith(
        'user-1',
        'NUTRITIONIST',
      );
      expect(result).toMatchObject({
        professional: {
          id: 'professional-1',
          name: 'Dra. Ana',
          specialty: 'Nutrição esportiva',
        },
      });
    });

    it('UT-002 reflects the current profile, not a cached one, across two calls', async () => {
      clientsFindByUserAndProfessionalType.mockResolvedValue(makeClient());
      professionalDiscoveryGetProfile.mockResolvedValueOnce({
        id: 'professional-1',
        name: 'Dra. Ana',
        type: 'NUTRITIONIST',
        specialty: 'Nutrição clínica',
        priceFrom: null,
        attendsOnline: false,
        bio: null,
      });

      const first = await service.getNutritionistMirror('user-1');
      expect(first).toMatchObject({
        professional: { specialty: 'Nutrição clínica' },
      });

      professionalDiscoveryGetProfile.mockResolvedValueOnce({
        id: 'professional-1',
        name: 'Dra. Ana',
        type: 'NUTRITIONIST',
        specialty: 'Nutrição esportiva',
        priceFrom: null,
        attendsOnline: false,
        bio: null,
      });

      const second = await service.getNutritionistMirror('user-1');
      expect(second).toMatchObject({
        professional: { specialty: 'Nutrição esportiva' },
      });
      expect(professionalDiscoveryGetProfile).toHaveBeenCalledTimes(2);
    });

    it('UT-003 keeps every not-yet-real contract field explicitly null', async () => {
      clientsFindByUserAndProfessionalType.mockResolvedValue(makeClient());
      professionalDiscoveryGetProfile.mockResolvedValue({
        id: 'professional-1',
        name: 'Dra. Ana',
        type: 'NUTRITIONIST',
        specialty: 'Nutrição esportiva',
        priceFrom: 150,
        attendsOnline: true,
        bio: 'Bio',
      });

      const result = await service.getNutritionistMirror('user-1');

      expect(result).toEqual({
        professional: {
          id: 'professional-1',
          name: 'Dra. Ana',
          specialty: 'Nutrição esportiva',
        },
        mealPlan: null,
        nextConsultation: null,
        billingStatus: null,
      });
    });

    it('UT-004 tolerates a professional profile with unset fields, passing through what is present', async () => {
      clientsFindByUserAndProfessionalType.mockResolvedValue(makeClient());
      professionalDiscoveryGetProfile.mockResolvedValue({
        id: 'professional-1',
        name: 'Dra. Ana',
        type: 'NUTRITIONIST',
        specialty: null,
        priceFrom: null,
        attendsOnline: false,
        bio: null,
      });

      const result = await service.getNutritionistMirror('user-1');

      expect(result).toMatchObject({
        professional: {
          id: 'professional-1',
          name: 'Dra. Ana',
          specialty: null,
        },
      });
    });

    it('UT-005 returns only { hasProfessional: false } when no link exists', async () => {
      clientsFindByUserAndProfessionalType.mockResolvedValue(null);

      const result = await service.getNutritionistMirror('user-1');

      expect(result).toEqual({ hasProfessional: false });
      expect(professionalDiscoveryGetProfile).not.toHaveBeenCalled();
    });

    it('UT-006 returns the no-professional state when only a PENDING request exists', async () => {
      // No Client row backs a PENDING-only ConnectionRequest, so the
      // repository call this service makes finds nothing — exactly the
      // same path as UT-005, proven as its own case per the test contract.
      clientsFindByUserAndProfessionalType.mockResolvedValue(null);

      const result = await service.getNutritionistMirror('user-1');

      expect(result).toEqual({ hasProfessional: false });
    });
  });

  describe('getEducatorMirror', () => {
    it('UT-007 is scoped independently to PHYSICAL_EDUCATOR links', async () => {
      clientsFindByUserAndProfessionalType.mockResolvedValue(
        makeClient({ professionalId: 'educator-1' }),
      );
      professionalDiscoveryGetProfile.mockResolvedValue({
        id: 'educator-1',
        name: 'Prof. Bruno',
        type: 'PHYSICAL_EDUCATOR',
        specialty: 'Funcional',
        priceFrom: null,
        attendsOnline: false,
        bio: null,
      });

      const result = await service.getEducatorMirror('user-1');

      expect(clientsFindByUserAndProfessionalType).toHaveBeenCalledWith(
        'user-1',
        'PHYSICAL_EDUCATOR',
      );
      expect(result).toEqual({
        professional: {
          id: 'educator-1',
          name: 'Prof. Bruno',
          specialty: 'Funcional',
        },
        todayWorkout: null,
        nextSchedule: null,
        physicalAssessment: null,
        billingStatus: null,
      });
    });
  });

  it('UT-008 a nutritionist link never implies an educator link, and vice versa', async () => {
    clientsFindByUserAndProfessionalType.mockImplementation(
      (_userId: string, type: string) =>
        Promise.resolve(type === 'NUTRITIONIST' ? makeClient() : null),
    );
    professionalDiscoveryGetProfile.mockResolvedValue({
      id: 'professional-1',
      name: 'Dra. Ana',
      type: 'NUTRITIONIST',
      specialty: 'Nutrição esportiva',
      priceFrom: null,
      attendsOnline: false,
      bio: null,
    });

    const nutritionist = await service.getNutritionistMirror('user-1');
    const educator = await service.getEducatorMirror('user-1');

    expect(nutritionist).toMatchObject({ professional: { name: 'Dra. Ana' } });
    expect(educator).toEqual({ hasProfessional: false });
  });
});
