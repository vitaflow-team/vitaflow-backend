import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { EducatorWorkoutsRepository } from '@/repositories/educator-workouts/educatorWorkouts.repository';
import { ExercisesRepository } from '@/repositories/exercise-library/exercises.repository';
import { FitnessProfileRepository } from '@/repositories/fitness-profile/fitnessProfile.repository';
import { SaveWorkoutDTO } from './dto/saveWorkout.Dto';
import { WorkoutNotificationsService } from './workoutNotifications.service';
import { EducatorWorkoutsService } from './workouts.service';

const EDUCATOR = '01890a5d-ac96-774b-bcce-b302099a8001';
const STUDENT = '01890a5d-ac96-774b-bcce-b302099a8002';
const OTHER_STUDENT = '01890a5d-ac96-774b-bcce-b302099a8003';
const WORKOUT = '01890a5d-ac96-774b-bcce-b302099a8004';
const LIB_ID = '01890a5d-ac96-774b-bcce-b302099a8005';

const NOW = new Date('2026-10-04T12:00:00.000Z');

function client(overrides: object = {}) {
  return {
    id: STUDENT,
    name: 'Diego',
    email: 'diego@exemplo.com',
    phone: '',
    userId: 'user-1',
    birthDate: null,
    professionalId: EDUCATOR,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function exerciseRow(id: string, overrides: object = {}) {
  return {
    id,
    sessionId: 's1',
    position: 0,
    source: 'LIBRARY',
    exerciseId: LIB_ID,
    name: 'Supino',
    muscleGroup: 'Peito',
    equipment: 'GYM',
    sets: 3,
    reps: '8-12',
    load: null,
    videoUrl: null,
    exercise: { videoUrl: 'https://lib/v', contraindications: ['SHOULDER'] },
    ...overrides,
  };
}

function tree(overrides: object = {}, sessions?: unknown[]) {
  return {
    id: WORKOUT,
    clientId: STUDENT,
    title: 'Treino',
    weeklyFrequency: 4,
    status: 'DRAFT',
    lastEditNotifiedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    sessions: sessions ?? [
      {
        id: 's1',
        workoutId: WORKOUT,
        name: 'Peito',
        position: 0,
        exercises: [exerciseRow('e1')],
      },
      {
        id: 's2',
        workoutId: WORKOUT,
        name: 'Costas',
        position: 1,
        exercises: [exerciseRow('e2', { sessionId: 's2' })],
      },
    ],
    ...overrides,
  };
}

const clients = { findOwnedById: jest.fn(), findOwnedByIds: jest.fn() };
const workouts = {
  listSummariesByClient: jest.fn(),
  createDraft: jest.fn(),
  findOwnedTree: jest.fn(),
  applyTree: jest.fn(),
  activate: jest.fn(),
  deactivate: jest.fn(),
  delete: jest.fn(),
  copyToClients: jest.fn(),
};
const exercises = { findApprovedByIds: jest.fn() };
const profiles = { findByUserId: jest.fn() };
const notifications = { notifyActivated: jest.fn(), notifyEdited: jest.fn() };

function saveDto(overrides: object = {}): SaveWorkoutDTO {
  return {
    title: 'Treino',
    weeklyFrequency: 4,
    sessions: [
      {
        id: 's1',
        name: 'Peito',
        exercises: [
          {
            id: 'e1',
            source: 'LIBRARY',
            exerciseId: LIB_ID,
            sets: 3,
            reps: '8',
          },
        ],
      },
    ],
    ...overrides,
  } as unknown as SaveWorkoutDTO;
}

describe('EducatorWorkoutsService', () => {
  let service: EducatorWorkoutsService;

  beforeEach(() => {
    jest.resetAllMocks();
    clients.findOwnedById.mockImplementation((id: string) =>
      Promise.resolve(id === STUDENT ? client() : null),
    );
    clients.findOwnedByIds.mockImplementation((ids: string[]) =>
      Promise.resolve(
        ids.filter((id) => id !== 'foreign').map((id) => client({ id })),
      ),
    );
    workouts.findOwnedTree.mockImplementation((id: string) =>
      Promise.resolve(id === WORKOUT ? tree() : null),
    );
    workouts.applyTree.mockResolvedValue(tree());
    workouts.activate.mockResolvedValue(true);
    workouts.deactivate.mockResolvedValue(true);
    workouts.copyToClients.mockImplementation(
      (copies: Array<{ clientId: string }>) =>
        Promise.resolve(
          copies.map((c) => ({
            clientId: c.clientId,
            workoutId: `copy-${c.clientId}`,
          })),
        ),
    );
    exercises.findApprovedByIds.mockResolvedValue([
      {
        id: LIB_ID,
        name: 'Supino reto',
        muscleGroup: 'Peito',
        equipment: 'GYM',
        contraindications: ['SHOULDER'],
      },
    ]);
    profiles.findByUserId.mockResolvedValue({ restrictions: [] });
    notifications.notifyActivated.mockResolvedValue(undefined);
    notifications.notifyEdited.mockResolvedValue(undefined);
    service = new EducatorWorkoutsService(
      clients as unknown as ClientsRepository,
      workouts as unknown as EducatorWorkoutsRepository,
      exercises as unknown as ExercisesRepository,
      profiles as unknown as FitnessProfileRepository,
      notifications as unknown as WorkoutNotificationsService,
    );
  });

  const summary = (id: string, status: string) => ({
    id,
    title: id,
    status,
    weeklyFrequency: null,
    sessionCount: 2,
    exerciseCount: 5,
    updatedAt: NOW,
  });

  describe('list', () => {
    it('UT-017 returns the active workout, the drafts and a page of the archived', async () => {
      workouts.listSummariesByClient.mockResolvedValue({
        active: summary('a', 'ACTIVE'),
        drafts: [summary('d1', 'DRAFT')],
        archived: { items: [summary('x1', 'ARCHIVED')], total: 45 },
      });

      const result = await service.list(EDUCATOR, STUDENT, 3);

      expect(workouts.listSummariesByClient).toHaveBeenCalledWith(
        STUDENT,
        40,
        20,
      );
      expect(result.active).toMatchObject({
        id: 'a',
        sessionCount: 2,
        exerciseCount: 5,
      });
      expect(result.drafts).toHaveLength(1);
      expect(result.archived).toMatchObject({
        total: 45,
        page: 3,
        pageSize: 20,
      });
    });

    it('UT-018 returns an empty shape for a student with no workouts', async () => {
      workouts.listSummariesByClient.mockResolvedValue({
        active: null,
        drafts: [],
        archived: { items: [], total: 0 },
      });

      expect(await service.list(EDUCATOR, STUDENT)).toEqual({
        active: null,
        drafts: [],
        archived: { items: [], total: 0, page: 1, pageSize: 20 },
      });
    });

    it('UT-022 keeps the total for a page beyond the last', async () => {
      workouts.listSummariesByClient.mockResolvedValue({
        active: null,
        drafts: [],
        archived: { items: [], total: 45 },
      });

      const result = await service.list(EDUCATOR, STUDENT, 9);

      expect(result.archived).toMatchObject({ items: [], total: 45, page: 9 });
    });

    it('UT-019 answers a foreign or missing student with 404 student_not_found', async () => {
      await expect(service.list(EDUCATOR, OTHER_STUDENT)).rejects.toMatchObject(
        {
          status: 404,
          code: 'student_not_found',
        },
      );
    });
  });

  describe('create', () => {
    it('UT-020 creates a draft with no sessions', async () => {
      workouts.createDraft.mockResolvedValue(tree({ sessions: [] }, []));

      const result = await service.create(EDUCATOR, STUDENT, {
        title: 'Novo',
        weeklyFrequency: 3,
      });

      expect(workouts.createDraft).toHaveBeenCalledWith(STUDENT, {
        title: 'Novo',
        weeklyFrequency: 3,
      });
      expect(result).toMatchObject({ status: 'DRAFT', sessions: [] });
    });
  });

  it('UT-021 answers 404 and writes nothing for a student the educator does not own', async () => {
    const calls = [
      () => service.create(EDUCATOR, OTHER_STUDENT, { title: 'x' }),
      () => service.save(EDUCATOR, OTHER_STUDENT, WORKOUT, saveDto()),
      () => service.activate(EDUCATOR, OTHER_STUDENT, WORKOUT),
      () =>
        service.duplicate(EDUCATOR, OTHER_STUDENT, WORKOUT, {
          studentIds: [STUDENT],
        }),
    ];

    for (const call of calls) {
      await expect(call()).rejects.toMatchObject({ status: 404 });
    }
    expect(workouts.createDraft).not.toHaveBeenCalled();
    expect(workouts.applyTree).not.toHaveBeenCalled();
    expect(workouts.activate).not.toHaveBeenCalled();
    expect(workouts.copyToClients).not.toHaveBeenCalled();
  });

  describe('get', () => {
    it('UT-023 returns labeled sessions, library videos and conflicts', async () => {
      profiles.findByUserId.mockResolvedValue({ restrictions: ['SHOULDER'] });

      const result = await service.get(EDUCATOR, STUDENT, WORKOUT);

      expect(result.sessions.map((s) => s.label)).toEqual(['A', 'B']);
      expect(result.sessions[0].exercises[0]).toMatchObject({
        libraryVideoUrl: 'https://lib/v',
        conflicts: ['SHOULDER'],
      });
    });

    it('UT-023 answers a workout of another record with 404 workout_not_found', async () => {
      await expect(
        service.get(EDUCATOR, STUDENT, 'someone-elses'),
      ).rejects.toMatchObject({ status: 404, code: 'workout_not_found' });
    });

    it('UT-033 answers a foreign or missing workout on save with 404 and writes nothing', async () => {
      await expect(
        service.save(EDUCATOR, STUDENT, 'foreign', saveDto()),
      ).rejects.toMatchObject({ status: 404 });
      expect(workouts.applyTree).not.toHaveBeenCalled();
    });

    it('UT-052 computes conflicts from the current profile on every read', async () => {
      profiles.findByUserId.mockResolvedValueOnce({ restrictions: [] });
      profiles.findByUserId.mockResolvedValueOnce({
        restrictions: ['SHOULDER'],
      });

      const first = await service.get(EDUCATOR, STUDENT, WORKOUT);
      const second = await service.get(EDUCATOR, STUDENT, WORKOUT);

      expect(first.sessions[0].exercises[0].conflicts).toEqual([]);
      expect(second.sessions[0].exercises[0].conflicts).toEqual(['SHOULDER']);
    });

    it('UT-051 reports no conflicts for a record without an account or profile, or an unreadable profile', async () => {
      clients.findOwnedById.mockResolvedValue(client({ userId: null }));
      expect(
        (await service.get(EDUCATOR, STUDENT, WORKOUT)).sessions[0].exercises[0]
          .conflicts,
      ).toEqual([]);
      expect(profiles.findByUserId).not.toHaveBeenCalled();

      clients.findOwnedById.mockResolvedValue(client());
      profiles.findByUserId.mockResolvedValue(null);
      expect(
        (await service.get(EDUCATOR, STUDENT, WORKOUT)).sessions[0].exercises[0]
          .conflicts,
      ).toEqual([]);

      profiles.findByUserId.mockRejectedValue(new Error('db down'));
      expect(
        (await service.get(EDUCATOR, STUDENT, WORKOUT)).sessions[0].exercises[0]
          .conflicts,
      ).toEqual([]);
    });

    it('reports a library item whose reference was cleared as a free item with its saved name', async () => {
      workouts.findOwnedTree.mockResolvedValue(
        tree({}, [
          {
            id: 's1',
            workoutId: WORKOUT,
            name: 'Peito',
            position: 0,
            exercises: [
              exerciseRow('e1', { exerciseId: null, exercise: null }),
            ],
          },
        ]),
      );

      const item = (await service.get(EDUCATOR, STUDENT, WORKOUT)).sessions[0]
        .exercises[0];

      expect(item).toMatchObject({
        source: 'FREE',
        name: 'Supino',
        muscleGroup: 'Peito',
        libraryVideoUrl: null,
        conflicts: [],
      });
    });
  });

  describe('save', () => {
    it('UT-024 accepts a draft with an empty session', async () => {
      const dto = saveDto({
        sessions: [{ id: 's1', name: 'Peito', exercises: [] }],
      });

      await expect(
        service.save(EDUCATOR, STUDENT, WORKOUT, dto),
      ).resolves.toBeDefined();
      expect(workouts.applyTree).toHaveBeenCalled();
    });

    it('UT-025 refuses an active workout with a session without exercises, writing nothing', async () => {
      workouts.findOwnedTree.mockResolvedValue(tree({ status: 'ACTIVE' }));
      const dto = saveDto({
        sessions: [{ id: 's1', name: 'Peito', exercises: [] }],
      });

      await expect(
        service.save(EDUCATOR, STUDENT, WORKOUT, dto),
      ).rejects.toMatchObject({ status: 422, code: 'workout_active_invalid' });
      expect(workouts.applyTree).not.toHaveBeenCalled();
    });

    it('UT-026 refuses an active workout with no sessions', async () => {
      workouts.findOwnedTree.mockResolvedValue(tree({ status: 'ACTIVE' }));

      await expect(
        service.save(EDUCATOR, STUDENT, WORKOUT, saveDto({ sessions: [] })),
      ).rejects.toMatchObject({ status: 422, code: 'workout_active_invalid' });
      expect(workouts.applyTree).not.toHaveBeenCalled();
    });

    it('UT-027 applies a valid tree of the active workout and returns it', async () => {
      workouts.findOwnedTree.mockResolvedValue(tree({ status: 'ACTIVE' }));
      workouts.applyTree.mockResolvedValue(tree({ status: 'ACTIVE' }));

      const result = await service.save(EDUCATOR, STUDENT, WORKOUT, saveDto());

      expect(workouts.applyTree).toHaveBeenCalledTimes(1);
      expect(result.status).toBe('ACTIVE');
    });

    it('UT-028 refuses ids that belong to another workout, writing nothing', async () => {
      const foreignSession = saveDto({
        sessions: [{ id: 'other-session', name: 'x', exercises: [] }],
      });
      const foreignExercise = saveDto({
        sessions: [
          {
            id: 's1',
            name: 'x',
            exercises: [
              {
                id: 'other-exercise',
                source: 'FREE',
                name: 'a',
                muscleGroup: 'Peito',
                sets: 1,
                reps: '1',
              },
            ],
          },
        ],
      });

      for (const dto of [foreignSession, foreignExercise]) {
        await expect(
          service.save(EDUCATOR, STUDENT, WORKOUT, dto),
        ).rejects.toMatchObject({ status: 400, code: 'foreign_item_id' });
      }
      expect(workouts.applyTree).not.toHaveBeenCalled();
    });

    it('UT-028 refuses the same id listed twice', async () => {
      const dto = saveDto({
        sessions: [
          { id: 's1', name: 'a', exercises: [] },
          { id: 's1', name: 'b', exercises: [] },
        ],
      });

      await expect(
        service.save(EDUCATOR, STUDENT, WORKOUT, dto),
      ).rejects.toMatchObject({ code: 'foreign_item_id' });
    });

    it('UT-029 hands the repository the ids to keep, new items without id, in request order', async () => {
      const dto = saveDto({
        sessions: [
          {
            id: 's2',
            name: 'Costas',
            exercises: [
              {
                id: 'e2',
                source: 'LIBRARY',
                exerciseId: LIB_ID,
                sets: 3,
                reps: '8',
              },
              {
                source: 'FREE',
                name: 'Prancha',
                muscleGroup: 'Abdômen',
                sets: 2,
                reps: '30s',
              },
            ],
          },
          { name: 'Nova', exercises: [] },
        ],
      });

      await service.save(EDUCATOR, STUDENT, WORKOUT, dto);

      const applied = workouts.applyTree.mock.calls[0][1];
      expect(applied.sessions.map((s: { id?: string }) => s.id)).toEqual([
        's2',
        undefined,
      ]);
      expect(
        applied.sessions[0].exercises.map((e: { id?: string }) => e.id),
      ).toEqual(['e2', undefined]);
    });

    it('UT-030 copies name and muscle group from the approved library exercise', async () => {
      await service.save(EDUCATOR, STUDENT, WORKOUT, saveDto());

      expect(
        workouts.applyTree.mock.calls[0][1].sessions[0].exercises[0],
      ).toMatchObject({
        exerciseId: LIB_ID,
        name: 'Supino reto',
        muscleGroup: 'Peito',
        equipment: 'GYM',
      });
    });

    it('UT-030 refuses an unknown or not approved library exercise with 400', async () => {
      exercises.findApprovedByIds.mockResolvedValue([]);

      await expect(
        service.save(EDUCATOR, STUDENT, WORKOUT, saveDto()),
      ).rejects.toMatchObject({
        status: 400,
        code: 'invalid_library_exercise',
      });
      expect(workouts.applyTree).not.toHaveBeenCalled();
    });

    it('UT-032 asks for the notification only after saving the active workout', async () => {
      workouts.findOwnedTree.mockResolvedValue(tree({ status: 'ACTIVE' }));
      workouts.applyTree.mockResolvedValue(tree({ status: 'ACTIVE' }));
      await service.save(EDUCATOR, STUDENT, WORKOUT, saveDto());
      expect(notifications.notifyEdited).toHaveBeenCalledWith(
        EDUCATOR,
        STUDENT,
        WORKOUT,
      );

      notifications.notifyEdited.mockClear();
      for (const status of ['DRAFT', 'ARCHIVED']) {
        workouts.findOwnedTree.mockResolvedValue(tree({ status }));
        workouts.applyTree.mockResolvedValue(tree({ status }));
        await service.save(EDUCATOR, STUDENT, WORKOUT, saveDto());
      }
      expect(notifications.notifyEdited).not.toHaveBeenCalled();
    });
  });

  describe('activate', () => {
    const complete = () =>
      workouts.findOwnedTree.mockResolvedValue(tree({ status: 'DRAFT' }));

    it('UT-034 activates a valid draft through one repository operation', async () => {
      complete();

      await service.activate(EDUCATOR, STUDENT, WORKOUT);

      expect(workouts.activate).toHaveBeenCalledWith(STUDENT, WORKOUT);
      expect(notifications.notifyActivated).toHaveBeenCalledWith(
        EDUCATOR,
        STUDENT,
        WORKOUT,
      );
    });

    it('UT-035 refuses a workout with empty sessions, naming them, and changes nothing', async () => {
      workouts.findOwnedTree.mockResolvedValue(
        tree({}, [
          {
            id: 's1',
            workoutId: WORKOUT,
            name: 'Peito',
            position: 0,
            exercises: [],
          },
        ]),
      );

      const error = (await service
        .activate(EDUCATOR, STUDENT, WORKOUT)
        .catch((e: unknown) => e)) as { details?: unknown };

      expect(error).toMatchObject({
        status: 422,
        code: 'workout_not_activatable',
      });
      expect(error.details).toEqual([
        { code: 'empty_session', sessionLabel: 'A', sessionName: 'Peito' },
      ]);
      expect(workouts.activate).not.toHaveBeenCalled();
    });

    it('UT-036 does nothing for the already active workout', async () => {
      workouts.findOwnedTree.mockResolvedValue(tree({ status: 'ACTIVE' }));

      await service.activate(EDUCATOR, STUDENT, WORKOUT);

      expect(workouts.activate).not.toHaveBeenCalled();
      expect(notifications.notifyActivated).not.toHaveBeenCalled();
    });

    it('UT-037 activates an archived workout as stored', async () => {
      workouts.findOwnedTree.mockResolvedValue(tree({ status: 'ARCHIVED' }));

      await service.activate(EDUCATOR, STUDENT, WORKOUT);

      expect(workouts.activate).toHaveBeenCalledWith(STUDENT, WORKOUT);
      expect(workouts.applyTree).not.toHaveBeenCalled();
    });

    it('UT-038 answers a missing, foreign or deleted workout with 404', async () => {
      await expect(
        service.activate(EDUCATOR, STUDENT, 'gone'),
      ).rejects.toMatchObject({ status: 404, code: 'workout_not_found' });
    });

    it('UT-039 propagates a failed activation and sends no notification', async () => {
      complete();
      workouts.activate.mockRejectedValue(new Error('boom'));

      await expect(
        service.activate(EDUCATOR, STUDENT, WORKOUT),
      ).rejects.toThrow('boom');
      expect(notifications.notifyActivated).not.toHaveBeenCalled();
    });

    it('UT-040 activates for a record without an account (the notifier decides to send nothing)', async () => {
      complete();
      clients.findOwnedById.mockResolvedValue(client({ userId: null }));

      await expect(
        service.activate(EDUCATOR, STUDENT, WORKOUT),
      ).resolves.toBeDefined();
      expect(workouts.activate).toHaveBeenCalled();
    });
  });

  describe('deactivate and remove', () => {
    it('UT-041 archives the active workout without notifying', async () => {
      workouts.findOwnedTree.mockResolvedValue(tree({ status: 'ACTIVE' }));

      await service.deactivate(EDUCATOR, STUDENT, WORKOUT);

      expect(workouts.deactivate).toHaveBeenCalledWith(WORKOUT);
      expect(notifications.notifyActivated).not.toHaveBeenCalled();
      expect(notifications.notifyEdited).not.toHaveBeenCalled();
    });

    it('UT-041 does nothing for a workout that is not active', async () => {
      await service.deactivate(EDUCATOR, STUDENT, WORKOUT);

      expect(workouts.deactivate).not.toHaveBeenCalled();
    });

    it('UT-042 deletes a draft or archived workout and refuses the active one', async () => {
      for (const status of ['DRAFT', 'ARCHIVED']) {
        workouts.findOwnedTree.mockResolvedValue(tree({ status }));
        await service.remove(EDUCATOR, STUDENT, WORKOUT);
      }
      expect(workouts.delete).toHaveBeenCalledTimes(2);

      workouts.delete.mockClear();
      workouts.findOwnedTree.mockResolvedValue(tree({ status: 'ACTIVE' }));
      await expect(
        service.remove(EDUCATOR, STUDENT, WORKOUT),
      ).rejects.toMatchObject({ status: 409, code: 'workout_is_active' });
      expect(workouts.delete).not.toHaveBeenCalled();

      workouts.findOwnedTree.mockResolvedValue(null);
      await expect(
        service.remove(EDUCATOR, STUDENT, 'foreign'),
      ).rejects.toMatchObject({ status: 404 });
    });

    it('UT-043 answers a second delete of the same workout with 404', async () => {
      workouts.findOwnedTree.mockResolvedValue(null);

      await expect(
        service.remove(EDUCATOR, STUDENT, WORKOUT),
      ).rejects.toMatchObject({ status: 404, code: 'workout_not_found' });
    });
  });

  describe('duplicate', () => {
    it('UT-044 creates a draft for each of two own students, with no notification', async () => {
      const result = await service.duplicate(EDUCATOR, STUDENT, WORKOUT, {
        studentIds: ['t1', 't2'],
      });

      expect(result.copies.map((c) => c.studentId)).toEqual(['t1', 't2']);
      expect(workouts.copyToClients.mock.calls[0][0]).toHaveLength(2);
      expect(workouts.copyToClients.mock.calls[0][0][0].tree.status).toBe(
        'DRAFT',
      );
      expect(notifications.notifyActivated).not.toHaveBeenCalled();
      expect(notifications.notifyEdited).not.toHaveBeenCalled();
    });

    it('UT-045 suffixes the title only for the copy to the source student', async () => {
      await service.duplicate(EDUCATOR, STUDENT, WORKOUT, {
        studentIds: [STUDENT, 't2'],
      });

      const [toSelf, toOther] = workouts.copyToClients.mock.calls[0][0];
      expect(toSelf.tree.title).toBe('Treino (cópia)');
      expect(toOther.tree.title).toBe('Treino');
    });

    it('UT-046 accepts 20 targets and refuses 21 with duplicate_limit', async () => {
      const ids = (n: number) => Array.from({ length: n }, (_, i) => `t${i}`);

      await expect(
        service.duplicate(EDUCATOR, STUDENT, WORKOUT, { studentIds: ids(20) }),
      ).resolves.toBeDefined();
      await expect(
        service.duplicate(EDUCATOR, STUDENT, WORKOUT, { studentIds: ids(21) }),
      ).rejects.toMatchObject({ status: 400, code: 'duplicate_limit' });
    });

    it('UT-047 creates one copy when a student is listed twice', async () => {
      await service.duplicate(EDUCATOR, STUDENT, WORKOUT, {
        studentIds: ['t1', 't1'],
      });

      expect(workouts.copyToClients.mock.calls[0][0]).toHaveLength(1);
    });

    it('UT-048 refuses the whole request when a target is not the educator student', async () => {
      await expect(
        service.duplicate(EDUCATOR, STUDENT, WORKOUT, {
          studentIds: ['t1', 'foreign'],
        }),
      ).rejects.toMatchObject({
        status: 404,
        code: 'duplicate_targets_invalid',
      });
      expect(workouts.copyToClients).not.toHaveBeenCalled();
    });

    it('UT-049 answers a missing or foreign source with 404 and creates nothing', async () => {
      await expect(
        service.duplicate(EDUCATOR, STUDENT, 'foreign', { studentIds: ['t1'] }),
      ).rejects.toMatchObject({ status: 404 });
      expect(workouts.copyToClients).not.toHaveBeenCalled();
    });

    it('UT-050 keeps the saved name of an item whose library reference was cleared', async () => {
      workouts.findOwnedTree.mockResolvedValue(
        tree({}, [
          {
            id: 's1',
            workoutId: WORKOUT,
            name: 'Peito',
            position: 0,
            exercises: [
              exerciseRow('e1', { exerciseId: null, exercise: null }),
            ],
          },
        ]),
      );

      await service.duplicate(EDUCATOR, STUDENT, WORKOUT, {
        studentIds: ['t1'],
      });

      expect(
        workouts.copyToClients.mock.calls[0][0][0].tree.sessions[0]
          .exercises[0],
      ).toMatchObject({
        name: 'Supino',
        muscleGroup: 'Peito',
        exerciseId: null,
      });
    });
  });

  describe('conflicts', () => {
    it('UT-051 returns only the restrictions that intersect the student profile', async () => {
      profiles.findByUserId.mockResolvedValue({
        restrictions: ['SHOULDER', 'KNEE'],
      });
      exercises.findApprovedByIds.mockResolvedValue([
        { id: 'a', contraindications: ['SHOULDER', 'SPINE'] },
        { id: 'b', contraindications: ['WRIST'] },
      ]);

      const result = await service.conflicts(EDUCATOR, STUDENT, {
        exerciseIds: ['a', 'b'],
      });

      expect(result).toEqual({ conflicts: { a: ['SHOULDER'] } });
    });

    it('UT-051 returns none without an account, without a profile, or when the profile read fails', async () => {
      clients.findOwnedById.mockResolvedValue(client({ userId: null }));
      expect(
        await service.conflicts(EDUCATOR, STUDENT, { exerciseIds: ['a'] }),
      ).toEqual({ conflicts: {} });

      clients.findOwnedById.mockResolvedValue(client());
      profiles.findByUserId.mockResolvedValue(null);
      expect(
        await service.conflicts(EDUCATOR, STUDENT, { exerciseIds: ['a'] }),
      ).toEqual({ conflicts: {} });

      profiles.findByUserId.mockRejectedValue(new Error('down'));
      expect(
        await service.conflicts(EDUCATOR, STUDENT, { exerciseIds: ['a'] }),
      ).toEqual({ conflicts: {} });
    });

    it('UT-052 evaluates a duplicated workout against the target student profile', async () => {
      clients.findOwnedById.mockImplementation((id: string) =>
        Promise.resolve(
          client({ id, userId: id === STUDENT ? 'user-1' : 'user-2' }),
        ),
      );
      profiles.findByUserId.mockImplementation((userId: string) =>
        Promise.resolve({
          restrictions: userId === 'user-2' ? ['SHOULDER'] : [],
        }),
      );
      workouts.findOwnedTree.mockResolvedValue(tree());

      const own = await service.get(EDUCATOR, STUDENT, WORKOUT);
      const target = await service.get(EDUCATOR, OTHER_STUDENT, WORKOUT);

      expect(own.sessions[0].exercises[0].conflicts).toEqual([]);
      expect(target.sessions[0].exercises[0].conflicts).toEqual(['SHOULDER']);
    });
  });
});
