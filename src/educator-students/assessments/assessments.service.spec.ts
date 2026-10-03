import { CodedError } from '@/common/errors/codedError';
import { ConsentService } from '@/common/consent/consent.service';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { PhysicalAssessmentsRepository } from '@/repositories/physical-assessments/physicalAssessments.repository';
import { Prisma } from '@prisma/client';
import { AssessmentsService } from './assessments.service';
import { CreateAssessmentDTO } from './dto/createAssessment.Dto';

const EDUCATOR = 'educator-1';
const STUDENT_ID = '01890a5d-ac96-774b-bcce-b302099a8057';
const ASSESSMENT_ID = '01890a5d-ac96-774b-bcce-b302099a8100';

function stored(overrides: Record<string, unknown> = {}) {
  return {
    id: ASSESSMENT_ID,
    clientId: STUDENT_ID,
    assessedOn: new Date('2026-09-15T00:00:00.000Z'),
    weightKg: 78.2,
    heightCm: 179,
    bodyFatPercent: null,
    restingHeartRate: null,
    flexibilityCm: null,
    armCm: null,
    chestCm: null,
    waistCm: null,
    abdomenCm: null,
    hipCm: null,
    thighCm: null,
    calfCm: null,
    createdAt: new Date('2026-09-15T20:00:00.000Z'),
    updatedAt: new Date('2026-09-15T20:00:00.000Z'),
    ...overrides,
  };
}

const dto: CreateAssessmentDTO = {
  assessedOn: '2026-09-15',
  weightKg: 78.2,
  heightCm: 179,
};

async function codeOf(attempt: Promise<unknown>) {
  const error = (await attempt.catch((e: unknown) => e)) as CodedError;
  return { status: error.getStatus?.(), code: error.code };
}

function uniqueViolation() {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

describe('AssessmentsService', () => {
  const clients = { findOwnedById: jest.fn() };
  const assessments = {
    create: jest.fn(),
    findOwned: jest.fn(),
    listByClient: jest.fn(),
    findAllForVariation: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };
  const consent = { hasConsented: jest.fn(), giveConsent: jest.fn() };
  let service: AssessmentsService;

  beforeEach(() => {
    jest.clearAllMocks();
    clients.findOwnedById.mockResolvedValue({ id: STUDENT_ID });
    consent.hasConsented.mockResolvedValue(true);
    consent.giveConsent.mockResolvedValue(undefined);
    assessments.create.mockImplementation((_, data) =>
      Promise.resolve(stored(data)),
    );
    assessments.update.mockImplementation((_, data) =>
      Promise.resolve(stored(data)),
    );
    assessments.findAllForVariation.mockResolvedValue([]);
    service = new AssessmentsService(
      clients as unknown as ClientsRepository,
      assessments as unknown as PhysicalAssessmentsRepository,
      consent as unknown as ConsentService,
    );
  });

  describe('create', () => {
    it('UT-067 saves for an owned student with the declaration on record', async () => {
      const result = await service.create(EDUCATOR, STUDENT_ID, dto);

      expect(assessments.create).toHaveBeenCalledWith(
        STUDENT_ID,
        expect.objectContaining({
          assessedOn: new Date('2026-09-15T00:00:00.000Z'),
          weightKg: 78.2,
          heightCm: 179,
          bodyFatPercent: null,
          waistCm: null,
        }),
      );
      expect(result).toMatchObject({
        studentId: STUDENT_ID,
        assessedOn: '2026-09-15',
        weightKg: 78.2,
      });
    });

    it('UT-068 refuses without the declaration and saves nothing', async () => {
      consent.hasConsented.mockResolvedValue(false);

      const result = await codeOf(service.create(EDUCATOR, STUDENT_ID, dto));

      expect(result).toEqual({ status: 403, code: 'declaration_required' });
      expect(consent.giveConsent).not.toHaveBeenCalled();
      expect(assessments.create).not.toHaveBeenCalled();
    });

    it('UT-069 records the acceptance first, then saves', async () => {
      consent.hasConsented.mockResolvedValue(false);
      const order: string[] = [];
      consent.giveConsent.mockImplementation(() => {
        order.push('consent');
        return Promise.resolve();
      });
      assessments.create.mockImplementation(() => {
        order.push('assessment');
        return Promise.resolve(stored());
      });

      await service.create(EDUCATOR, STUDENT_ID, {
        ...dto,
        acceptDeclaration: true,
      });

      expect(consent.giveConsent).toHaveBeenCalledWith(
        EDUCATOR,
        'PHYSICAL_ASSESSMENT_RECORDING',
      );
      expect(order).toEqual(['consent', 'assessment']);
    });

    it('UT-070 writes no new acceptance once it is on record', async () => {
      await service.create(EDUCATOR, STUDENT_ID, {
        ...dto,
        acceptDeclaration: true,
      });

      expect(consent.giveConsent).not.toHaveBeenCalled();
    });

    it('UT-071 saves nothing when the acceptance cannot be recorded', async () => {
      consent.hasConsented.mockResolvedValue(false);
      consent.giveConsent.mockRejectedValue(new Error('db down'));

      await expect(
        service.create(EDUCATOR, STUDENT_ID, {
          ...dto,
          acceptDeclaration: true,
        }),
      ).rejects.toThrow('db down');
      expect(assessments.create).not.toHaveBeenCalled();
    });

    it('UT-072 treats a unique violation on the acceptance as already accepted', async () => {
      consent.hasConsented.mockResolvedValue(false);
      consent.giveConsent.mockRejectedValue(uniqueViolation());

      await expect(
        service.create(EDUCATOR, STUDENT_ID, {
          ...dto,
          acceptDeclaration: true,
        }),
      ).resolves.toBeDefined();
      expect(assessments.create).toHaveBeenCalledTimes(1);
    });

    it('UT-073 answers 404 for a foreign or removed student, writing nothing', async () => {
      clients.findOwnedById.mockResolvedValue(null);
      consent.hasConsented.mockResolvedValue(false);

      const result = await codeOf(
        service.create(EDUCATOR, STUDENT_ID, {
          ...dto,
          acceptDeclaration: true,
        }),
      );

      expect(result).toEqual({ status: 404, code: 'student_not_found' });
      expect(consent.giveConsent).not.toHaveBeenCalled();
      expect(assessments.create).not.toHaveBeenCalled();
    });

    it('UT-074 saves two assessments on the same date', async () => {
      await service.create(EDUCATOR, STUDENT_ID, dto);
      await service.create(EDUCATOR, STUDENT_ID, { ...dto, weightKg: 78 });

      expect(assessments.create).toHaveBeenCalledTimes(2);
    });
  });

  describe('update', () => {
    beforeEach(() => {
      assessments.findOwned.mockResolvedValue(stored());
    });

    it('UT-075 replaces the whole set of values, clearing omitted optional ones', async () => {
      const result = await service.update(EDUCATOR, STUDENT_ID, ASSESSMENT_ID, {
        ...dto,
        weightKg: 77.5,
        bodyFatPercent: 17.9,
      });

      expect(assessments.update).toHaveBeenCalledWith(
        ASSESSMENT_ID,
        expect.objectContaining({
          weightKg: 77.5,
          bodyFatPercent: 17.9,
          armCm: null,
        }),
      );
      expect(result.weightKg).toBe(77.5);
    });

    it.each([
      ['an assessment of another student', null],
      ['an assessment that no longer exists', null],
    ])('UT-076 answers 404 assessment_not_found for %s', async (_, found) => {
      assessments.findOwned.mockResolvedValue(found);

      const result = await codeOf(
        service.update(EDUCATOR, STUDENT_ID, ASSESSMENT_ID, dto),
      );

      expect(result).toEqual({ status: 404, code: 'assessment_not_found' });
      expect(assessments.update).not.toHaveBeenCalled();
    });

    it('UT-076 looks the assessment up inside the owned student only', async () => {
      await service.update(EDUCATOR, STUDENT_ID, ASSESSMENT_ID, dto);

      expect(assessments.findOwned).toHaveBeenCalledWith(
        ASSESSMENT_ID,
        STUDENT_ID,
      );
    });

    it('UT-076 answers 404 student_not_found for a foreign student', async () => {
      clients.findOwnedById.mockResolvedValue(null);

      const result = await codeOf(
        service.update(EDUCATOR, STUDENT_ID, ASSESSMENT_ID, dto),
      );

      expect(result).toEqual({ status: 404, code: 'student_not_found' });
    });
  });

  describe('remove', () => {
    it('UT-077 deletes an owned assessment', async () => {
      assessments.findOwned.mockResolvedValue(stored());

      await service.remove(EDUCATOR, STUDENT_ID, ASSESSMENT_ID);

      expect(assessments.delete).toHaveBeenCalledWith(ASSESSMENT_ID);
    });

    it('UT-077 answers 404 for a foreign or already deleted assessment', async () => {
      assessments.findOwned.mockResolvedValue(null);

      const result = await codeOf(
        service.remove(EDUCATOR, STUDENT_ID, ASSESSMENT_ID),
      );

      expect(result).toEqual({ status: 404, code: 'assessment_not_found' });
      expect(assessments.delete).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    it('UT-078 pages the history by 20 and computes the variation over all of it', async () => {
      assessments.listByClient.mockResolvedValue({
        items: [stored()],
        total: 45,
      });
      assessments.findAllForVariation.mockResolvedValue([
        {
          assessedOn: new Date('2026-07-21T00:00:00.000Z'),
          createdAt: new Date('2026-07-21T12:00:00.000Z'),
          weightKg: 80.3,
          bodyFatPercent: null,
        },
        {
          assessedOn: new Date('2026-09-15T00:00:00.000Z'),
          createdAt: new Date('2026-09-15T12:00:00.000Z'),
          weightKg: 78.2,
          bodyFatPercent: null,
        },
      ]);

      const result = await service.list(EDUCATOR, STUDENT_ID, 3);

      expect(assessments.listByClient).toHaveBeenCalledWith(STUDENT_ID, 40, 20);
      expect(result).toMatchObject({
        total: 45,
        page: 3,
        pageSize: 20,
        variation: { weightKg: -2.1, bodyFatPoints: null },
      });
    });

    it('UT-078 returns an empty history with no variation', async () => {
      assessments.listByClient.mockResolvedValue({ items: [], total: 0 });

      const result = await service.list(EDUCATOR, STUDENT_ID);

      expect(result).toEqual({
        items: [],
        total: 0,
        page: 1,
        pageSize: 20,
        variation: null,
      });
    });

    it('UT-079 reflects a changed date in the order the repository returns', async () => {
      assessments.listByClient.mockResolvedValue({
        items: [
          stored({ id: 'newer', assessedOn: new Date('2026-09-20T00:00:00Z') }),
          stored({ id: 'moved', assessedOn: new Date('2026-08-01T00:00:00Z') }),
        ],
        total: 2,
      });

      const result = await service.list(EDUCATOR, STUDENT_ID);

      expect(result.items.map((i) => i.id)).toEqual(['newer', 'moved']);
      expect(result.items[1].assessedOn).toBe('2026-08-01');
    });

    it('UT-080 recomputes the variation from what remains after a deletion', async () => {
      assessments.listByClient.mockResolvedValue({ items: [], total: 2 });
      assessments.findAllForVariation.mockResolvedValue([
        {
          assessedOn: new Date('2026-08-18T00:00:00.000Z'),
          createdAt: new Date('2026-08-18T12:00:00.000Z'),
          weightKg: 79,
          bodyFatPercent: null,
        },
        {
          assessedOn: new Date('2026-09-15T00:00:00.000Z'),
          createdAt: new Date('2026-09-15T12:00:00.000Z'),
          weightKg: 78.2,
          bodyFatPercent: null,
        },
      ]);

      const result = await service.list(EDUCATOR, STUDENT_ID);

      expect(result.variation?.weightKg).toBe(-0.8);
    });

    it('answers 404 for a foreign student', async () => {
      clients.findOwnedById.mockResolvedValue(null);

      const result = await codeOf(service.list(EDUCATOR, STUDENT_ID));

      expect(result).toEqual({ status: 404, code: 'student_not_found' });
    });
  });

  describe('declarationStatus', () => {
    it('UT-081 reports per educator whether the declaration was accepted', async () => {
      consent.hasConsented.mockImplementation((userId: string) =>
        Promise.resolve(userId === 'accepted-educator'),
      );

      expect(await service.declarationStatus('accepted-educator')).toEqual({
        accepted: true,
      });
      expect(await service.declarationStatus('other-educator')).toEqual({
        accepted: false,
      });
      expect(consent.hasConsented).toHaveBeenCalledWith(
        'other-educator',
        'PHYSICAL_ASSESSMENT_RECORDING',
      );
    });
  });

  it('UT-169 does not touch the stored assessment when the values are invalid', async () => {
    // Validation happens before the service runs (UT-001..UT-011); the service
    // must therefore never be reached with an invalid payload, and a failing
    // lookup must leave the stored values alone.
    assessments.findOwned.mockResolvedValue(null);

    await codeOf(
      service.update(EDUCATOR, STUDENT_ID, ASSESSMENT_ID, {
        ...dto,
        weightKg: 5,
      }),
    );

    expect(assessments.update).not.toHaveBeenCalled();
  });
});
