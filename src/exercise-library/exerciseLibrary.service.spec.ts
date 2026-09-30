import { UserRepository } from '@/repositories/users/user.repository';
import { AppError } from '@/utils/app.erro';
import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  ExerciseContraindication,
  ExerciseEquipment,
  ExerciseStatus,
  ProductType,
} from '@prisma/client';
import {
  ExercisesRepositoryMock,
  exerciseStore,
  resetExerciseStore,
  seedExercises,
} from 'mock/exercisesRepository.mock';
import { ExerciseSubmitDto } from './dto/exerciseSubmit.Dto';
import {
  EXERCISE_PAGE_SIZE,
  ExerciseLibraryService,
} from './exerciseLibrary.service';

const EDUCATOR_ID = 'educator-1';
const OTHER_EDUCATOR_ID = 'educator-2';
const STUDENT_ID = 'student-1';
const REVIEWER_ID = 'backoffice-1';

const productTypeByUser: Record<string, ProductType> = {
  [EDUCATOR_ID]: ProductType.PHYSICAL_EDUCATOR,
  [OTHER_EDUCATOR_ID]: ProductType.PHYSICAL_EDUCATOR,
  [STUDENT_ID]: ProductType.USER,
};

const userRepositoryFake = {
  provide: UserRepository,
  useValue: {
    findByIdWithProduct: jest.fn().mockImplementation((id: string) => {
      const type = productTypeByUser[id];
      return Promise.resolve(
        type ? { id, product: { id: `product-${type}`, type } } : null,
      );
    }),
  },
};

const repository = ExercisesRepositoryMock.useValue;

function submission(overrides: Partial<ExerciseSubmitDto> = {}) {
  return {
    name: 'Remada curvada',
    description: 'Tronco inclinado, puxe a barra até o abdômen.',
    muscleGroup: 'Costas',
    equipment: ExerciseEquipment.GYM,
    ...overrides,
  };
}

describe('ExerciseLibraryService', () => {
  let service: ExerciseLibraryService;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      providers: [
        ExerciseLibraryService,
        ExercisesRepositoryMock,
        userRepositoryFake,
      ],
    }).compile();

    service = moduleFixture.get(ExerciseLibraryService);
    resetExerciseStore();
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('findMany', () => {
    it('UT-001 returns every approved exercise with its list fields', async () => {
      seedExercises(
        { name: 'Supino reto', muscleGroup: 'Peito', difficulty: 'Iniciante' },
        { name: 'Agachamento', muscleGroup: 'Pernas', difficulty: 'Médio' },
        { name: 'Remada', muscleGroup: 'Costas', difficulty: 'Avançado' },
      );

      const result = await service.findMany({});

      expect(result).toHaveLength(3);
      expect(result).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'Agachamento',
            muscleGroup: 'Pernas',
            difficulty: 'Médio',
          }),
        ]),
      );
    });

    it('UT-002 returns [] (not an error) when nothing matches', async () => {
      await expect(service.findMany({})).resolves.toEqual([]);
      await expect(service.listOwnSubmissions(EDUCATOR_ID)).resolves.toEqual(
        [],
      );
      await expect(
        service.findMany({}, ExerciseStatus.PENDING),
      ).resolves.toEqual([]);
    });

    it('UT-003 returns only the APPROVED exercise when a PENDING one exists', async () => {
      const [approved] = seedExercises(
        { status: ExerciseStatus.APPROVED },
        { status: ExerciseStatus.PENDING },
        { status: ExerciseStatus.REJECTED },
      );

      const result = await service.findMany({});

      expect(result.map((exercise) => exercise.id)).toEqual([approved.id]);
      expect(repository.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ status: ExerciseStatus.APPROVED }),
      );
    });

    it('UT-004 returns exercises 51-100 for page 2 of a 150-row catalog', async () => {
      const seeded = seedExercises(
        ...Array.from({ length: 150 }, (_, index) => ({
          name: `Exercise ${String(index + 1).padStart(3, '0')}`,
        })),
      );

      const result = await service.findMany({ page: 2 });

      expect(EXERCISE_PAGE_SIZE).toBe(50);
      expect(result).toHaveLength(50);
      expect(result[0].id).toBe(seeded[50].id);
      expect(result[49].id).toBe(seeded[99].id);
    });

    it('UT-005 filters by muscle group', async () => {
      seedExercises(
        { name: 'Supino', muscleGroup: 'Peito' },
        { name: 'Crucifixo', muscleGroup: 'Peito' },
        { name: 'Agachamento', muscleGroup: 'Pernas' },
      );

      const result = await service.findMany({ muscleGroup: 'Peito' });

      expect(result.map((exercise) => exercise.name)).toEqual([
        'Supino',
        'Crucifixo',
      ]);
    });

    it('UT-006 returns [] for a filter or search that matches nothing', async () => {
      seedExercises({ muscleGroup: 'Peito', equipment: ExerciseEquipment.GYM });

      await expect(
        service.findMany({ muscleGroup: 'Nonexistent' }),
      ).resolves.toEqual([]);
      await expect(service.findMany({ q: 'nada disso' })).resolves.toEqual([]);
      await expect(
        service.findMany({ equipment: ExerciseEquipment.BODYWEIGHT }),
      ).resolves.toEqual([]);
    });

    it('UT-007 a multi-muscle exercise appears under every matching filter', async () => {
      const [pullUp] = seedExercises({
        name: 'Barra fixa',
        muscleGroup: 'Costas',
        primaryMuscles: ['Costas', 'Ombro'],
      });

      const byBack = await service.findMany({ muscleGroup: 'Costas' });
      const byShoulder = await service.findMany({ muscleGroup: 'Ombro' });

      expect(byBack.map((exercise) => exercise.id)).toContain(pullUp.id);
      expect(byShoulder.map((exercise) => exercise.id)).toContain(pullUp.id);
    });

    it('UT-008 searches names case-insensitively by substring', async () => {
      seedExercises(
        { name: 'Supino Reto' },
        { name: 'SUPINO inclinado' },
        { name: 'Agachamento' },
      );

      const result = await service.findMany({ q: 'supino' });

      expect(result.map((exercise) => exercise.name)).toEqual([
        'Supino Reto',
        'SUPINO inclinado',
      ]);
    });

    it('UT-009 a special-character or very long search does not throw', async () => {
      seedExercises({ name: 'Supino Reto' });

      await expect(service.findMany({ q: '%%%' })).resolves.toEqual([]);
      await expect(service.findMany({ q: 'x'.repeat(5000) })).resolves.toEqual(
        [],
      );
    });

    it('UT-010 matches an exercise whose name is still untranslated', async () => {
      const [benchPress] = seedExercises({ name: 'Bench Press' });

      const result = await service.findMany({ q: 'Bench Press' });

      expect(result.map((exercise) => exercise.id)).toEqual([benchPress.id]);
    });

    it('UT-030 filters by the exact equipment enum value', async () => {
      seedExercises(
        { name: 'Flexão', equipment: ExerciseEquipment.BODYWEIGHT },
        { name: 'Leg press', equipment: ExerciseEquipment.GYM },
        { name: 'Rosca elástico', equipment: ExerciseEquipment.HOME_BASIC },
      );

      const result = await service.findMany({
        equipment: ExerciseEquipment.BODYWEIGHT,
      });

      expect(result.map((exercise) => exercise.name)).toEqual(['Flexão']);
    });

    it('UT-031 an exercise without equipment is excluded from every equipment filter', async () => {
      const [legacy] = seedExercises({
        name: 'Legacy row',
        equipment: null as unknown as ExerciseEquipment,
      });

      for (const equipment of Object.values(ExerciseEquipment)) {
        const result = await service.findMany({ equipment });
        expect(result.map((exercise) => exercise.id)).not.toContain(legacy.id);
      }
    });
  });

  describe('findById', () => {
    it('UT-011 returns the full detail of an approved exercise, including videoUrl', async () => {
      const [exercise] = seedExercises({
        videoUrl: 'https://cdn.example.com/supino.mp4',
        imageUrl: 'https://cdn.example.com/supino.png',
        contraindications: [ExerciseContraindication.SHOULDER],
      });

      const result = await service.findById(exercise.id);

      expect(result).toEqual(exercise);
      expect(result.videoUrl).toBe('https://cdn.example.com/supino.mp4');
    });

    it('UT-012 still returns name/muscleGroup/description without any media', async () => {
      const [exercise] = seedExercises({ videoUrl: null, imageUrl: null });

      const result = await service.findById(exercise.id);

      expect(result).toMatchObject({
        name: exercise.name,
        muscleGroup: exercise.muscleGroup,
        description: exercise.description,
        videoUrl: null,
        imageUrl: null,
      });
    });

    it('UT-013 returns the stored videoUrl without checking reachability', async () => {
      const unreachable = 'https://unreachable.invalid/video.mp4';
      const [exercise] = seedExercises({ videoUrl: unreachable });

      const result = await service.findById(exercise.id);

      expect(result.videoUrl).toBe(unreachable);
    });

    it('UT-014 returns sourceAttribution/sourceLicense when set', async () => {
      const [exercise] = seedExercises({
        sourceAttribution: 'wger / exercemus',
        sourceLicense: 'CC-BY-SA 3.0',
      });

      const result = await service.findById(exercise.id);

      expect(result.sourceAttribution).toBe('wger / exercemus');
      expect(result.sourceLicense).toBe('CC-BY-SA 3.0');
    });

    it('UT-015 returns null attribution for an exercise created in-house', async () => {
      const created = await service.createDirect(
        submission({ name: 'Prancha' }),
        REVIEWER_ID,
      );

      const result = await service.findById(created.id);

      expect(result.sourceAttribution).toBeNull();
      expect(result.sourceLicense).toBeNull();
    });

    it('answers 404 for a missing exercise and for a non-approved one', async () => {
      const [pending] = seedExercises({ status: ExerciseStatus.PENDING });

      for (const id of ['missing-id', pending.id]) {
        const attempt = service.findById(id);
        await expect(attempt).rejects.toBeInstanceOf(AppError);
        await expect(attempt).rejects.toMatchObject({
          status: 404,
          message: 'Exercício não encontrado.',
        });
      }
    });

    it('lets backoffice callers read a non-approved exercise', async () => {
      const [pending] = seedExercises({ status: ExerciseStatus.PENDING });

      await expect(service.findById(pending.id, true)).resolves.toEqual(
        pending,
      );
    });
  });

  describe('submit', () => {
    it('UT-016 creates a PENDING exercise attributed to the educator', async () => {
      const result = await service.submit(
        submission({ contraindications: [ExerciseContraindication.SPINE] }),
        EDUCATOR_ID,
      );

      expect(result).toMatchObject({
        status: ExerciseStatus.PENDING,
        submittedById: EDUCATOR_ID,
        contraindications: [ExerciseContraindication.SPINE],
      });
      await expect(service.findMany({})).resolves.toEqual([]);
    });

    it('UT-017 rejects a blank required field with 400 and creates nothing', async () => {
      const attempt = service.submit(submission({ name: '  ' }), EDUCATOR_ID);

      await expect(attempt).rejects.toBeInstanceOf(AppError);
      await expect(attempt).rejects.toMatchObject({
        status: 400,
        message: 'O nome do exercício é obrigatório.',
      });
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('UT-018 accepts a submission named like an existing approved exercise', async () => {
      seedExercises({
        name: 'Remada curvada',
        status: ExerciseStatus.APPROVED,
      });

      const result = await service.submit(submission(), EDUCATOR_ID);

      expect(result.status).toBe(ExerciseStatus.PENDING);
      expect(exerciseStore).toHaveLength(2);
    });

    it('UT-019 flags an identical resubmission with 409 instead of a second row', async () => {
      await service.submit(submission(), EDUCATOR_ID);

      const attempt = service.submit(submission(), EDUCATOR_ID);

      await expect(attempt).rejects.toBeInstanceOf(AppError);
      await expect(attempt).rejects.toMatchObject({ status: 409 });
      expect(
        exerciseStore.filter(
          (exercise) => exercise.status === ExerciseStatus.PENDING,
        ),
      ).toHaveLength(1);
    });

    it('does not flag the same payload sent by a different educator', async () => {
      await service.submit(submission(), EDUCATOR_ID);

      await expect(
        service.submit(submission(), OTHER_EDUCATOR_ID),
      ).resolves.toMatchObject({ status: ExerciseStatus.PENDING });
    });

    it('refuses a caller who is not a physical educator with 403', async () => {
      const attempt = service.submit(submission(), STUDENT_ID);

      await expect(attempt).rejects.toBeInstanceOf(AppError);
      await expect(attempt).rejects.toMatchObject({ status: 403 });
      expect(repository.create).not.toHaveBeenCalled();
    });
  });

  describe('listOwnSubmissions', () => {
    it("UT-020 returns only the educator's own submissions with their status", async () => {
      const own = await service.submit(submission(), EDUCATOR_ID);
      await service.submit(
        submission({ name: 'Outro exercício' }),
        OTHER_EDUCATOR_ID,
      );

      const result = await service.listOwnSubmissions(EDUCATOR_ID);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: own.id,
        status: ExerciseStatus.PENDING,
      });
    });

    it('UT-021 shows a rejected submission with its reason, if any', async () => {
      const withReason = await service.submit(submission(), EDUCATOR_ID);
      const withoutReason = await service.submit(
        submission({ name: 'Sem motivo' }),
        EDUCATOR_ID,
      );
      await service.reject(withReason.id, REVIEWER_ID, 'Duplicado.');
      await service.reject(withoutReason.id, REVIEWER_ID);

      const result = await service.listOwnSubmissions(EDUCATOR_ID);

      expect(result).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: withReason.id,
            status: ExerciseStatus.REJECTED,
            rejectionReason: 'Duplicado.',
          }),
          expect.objectContaining({
            id: withoutReason.id,
            status: ExerciseStatus.REJECTED,
            rejectionReason: null,
          }),
        ]),
      );
    });

    it('refuses a caller who is not a physical educator with 403', async () => {
      await expect(
        service.listOwnSubmissions(STUDENT_ID),
      ).rejects.toMatchObject({ status: 403 });
    });
  });

  describe('approve / reject', () => {
    it('UT-022 moves PENDING to APPROVED and records the reviewer', async () => {
      const pending = await service.submit(submission(), EDUCATOR_ID);

      const result = await service.approve(pending.id, REVIEWER_ID);

      expect(result).toMatchObject({
        status: ExerciseStatus.APPROVED,
        reviewedById: REVIEWER_ID,
      });
      const visible = await service.findMany({});
      expect(visible.map((exercise) => exercise.id)).toContain(pending.id);
    });

    it('UT-023 refuses to approve an already-approved exercise with 409', async () => {
      const [approved] = seedExercises({ status: ExerciseStatus.APPROVED });

      const attempt = service.approve(approved.id, REVIEWER_ID);

      await expect(attempt).rejects.toBeInstanceOf(AppError);
      await expect(attempt).rejects.toMatchObject({
        status: 409,
        message: 'Exercício já está aprovado.',
      });
    });

    it('UT-024 moves PENDING to REJECTED and stores the reason', async () => {
      const pending = await service.submit(submission(), EDUCATOR_ID);

      const result = await service.reject(
        pending.id,
        REVIEWER_ID,
        'Imagem inadequada.',
      );

      expect(result).toMatchObject({
        status: ExerciseStatus.REJECTED,
        reviewedById: REVIEWER_ID,
        rejectionReason: 'Imagem inadequada.',
      });
      await expect(service.findMany({})).resolves.toEqual([]);
    });

    it('UT-025 refuses to reject an already-approved exercise with 409', async () => {
      const [approved] = seedExercises({ status: ExerciseStatus.APPROVED });

      const attempt = service.reject(approved.id, REVIEWER_ID);

      await expect(attempt).rejects.toBeInstanceOf(AppError);
      await expect(attempt).rejects.toMatchObject({
        status: 409,
        message: 'Exercício já está aprovado.',
      });
      expect(approved.status).toBe(ExerciseStatus.APPROVED);
    });

    it('refuses to approve an already-rejected exercise with 409', async () => {
      const [rejected] = seedExercises({ status: ExerciseStatus.REJECTED });

      await expect(
        service.approve(rejected.id, REVIEWER_ID),
      ).rejects.toMatchObject({
        status: 409,
        message: 'Exercício já foi rejeitado.',
      });
    });

    it('answers 404 when deciding a missing exercise', async () => {
      await expect(
        service.approve('missing-id', REVIEWER_ID),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        service.reject('missing-id', REVIEWER_ID),
      ).rejects.toMatchObject({ status: 404 });
    });
  });

  describe('backoffice direct management', () => {
    it('UT-026 createDirect publishes immediately as APPROVED', async () => {
      const result = await service.createDirect(submission(), REVIEWER_ID);

      expect(result.status).toBe(ExerciseStatus.APPROVED);
      expect(result.submittedById).toBeNull();
      const visible = await service.findMany({});
      expect(visible.map((exercise) => exercise.id)).toEqual([result.id]);
    });

    it('UT-027 update changes name/description/equipment/contraindications', async () => {
      const [exercise] = seedExercises({ name: 'Bench Press' });

      await service.update(exercise.id, {
        name: 'Supino reto',
        description: 'Descrição traduzida.',
        equipment: ExerciseEquipment.HOME_BASIC,
        contraindications: [ExerciseContraindication.SHOULDER],
      });

      await expect(service.findById(exercise.id)).resolves.toMatchObject({
        name: 'Supino reto',
        description: 'Descrição traduzida.',
        equipment: ExerciseEquipment.HOME_BASIC,
        contraindications: [ExerciseContraindication.SHOULDER],
      });
    });

    it('UT-028 remove makes the exercise disappear from findMany and findById', async () => {
      const [exercise] = seedExercises({});

      await service.remove(exercise.id);

      await expect(service.findMany({})).resolves.toEqual([]);
      await expect(service.findById(exercise.id)).rejects.toMatchObject({
        status: 404,
      });
    });

    it('UT-029 update rejects a blank name with 400 and writes nothing', async () => {
      const [exercise] = seedExercises({ name: 'Supino reto' });

      const attempt = service.update(exercise.id, { name: '' });

      await expect(attempt).rejects.toBeInstanceOf(AppError);
      await expect(attempt).rejects.toMatchObject({
        status: 400,
        message: 'O nome do exercício é obrigatório.',
      });
      expect(repository.update).not.toHaveBeenCalled();
      expect(exercise.name).toBe('Supino reto');
    });

    it('update and remove answer 404 for a missing exercise', async () => {
      await expect(
        service.update('missing-id', { name: 'X' }),
      ).rejects.toMatchObject({ status: 404 });
      await expect(service.remove('missing-id')).rejects.toMatchObject({
        status: 404,
      });
      expect(repository.delete).not.toHaveBeenCalled();
    });
  });
});
