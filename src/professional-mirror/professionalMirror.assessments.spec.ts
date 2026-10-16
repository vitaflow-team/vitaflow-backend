import { ProfessionalDiscoveryService } from '@/professional-discovery/professionalDiscovery.service';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { EducatorWorkoutsRepository } from '@/repositories/educator-workouts/educatorWorkouts.repository';
import { FormRecordWithValues } from '@/repositories/clinical-records/formRecords.repository';
import { FormRecordsRepository } from '@/repositories/clinical-records/formRecords.repository';
import { ProfessionalMirrorService } from './professionalMirror.service';

function stored(
  id: string,
  day: string,
  bodyFat: number | null = 18.4,
): FormRecordWithValues {
  return {
    id,
    clientId: 'client-1',
    templateId: 'template-1',
    recordedByUserId: 'edu-1',
    recordedAt: new Date(`${day}T00:00:00.000Z`),
    createdAt: new Date(`${day}T00:00:00.000Z`),
    updatedAt: new Date(`${day}T00:00:00.000Z`),
    values: [
      {
        id: `${id}-weight`,
        recordId: id,
        position: 0,
        fieldLabel: 'Peso (kg)',
        fieldType: 'NUMBER',
        weightRole: true,
        heightRole: false,
        textValue: null,
        numberValue: 78.2,
        boolValue: null,
        selectedOption: null,
      },
      {
        id: `${id}-height`,
        recordId: id,
        position: 1,
        fieldLabel: 'Altura (cm)',
        fieldType: 'NUMBER',
        weightRole: false,
        heightRole: true,
        textValue: null,
        numberValue: 179,
        boolValue: null,
        selectedOption: null,
      },
      {
        id: `${id}-bodyfat`,
        recordId: id,
        position: 2,
        fieldLabel: 'Percentual de gordura corporal (%)',
        fieldType: 'NUMBER',
        weightRole: false,
        heightRole: false,
        textValue: null,
        numberValue: bodyFat,
        boolValue: null,
        selectedOption: null,
      },
    ] as any,
  };
}

describe('ProfessionalMirrorService — assessment (clinical-records)', () => {
  const clients = { findByUserAndProfessionalType: jest.fn() };
  const discovery = { getProfile: jest.fn() };
  const formRecords = { findLatestByClient: jest.fn() };
  const workouts = { findActiveByClient: jest.fn() };
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
    formRecords.findLatestByClient.mockResolvedValue([]);
    workouts.findActiveByClient.mockResolvedValue(null);
    service = new ProfessionalMirrorService(
      clients as unknown as ClientsRepository,
      discovery as unknown as ProfessionalDiscoveryService,
      formRecords as unknown as FormRecordsRepository,
      workouts as unknown as EducatorWorkoutsRepository,
      {
        nextForRecords: jest.fn().mockResolvedValue(new Map()),
        todaySessionId: jest.fn().mockResolvedValue(null),
      } as any,
      { now: () => new Date('2026-10-01T12:00:00Z') } as any,
    );
  });

  it('returns the three newest assessments of the linked record', async () => {
    formRecords.findLatestByClient.mockResolvedValue([
      stored('a4', '2026-09-15'),
      stored('a3', '2026-08-18'),
      stored('a2', '2026-07-21'),
    ]);

    const result = (await service.getEducatorMirror('user-1')) as any;

    expect(formRecords.findLatestByClient).toHaveBeenCalledWith(
      'client-1',
      'ASSESSMENT',
      3,
    );
    expect(result.physicalAssessment).toHaveLength(3);
    expect(result.physicalAssessment[0]).toMatchObject({
      id: 'a4',
      recordedAt: '2026-09-15T00:00:00.000Z',
      bmi: { value: 24.4, classification: 'PESO_NORMAL' },
    });
  });

  it('returns null when there are no assessments', async () => {
    const result = await service.getEducatorMirror('user-1');

    expect(result).toMatchObject({ physicalAssessment: null });
  });

  it('derives a null bmi when a tagged value is missing', async () => {
    formRecords.findLatestByClient.mockResolvedValue([
      {
        ...stored('a1', '2026-09-15', null),
        values: [
          {
            id: 'a1-weight',
            recordId: 'a1',
            position: 0,
            fieldLabel: 'Peso (kg)',
            fieldType: 'NUMBER',
            weightRole: true,
            heightRole: false,
            textValue: null,
            numberValue: 78.2,
            boolValue: null,
            selectedOption: null,
          } as any,
        ],
      },
    ]);

    const result = (await service.getEducatorMirror('user-1')) as any;

    expect(result.physicalAssessment[0].bmi).toBeNull();
  });

  it('leaves the nutritionist mirror unchanged', async () => {
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
    expect(formRecords.findLatestByClient).not.toHaveBeenCalled();
  });

  it('reads the assessments of the record the mirror resolved', async () => {
    clients.findByUserAndProfessionalType.mockResolvedValue({
      id: 'client-recent',
      professionalId: 'edu-2',
    });

    await service.getEducatorMirror('user-1');

    expect(clients.findByUserAndProfessionalType).toHaveBeenCalledWith(
      'user-1',
      'PHYSICAL_EDUCATOR',
    );
    expect(formRecords.findLatestByClient).toHaveBeenCalledWith(
      'client-recent',
      'ASSESSMENT',
      3,
    );
  });

  it('answers no professional without reading assessments when nothing is linked', async () => {
    clients.findByUserAndProfessionalType.mockResolvedValue(null);

    expect(await service.getEducatorMirror('user-1')).toEqual({
      hasProfessional: false,
    });
    expect(formRecords.findLatestByClient).not.toHaveBeenCalled();
  });
});
