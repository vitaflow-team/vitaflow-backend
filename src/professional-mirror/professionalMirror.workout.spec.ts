import { ProfessionalDiscoveryService } from '@/professional-discovery/professionalDiscovery.service';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { EducatorWorkoutsRepository } from '@/repositories/educator-workouts/educatorWorkouts.repository';
import { PhysicalAssessmentsRepository } from '@/repositories/physical-assessments/physicalAssessments.repository';
import { ProfessionalMirrorService } from './professionalMirror.service';

const active = {
  id: 'w1',
  title: 'Hipertrofia',
  weeklyFrequency: 4,
  sessions: [
    { id: 's1', name: 'Peito', _count: { exercises: 5 } },
    { id: 's2', name: 'Costas', _count: { exercises: 4 } },
  ],
};

describe('ProfessionalMirrorService — current workout', () => {
  const clients = { findByUserAndProfessionalType: jest.fn() };
  const discovery = { getProfile: jest.fn() };
  const assessments = { findLatestByClient: jest.fn() };
  const workouts = { findActiveByClient: jest.fn() };
  let service: ProfessionalMirrorService;

  beforeEach(() => {
    jest.resetAllMocks();
    clients.findByUserAndProfessionalType.mockResolvedValue({
      id: 'client-1',
      userId: 'user-1',
      professionalId: 'edu-1',
    });
    discovery.getProfile.mockResolvedValue({
      id: 'edu-1',
      name: 'Thiago Ramos',
      specialty: null,
    });
    assessments.findLatestByClient.mockResolvedValue([]);
    workouts.findActiveByClient.mockResolvedValue(active);
    service = new ProfessionalMirrorService(
      clients as unknown as ClientsRepository,
      discovery as unknown as ProfessionalDiscoveryService,
      assessments as unknown as PhysicalAssessmentsRepository,
      workouts as unknown as EducatorWorkoutsRepository,
    );
  });

  it('UT-066 returns the summary with labeled sessions and no session marked as today', async () => {
    const result = await service.getEducatorMirror('user-1');

    expect(workouts.findActiveByClient).toHaveBeenCalledWith('client-1');
    expect(result).toMatchObject({
      todayWorkout: {
        id: 'w1',
        title: 'Hipertrofia',
        weeklyFrequency: 4,
        sessions: [
          { id: 's1', label: 'A', name: 'Peito', exerciseCount: 5 },
          { id: 's2', label: 'B', name: 'Costas', exerciseCount: 4 },
        ],
        todaySessionId: null,
      },
    });
  });

  it('UT-067 and UT-068 return null with no active workout (only drafts and archived are not read)', async () => {
    workouts.findActiveByClient.mockResolvedValue(null);

    expect(await service.getEducatorMirror('user-1')).toMatchObject({
      todayWorkout: null,
    });
  });

  it('UT-069 reads the workout of the most recently linked record', async () => {
    clients.findByUserAndProfessionalType.mockResolvedValue({
      id: 'client-recent',
      userId: 'user-1',
      professionalId: 'edu-2',
    });

    await service.getEducatorMirror('user-1');

    expect(workouts.findActiveByClient).toHaveBeenCalledWith('client-recent');
  });

  it('UT-070 leaves the nutritionist mirror unchanged', async () => {
    const result = await service.getNutritionistMirror('user-1');

    expect(result).toEqual({
      professional: { id: 'edu-1', name: 'Thiago Ramos', specialty: null },
      mealPlan: null,
      nextConsultation: null,
      billingStatus: null,
    });
    expect(workouts.findActiveByClient).not.toHaveBeenCalled();
  });

  it('reads no workout when nothing is linked', async () => {
    clients.findByUserAndProfessionalType.mockResolvedValue(null);

    expect(await service.getEducatorMirror('user-1')).toEqual({
      hasProfessional: false,
    });
    expect(workouts.findActiveByClient).not.toHaveBeenCalled();
  });
});
