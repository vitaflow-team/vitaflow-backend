import { Clock } from '@/scheduling/clock.service';
import { FixedSessionsService } from '@/scheduling/fixed-times/fixedSessions.service';
import { MealPlansService } from '@/meal-plans/mealPlans.service';
import { ProfessionalDiscoveryService } from '@/professional-discovery/professionalDiscovery.service';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { EducatorWorkoutsRepository } from '@/repositories/educator-workouts/educatorWorkouts.repository';
import { FormRecordsRepository } from '@/repositories/clinical-records/formRecords.repository';
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
    academiaId: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

describe('ProfessionalMirrorService', () => {
  const clientsFindByUserAndProfessionalType = jest.fn();
  const professionalDiscoveryGetProfile = jest.fn();
  const findLatestByClient = jest.fn();
  const findHistory = jest.fn();
  const findActiveByClient = jest.fn();
  const listVersions = jest.fn();
  const getVersion = jest.fn();

  let service: ProfessionalMirrorService;

  beforeEach(async () => {
    jest.clearAllMocks();
    findLatestByClient.mockResolvedValue([]);
    findHistory.mockResolvedValue([]);
    findActiveByClient.mockResolvedValue(null);
    listVersions.mockResolvedValue([]);
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
          provide: FormRecordsRepository,
          useValue: { findLatestByClient, findHistory },
        },
        {
          provide: ProfessionalDiscoveryService,
          useValue: { getProfile: professionalDiscoveryGetProfile },
        },
        {
          provide: FixedSessionsService,
          useValue: {
            nextForRecords: jest.fn().mockResolvedValue(new Map()),
            todaySessionId: jest.fn().mockResolvedValue(null),
          },
        },
        {
          provide: MealPlansService,
          useValue: { listVersions, getVersion },
        },
        {
          provide: Clock,
          useValue: { now: () => new Date('2026-10-01T12:00:00Z') },
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
        anamnese: null,
        assessmentHistory: [],
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

    function formRecord(
      id: string,
      overrides: Partial<{
        numberValue: number;
        weightRole: boolean;
        heightRole: boolean;
      }> = {},
    ) {
      return {
        id,
        clientId: 'client-1',
        templateId: 'template-1',
        recordedByUserId: 'professional-1',
        recordedAt: new Date('2026-09-15T00:00:00.000Z'),
        createdAt: new Date('2026-09-15T00:00:00.000Z'),
        updatedAt: new Date('2026-09-15T00:00:00.000Z'),
        values: [
          {
            id: `${id}-v`,
            recordId: id,
            position: 0,
            fieldLabel: 'Objetivo',
            fieldType: 'SHORT_TEXT',
            weightRole: false,
            heightRole: false,
            textValue: 'Emagrecimento',
            numberValue: null,
            boolValue: null,
            selectedOption: null,
          },
        ],
        ...overrides,
      };
    }

    beforeEach(() => {
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
    });

    it('UT-054 includes the anamnese current values when one exists', async () => {
      findLatestByClient.mockImplementation((_id: string, purpose: string) =>
        Promise.resolve(purpose === 'ANAMNESE' ? [formRecord('a1')] : []),
      );

      const result = await service.getNutritionistMirror('user-1');

      expect(findLatestByClient).toHaveBeenCalledWith(
        'client-1',
        'ANAMNESE',
        1,
      );
      expect(result).toMatchObject({
        anamnese: {
          id: 'a1',
          values: [{ fieldLabel: 'Objetivo', value: 'Emagrecimento' }],
        },
      });
    });

    it('UT-055 anamnese is null, not an error, when none exists yet', async () => {
      findLatestByClient.mockResolvedValue([]);

      const result = await service.getNutritionistMirror('user-1');

      expect(result).toMatchObject({ anamnese: null });
    });

    it('UT-056 includes the full assessment history with derived BMI where applicable', async () => {
      findHistory.mockResolvedValue([
        formRecord('h1'),
        {
          ...formRecord('h2'),
          values: [
            {
              id: 'h2-w',
              recordId: 'h2',
              position: 0,
              fieldLabel: 'Peso (kg)',
              fieldType: 'NUMBER',
              weightRole: true,
              heightRole: false,
              textValue: null,
              numberValue: 70,
              boolValue: null,
              selectedOption: null,
            },
            {
              id: 'h2-h',
              recordId: 'h2',
              position: 1,
              fieldLabel: 'Altura (cm)',
              fieldType: 'NUMBER',
              weightRole: false,
              heightRole: true,
              textValue: null,
              numberValue: 175,
              boolValue: null,
              selectedOption: null,
            },
          ],
        },
      ]);

      const result = await service.getNutritionistMirror('user-1');

      expect(findHistory).toHaveBeenCalledWith('client-1', 'ASSESSMENT');
      expect(result).toMatchObject({
        assessmentHistory: [
          { id: 'h1', bmi: null },
          { id: 'h2', bmi: { value: 22.9, classification: 'PESO_NORMAL' } },
        ],
      });
    });

    it('UT-057 assessmentHistory is an empty array, not null and not an error, when none exist yet', async () => {
      findHistory.mockResolvedValue([]);

      const result = await service.getNutritionistMirror('user-1');

      expect(result).toMatchObject({ assessmentHistory: [] });
    });

    it('UT-058 includes the current published meal plan and its version history', async () => {
      listVersions.mockResolvedValue([
        { version: 2, publishedAt: '2026-10-10T00:00:00.000Z' },
        { version: 1, publishedAt: '2026-10-01T00:00:00.000Z' },
      ]);
      getVersion.mockResolvedValue({
        id: 'plan-2',
        days: [
          {
            weekday: 'MONDAY',
            meals: [{ id: 'm1', label: 'Almoço', text: 'Arroz' }],
          },
        ],
      });

      const result = await service.getNutritionistMirror('user-1');

      expect(getVersion).toHaveBeenCalledWith('client-1', 2);
      expect(result).toMatchObject({
        mealPlan: {
          currentVersion: 2,
          publishedAt: '2026-10-10T00:00:00.000Z',
          days: [
            {
              weekday: 'MONDAY',
              meals: [{ id: 'm1', label: 'Almoço', text: 'Arroz' }],
            },
          ],
          versions: [
            { version: 2, publishedAt: '2026-10-10T00:00:00.000Z' },
            { version: 1, publishedAt: '2026-10-01T00:00:00.000Z' },
          ],
        },
      });
    });

    it('UT-059 mealPlan is null when no version has been published yet', async () => {
      listVersions.mockResolvedValue([]);

      const result = await service.getNutritionistMirror('user-1');

      expect(result).toMatchObject({ mealPlan: null });
      expect(getVersion).not.toHaveBeenCalled();
    });

    it('UT-060 the professional-identity section includes registrationNumber/label when set', async () => {
      professionalDiscoveryGetProfile.mockResolvedValue({
        id: 'professional-1',
        name: 'Dra. Ana',
        type: 'NUTRITIONIST',
        specialty: null,
        priceFrom: null,
        attendsOnline: false,
        bio: null,
        registrationNumber: '12345/P',
        registrationLabel: 'CRN',
      });

      const result = await service.getNutritionistMirror('user-1');

      expect(result).toMatchObject({
        professional: {
          registrationNumber: '12345/P',
          registrationLabel: 'CRN',
        },
      });
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
