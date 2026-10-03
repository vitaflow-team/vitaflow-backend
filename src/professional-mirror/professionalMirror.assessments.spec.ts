import { ProfessionalDiscoveryService } from '@/professional-discovery/professionalDiscovery.service';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { PhysicalAssessmentsRepository } from '@/repositories/physical-assessments/physicalAssessments.repository';
import { ProfessionalMirrorService } from './professionalMirror.service';

function stored(id: string, day: string, bodyFat: number | null = 18.4) {
  return {
    id,
    clientId: 'client-1',
    assessedOn: new Date(`${day}T00:00:00.000Z`),
    weightKg: 78.2,
    heightCm: 179,
    bodyFatPercent: bodyFat,
  };
}

describe('ProfessionalMirrorService — physical assessment', () => {
  const clients = { findByUserAndProfessionalType: jest.fn() };
  const discovery = { getProfile: jest.fn() };
  const assessments = { findLatestByClient: jest.fn() };
  let service: ProfessionalMirrorService;

  beforeEach(() => {
    jest.clearAllMocks();
    clients.findByUserAndProfessionalType.mockResolvedValue({
      id: 'client-1',
      userId: 'user-1',
      professionalId: 'edu-1',
    });
    discovery.getProfile.mockResolvedValue({
      id: 'edu-1',
      name: 'Thiago Ramos',
      specialty: 'Hipertrofia',
    });
    assessments.findLatestByClient.mockResolvedValue([]);
    service = new ProfessionalMirrorService(
      clients as unknown as ClientsRepository,
      discovery as unknown as ProfessionalDiscoveryService,
      assessments as unknown as PhysicalAssessmentsRepository,
    );
  });

  it('UT-091 returns the three newest assessments of the linked record', async () => {
    assessments.findLatestByClient.mockResolvedValue([
      stored('a4', '2026-09-15'),
      stored('a3', '2026-08-18'),
      stored('a2', '2026-07-21'),
    ]);

    const result = await service.getEducatorMirror('user-1');

    expect(assessments.findLatestByClient).toHaveBeenCalledWith('client-1', 3);
    expect(result).toMatchObject({
      physicalAssessment: [
        {
          id: 'a4',
          assessedOn: '2026-09-15',
          weightKg: 78.2,
          bodyFatPercent: 18.4,
        },
        { id: 'a3', assessedOn: '2026-08-18' },
        { id: 'a2', assessedOn: '2026-07-21' },
      ],
    });
  });

  it('UT-092 returns null when there are no assessments', async () => {
    const result = await service.getEducatorMirror('user-1');

    expect(result).toMatchObject({ physicalAssessment: null });
  });

  it('UT-093 returns a null body fat when it was not recorded', async () => {
    assessments.findLatestByClient.mockResolvedValue([
      stored('a1', '2026-09-15', null),
    ]);

    const result = (await service.getEducatorMirror('user-1')) as {
      physicalAssessment: Array<{ bodyFatPercent: number | null }>;
    };

    expect(result.physicalAssessment[0].bodyFatPercent).toBeNull();
  });

  it('UT-094 leaves the nutritionist mirror unchanged', async () => {
    const result = await service.getNutritionistMirror('user-1');

    expect(result).toEqual({
      professional: {
        id: 'edu-1',
        name: 'Thiago Ramos',
        specialty: 'Hipertrofia',
      },
      mealPlan: null,
      nextConsultation: null,
      billingStatus: null,
    });
    expect(assessments.findLatestByClient).not.toHaveBeenCalled();
  });

  it('UT-095 reads the assessments of the record the mirror resolved', async () => {
    clients.findByUserAndProfessionalType.mockResolvedValue({
      id: 'client-recent',
      professionalId: 'edu-2',
    });

    await service.getEducatorMirror('user-1');

    expect(clients.findByUserAndProfessionalType).toHaveBeenCalledWith(
      'user-1',
      'PHYSICAL_EDUCATOR',
    );
    expect(assessments.findLatestByClient).toHaveBeenCalledWith(
      'client-recent',
      3,
    );
  });

  it('answers no professional without reading assessments when nothing is linked', async () => {
    clients.findByUserAndProfessionalType.mockResolvedValue(null);

    expect(await service.getEducatorMirror('user-1')).toEqual({
      hasProfessional: false,
    });
    expect(assessments.findLatestByClient).not.toHaveBeenCalled();
  });
});
