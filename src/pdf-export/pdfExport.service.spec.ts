import { AppError } from '@/utils/app.erro';
import { FormRecordWithValues } from '@/repositories/clinical-records/formRecords.repository';
import { Client, ProductType } from '@prisma/client';
import { renderAiWorkoutPdf } from './renderers/aiWorkoutPdf';
import { renderEducatorWorkoutPdf } from './renderers/educatorWorkoutPdf';
import { renderFormRecordPdf } from './renderers/formRecordPdf';
import { renderMealPlanPdf } from './renderers/mealPlanPdf';
import { PdfExportService } from './pdfExport.service';

jest.mock('./renderers/mealPlanPdf');
jest.mock('./renderers/aiWorkoutPdf');
jest.mock('./renderers/educatorWorkoutPdf');
jest.mock('./renderers/formRecordPdf');

const FAKE_BUFFER = Buffer.from('%PDF-fake');

function client(overrides: Partial<Client> = {}): Client {
  return {
    id: 'client-1',
    name: 'João',
    email: 'joao@x.com',
    phone: '',
    userId: 'user-1',
    birthDate: null,
    professionalId: 'pro-1',
    academiaId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function mealPlan() {
  return {
    id: 'plan-1',
    clientId: 'client-1',
    status: 'DRAFT' as const,
    version: null,
    publishedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    days: [],
  };
}

function workout() {
  return {
    id: 'workout-1',
    userId: 'user-1',
    goal: 'MAINTENANCE' as const,
    daysPerWeek: 3,
    explanation: '',
    days: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function educatorTree() {
  return {
    id: 'ew-1',
    clientId: 'client-1',
    title: 'Treino',
    weeklyFrequency: 3,
    status: 'ACTIVE' as const,
    lastEditNotifiedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    sessions: [],
  };
}

function activeWorkoutRow(professional: { id: string; name: string } | null) {
  return { ...educatorTree(), client: { professional } };
}

function formRecord(
  overrides: Partial<FormRecordWithValues> = {},
): FormRecordWithValues {
  return {
    id: 'record-1',
    clientId: 'client-1',
    templateId: 'template-1',
    recordedByUserId: 'pro-1',
    recordedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    values: [],
    ...overrides,
  };
}

function user(name = 'Dra. Ana') {
  return {
    id: 'pro-1',
    name,
    email: 'pro@x.com',
    password: 'x',
    avatar: null,
    active: true,
    phone: null,
    birthDate: null,
    productId: null,
  };
}

describe('PdfExportService', () => {
  let service: PdfExportService;
  let clients: { [K: string]: jest.Mock };
  let users: { [K: string]: jest.Mock };
  let employments: { [K: string]: jest.Mock };
  let mealPlans: { [K: string]: jest.Mock };
  let mealPlansService: { [K: string]: jest.Mock };
  let workouts: { [K: string]: jest.Mock };
  let educatorWorkouts: { [K: string]: jest.Mock };
  let formRecords: { [K: string]: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    (renderMealPlanPdf as jest.Mock).mockResolvedValue(FAKE_BUFFER);
    (renderAiWorkoutPdf as jest.Mock).mockResolvedValue(FAKE_BUFFER);
    (renderEducatorWorkoutPdf as jest.Mock).mockResolvedValue(FAKE_BUFFER);
    (renderFormRecordPdf as jest.Mock).mockResolvedValue(FAKE_BUFFER);

    clients = {
      findOwnedById: jest.fn(),
      getClientById: jest.fn(),
      findByUserAndProfessionalType: jest.fn(),
    };
    users = { findUnique: jest.fn().mockResolvedValue(user()) };
    employments = { findActive: jest.fn() };
    mealPlans = {
      findDraftByClient: jest.fn(),
      findPublishedByVersion: jest.fn(),
    };
    mealPlansService = { getOrCreateDraft: jest.fn() };
    workouts = { findCurrentByUserId: jest.fn() };
    educatorWorkouts = {
      findOwnedTree: jest.fn(),
      findActiveByLinkedUser: jest.fn(),
    };
    formRecords = { findOwned: jest.fn() };

    service = new PdfExportService(
      clients as any,
      users as any,
      employments as any,
      mealPlans as any,
      mealPlansService as any,
      workouts as any,
      educatorWorkouts as any,
      formRecords as any,
    );
  });

  describe('exportMealPlanDraft', () => {
    it('UT-017 asserts ownership, ensures a draft exists, returns plano-alimentar.pdf', async () => {
      clients.findOwnedById.mockResolvedValue(client());
      mealPlans.findDraftByClient.mockResolvedValue(mealPlan());

      const result = await service.exportMealPlanDraft('client-1', 'pro-1');

      expect(clients.findOwnedById).toHaveBeenCalledWith('client-1', 'pro-1');
      expect(mealPlansService.getOrCreateDraft).toHaveBeenCalledWith(
        'client-1',
      );
      expect(result).toEqual({
        filename: 'plano-alimentar.pdf',
        buffer: FAKE_BUFFER,
      });
    });

    it('UT-018 propagates the not-owned error unchanged', async () => {
      clients.findOwnedById.mockResolvedValue(null);

      await expect(
        service.exportMealPlanDraft('client-1', 'pro-1'),
      ).rejects.toMatchObject({ status: 404, code: 'client_not_found' } as any);
      expect(mealPlansService.getOrCreateDraft).not.toHaveBeenCalled();
    });
  });

  describe('exportMealPlanVersion', () => {
    it('UT-019 professional path calls findPublishedByVersion with the given clientId/version', async () => {
      clients.findOwnedById.mockResolvedValue(client());
      mealPlans.findPublishedByVersion.mockResolvedValue(mealPlan());

      await service.exportMealPlanVersion({
        clientId: 'client-1',
        version: 2,
        requesterId: 'pro-1',
        asClient: false,
      });

      expect(clients.findOwnedById).toHaveBeenCalledWith('client-1', 'pro-1');
      expect(mealPlans.findPublishedByVersion).toHaveBeenCalledWith(
        'client-1',
        2,
      );
      expect(clients.findByUserAndProfessionalType).not.toHaveBeenCalled();
    });

    it('UT-020 client path resolves the linked nutritionist, never the ownership check', async () => {
      clients.findByUserAndProfessionalType.mockResolvedValue(client());
      mealPlans.findPublishedByVersion.mockResolvedValue(mealPlan());

      await service.exportMealPlanVersion({
        version: 1,
        requesterId: 'user-1',
        asClient: true,
      });

      expect(clients.findByUserAndProfessionalType).toHaveBeenCalledWith(
        'user-1',
        ProductType.NUTRITIONIST,
      );
      expect(clients.findOwnedById).not.toHaveBeenCalled();
    });

    it('UT-021 an unknown version propagates the existing 404 shape unchanged', async () => {
      clients.findOwnedById.mockResolvedValue(client());
      mealPlans.findPublishedByVersion.mockResolvedValue(null);

      await expect(
        service.exportMealPlanVersion({
          clientId: 'client-1',
          version: 99,
          requesterId: 'pro-1',
          asClient: false,
        }),
      ).rejects.toMatchObject({
        status: 404,
        code: 'meal_plan_version_not_found',
      } as any);
    });
  });

  describe('exportAiWorkout', () => {
    it('UT-022 calls findCurrentByUserId with only the caller own userId', async () => {
      workouts.findCurrentByUserId.mockResolvedValue(workout());

      await service.exportAiWorkout('user-1');

      expect(workouts.findCurrentByUserId).toHaveBeenCalledWith('user-1');
      expect(workouts.findCurrentByUserId).toHaveBeenCalledTimes(1);
    });

    it('UT-023 no current workout propagates a not-found error', async () => {
      workouts.findCurrentByUserId.mockResolvedValue(null);

      await expect(service.exportAiWorkout('user-1')).rejects.toBeInstanceOf(
        AppError,
      );
    });
  });

  describe('exportEducatorWorkoutAsEducator', () => {
    const studentId = '01890a5d-ac96-774b-bcce-b302099a8099';

    it('UT-024 calls findOwnedTree(workoutId, studentId)', async () => {
      clients.findOwnedById.mockResolvedValue(client({ id: studentId }));
      educatorWorkouts.findOwnedTree.mockResolvedValue(educatorTree());

      await service.exportEducatorWorkoutAsEducator(
        'workout-1',
        studentId,
        'educator-1',
      );

      expect(educatorWorkouts.findOwnedTree).toHaveBeenCalledWith(
        'workout-1',
        studentId,
      );
    });

    it('UT-025 ownership failure propagates unchanged', async () => {
      clients.findOwnedById.mockResolvedValue(null);

      await expect(
        service.exportEducatorWorkoutAsEducator(
          'workout-1',
          studentId,
          'educator-1',
        ),
      ).rejects.toMatchObject({
        status: 404,
        code: 'student_not_found',
      } as any);
    });
  });

  describe('exportEducatorWorkoutAsClient', () => {
    it('UT-026 calls findActiveByLinkedUser(userId)', async () => {
      educatorWorkouts.findActiveByLinkedUser.mockResolvedValue([
        activeWorkoutRow({ id: 'educator-1', name: 'Educador X' }),
      ]);

      await service.exportEducatorWorkoutAsClient('user-1');

      expect(educatorWorkouts.findActiveByLinkedUser).toHaveBeenCalledWith(
        'user-1',
      );
    });

    it('UT-027 the academia-only unsupported condition propagates as an error', async () => {
      educatorWorkouts.findActiveByLinkedUser.mockResolvedValue([
        activeWorkoutRow(null),
      ]);

      await expect(
        service.exportEducatorWorkoutAsClient('user-1'),
      ).rejects.toBeInstanceOf(AppError);
    });
  });

  describe('exportFormRecord', () => {
    it('UT-028 professional path calls findOwned after the ownership check', async () => {
      clients.getClientById.mockResolvedValue(client({ academiaId: null }));
      formRecords.findOwned.mockResolvedValue(formRecord());

      await service.exportFormRecord('record-1', 'client-1', {
        userId: 'pro-1',
      });

      expect(formRecords.findOwned).toHaveBeenCalledWith(
        'record-1',
        'client-1',
      );
    });

    it('UT-029 academia path succeeds for an owner/manager and for an employed educator', async () => {
      const academiaClient = client({
        professionalId: 'educator-1',
        academiaId: 'academia-1',
      });
      clients.getClientById.mockResolvedValue(academiaClient);
      formRecords.findOwned.mockResolvedValue(formRecord());

      await service.exportFormRecord('record-1', 'client-1', {
        userId: 'owner-1',
        academiaId: 'academia-1',
      });
      expect(formRecords.findOwned).toHaveBeenCalledTimes(1);

      employments.findActive.mockResolvedValue({ id: 'employment-1' });
      await service.exportFormRecord('record-1', 'client-1', {
        userId: 'educator-1',
      });
      expect(formRecords.findOwned).toHaveBeenCalledTimes(2);
    });

    it('UT-030 an authorization failure propagates unchanged', async () => {
      clients.getClientById.mockResolvedValue(
        client({ professionalId: 'someone-else', academiaId: null }),
      );

      await expect(
        service.exportFormRecord('record-1', 'client-1', { userId: 'pro-1' }),
      ).rejects.toMatchObject({ status: 403, code: 'not_client_owner' } as any);
      expect(formRecords.findOwned).not.toHaveBeenCalled();
    });
  });
});
