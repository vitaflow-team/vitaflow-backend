import { createValidationPipe } from '@/config/validationPipe';
import { ArgumentMetadata, BadRequestException } from '@nestjs/common';
import { ConflictsRequestDTO } from './conflictsRequest.Dto';
import { CreateWorkoutDTO } from './createWorkout.Dto';
import { DuplicateWorkoutDTO } from './duplicateWorkout.Dto';
import { ListWorkoutsQueryDTO } from './listWorkoutsQuery.Dto';
import { SaveWorkoutDTO } from './saveWorkout.Dto';

const pipe = createValidationPipe();
const UUID = '01890a5d-ac96-774b-bcce-b302099a8057';

function run<T>(
  metatype: new () => T,
  value: unknown,
  type: ArgumentMetadata['type'] = 'body',
): Promise<T> {
  return pipe.transform(value, { type, metatype }) as Promise<T>;
}

async function messages(attempt: Promise<unknown>): Promise<string> {
  const error = (await attempt.catch((e: unknown) => e)) as BadRequestException;
  expect(error).toBeInstanceOf(BadRequestException);
  const body = error.getResponse() as { message: string | string[] };
  return Array.isArray(body.message) ? body.message.join(' | ') : body.message;
}

const library = (extra: object = {}) => ({
  source: 'LIBRARY',
  exerciseId: UUID,
  sets: 3,
  reps: '8-12',
  ...extra,
});
const free = (extra: object = {}) => ({
  source: 'FREE',
  name: 'Prancha',
  muscleGroup: 'Abdômen',
  sets: 3,
  reps: '30s',
  ...extra,
});
const tree = (sessions: unknown[], extra: object = {}) => ({
  title: 'Treino',
  sessions,
  ...extra,
});
const oneSession = (exercises: unknown[]) => [{ name: 'A', exercises }];

describe('educator workout DTOs (through the app validation pipe)', () => {
  it('UT-001 validates and trims the title', async () => {
    for (const title of ['', '   ']) {
      expect(await messages(run(CreateWorkoutDTO, { title }))).toContain(
        'title',
      );
    }
    for (const title of ['A', 'a'.repeat(80)]) {
      await expect(run(CreateWorkoutDTO, { title })).resolves.toBeDefined();
    }
    expect(
      await messages(run(CreateWorkoutDTO, { title: 'a'.repeat(81) })),
    ).toContain('title');
    expect((await run(CreateWorkoutDTO, { title: '  Treino  ' })).title).toBe(
      'Treino',
    );
  });

  it('UT-002 validates the weekly frequency', async () => {
    await expect(run(CreateWorkoutDTO, { title: 'T' })).resolves.toBeDefined();
    for (const weeklyFrequency of [1, 7]) {
      await expect(
        run(CreateWorkoutDTO, { title: 'T', weeklyFrequency }),
      ).resolves.toBeDefined();
    }
    for (const weeklyFrequency of [0, 8, 2.5, 'abc']) {
      expect(
        await messages(run(CreateWorkoutDTO, { title: 'T', weeklyFrequency })),
      ).toContain('weeklyFrequency');
    }
  });

  it('UT-003 validates the session name and keeps markup as plain text', async () => {
    for (const name of ['', '   ', 'a'.repeat(61)]) {
      expect(
        await messages(run(SaveWorkoutDTO, tree([{ name, exercises: [] }]))),
      ).toContain('name');
    }
    await expect(
      run(SaveWorkoutDTO, tree([{ name: 'a'.repeat(60), exercises: [] }])),
    ).resolves.toBeDefined();

    const markup = '<b>Peito</b> 😀';
    const saved = await run(
      SaveWorkoutDTO,
      tree([{ name: markup, exercises: [] }]),
    );
    expect(saved.sessions[0].name).toBe(markup);
  });

  it('UT-004 limits the sessions to seven and allows none for a draft', async () => {
    const session = (n: number) => ({ name: `S${n}`, exercises: [] });
    await expect(run(SaveWorkoutDTO, tree([]))).resolves.toBeDefined();
    await expect(
      run(
        SaveWorkoutDTO,
        tree(Array.from({ length: 7 }, (_, n) => session(n))),
      ),
    ).resolves.toBeDefined();
    expect(
      await messages(
        run(
          SaveWorkoutDTO,
          tree(Array.from({ length: 8 }, (_, n) => session(n))),
        ),
      ),
    ).toContain('sessions');
  });

  it('UT-005 limits the exercises of a session to thirty', async () => {
    const many = (n: number) => Array.from({ length: n }, () => library());
    await expect(
      run(SaveWorkoutDTO, tree(oneSession(many(30)))),
    ).resolves.toBeDefined();
    await expect(
      run(SaveWorkoutDTO, tree(oneSession([]))),
    ).resolves.toBeDefined();
    expect(
      await messages(run(SaveWorkoutDTO, tree(oneSession(many(31))))),
    ).toContain('exercises');
  });

  it('UT-006 validates the series', async () => {
    for (const sets of [1, 20]) {
      await expect(
        run(SaveWorkoutDTO, tree(oneSession([library({ sets })]))),
      ).resolves.toBeDefined();
    }
    for (const sets of [0, 21, 2.5, 'abc']) {
      expect(
        await messages(
          run(SaveWorkoutDTO, tree(oneSession([library({ sets })]))),
        ),
      ).toContain('sets');
    }
  });

  it('UT-007 validates the repetitions as short text', async () => {
    for (const reps of ['8-12', 'até a falha', 'a'.repeat(30)]) {
      await expect(
        run(SaveWorkoutDTO, tree(oneSession([library({ reps })]))),
      ).resolves.toBeDefined();
    }
    for (const reps of ['', 'a'.repeat(31)]) {
      expect(
        await messages(
          run(SaveWorkoutDTO, tree(oneSession([library({ reps })]))),
        ),
      ).toContain('reps');
    }
  });

  it('UT-008 validates the load', async () => {
    await expect(
      run(SaveWorkoutDTO, tree(oneSession([library()]))),
    ).resolves.toBeDefined();
    for (const load of ['40 kg', 'a'.repeat(30)]) {
      await expect(
        run(SaveWorkoutDTO, tree(oneSession([library({ load })]))),
      ).resolves.toBeDefined();
    }
    expect(
      await messages(
        run(
          SaveWorkoutDTO,
          tree(oneSession([library({ load: 'a'.repeat(31) })])),
        ),
      ),
    ).toContain('load');
  });

  it('UT-009 validates a free exercise, its muscle group and its equipment', async () => {
    const attempt = (item: object) =>
      run(SaveWorkoutDTO, tree(oneSession([item])));

    await expect(attempt(free())).resolves.toBeDefined();
    for (const bad of [
      free({ name: undefined }),
      free({ name: 'a'.repeat(81) }),
      free({ muscleGroup: undefined }),
      free({ muscleGroup: 'Cardio' }),
      free({ equipment: 'POOL' }),
    ]) {
      expect(await messages(attempt(bad))).toMatch(
        /name|muscleGroup|equipment/,
      );
    }
    for (const muscleGroup of [
      'Abdômen',
      'Braços',
      'Costas',
      'Ombros',
      'Panturrilhas',
      'Peito',
      'Pernas',
    ]) {
      await expect(attempt(free({ muscleGroup }))).resolves.toBeDefined();
    }
    await expect(attempt(free({ equipment: 'GYM' }))).resolves.toBeDefined();
  });

  it('UT-010 accepts only http and https video links without spaces', async () => {
    const attempt = (videoUrl: string) =>
      run(SaveWorkoutDTO, tree(oneSession([free({ videoUrl })])));

    for (const ok of ['https://youtu.be/x', 'http://exemplo.com/v']) {
      await expect(attempt(ok)).resolves.toBeDefined();
    }
    for (const bad of [
      'javascript:alert(1)',
      'file:///c:/v.mp4',
      'data:text/html,x',
      'ftp://x/v',
      'video com espaço',
      'abc',
    ]) {
      expect(await messages(attempt(bad))).toContain('videoUrl');
    }
    const longOk = `https://exemplo.com/${'a'.repeat(500 - 20)}`;
    expect(longOk).toHaveLength(500);
    await expect(attempt(longOk)).resolves.toBeDefined();
    expect(await messages(attempt(`${longOk}a`))).toContain('videoUrl');
  });

  it('reads a blank load or video link as not provided', async () => {
    const saved = await run(
      SaveWorkoutDTO,
      tree(oneSession([free({ load: '  ', videoUrl: '' })])),
    );

    expect(saved.sessions[0].exercises[0].load).toBeUndefined();
    expect(saved.sessions[0].exercises[0].videoUrl).toBeUndefined();
  });

  it('UT-022 rejects an archived page that is not a positive whole number', async () => {
    for (const archivedPage of ['0', '-1', '2.5', 'abc']) {
      expect(
        await messages(run(ListWorkoutsQueryDTO, { archivedPage }, 'query')),
      ).toContain('archivedPage');
    }
    expect(
      (await run(ListWorkoutsQueryDTO, { archivedPage: '3' }, 'query'))
        .archivedPage,
    ).toBe(3);
  });

  it('UT-046 requires at least one duplicate target and valid ids', async () => {
    expect(
      await messages(run(DuplicateWorkoutDTO, { studentIds: [] })),
    ).toContain('studentIds');
    expect(
      await messages(run(DuplicateWorkoutDTO, { studentIds: ['abc'] })),
    ).toContain('studentIds');
    await expect(
      run(DuplicateWorkoutDTO, { studentIds: [UUID] }),
    ).resolves.toBeDefined();
  });

  it('UT-053 rejects an empty list, non-UUID ids and more than 100 ids', async () => {
    expect(
      await messages(run(ConflictsRequestDTO, { exerciseIds: [] })),
    ).toContain('exerciseIds');
    expect(
      await messages(run(ConflictsRequestDTO, { exerciseIds: ['x'] })),
    ).toContain('exerciseIds');
    expect(
      await messages(
        run(ConflictsRequestDTO, {
          exerciseIds: Array.from({ length: 101 }, () => UUID),
        }),
      ),
    ).toContain('exerciseIds');
    await expect(
      run(ConflictsRequestDTO, {
        exerciseIds: Array.from({ length: 100 }, () => UUID),
      }),
    ).resolves.toBeDefined();
  });

  it('UT-073 rejects fields the DTOs do not declare', async () => {
    for (const extra of [
      { clientId: 'x' },
      { status: 'ACTIVE' },
      { lastEditNotifiedAt: '2026-01-01' },
    ]) {
      expect(
        await messages(run(CreateWorkoutDTO, { title: 'T', ...extra })),
      ).toMatch(/should not exist/);
    }
    expect(
      await messages(
        run(SaveWorkoutDTO, tree([{ name: 'A', exercises: [], position: 3 }])),
      ),
    ).toMatch(/should not exist/);
    expect(
      await messages(
        run(SaveWorkoutDTO, tree(oneSession([library({ position: 2 })]))),
      ),
    ).toMatch(/should not exist/);
  });
});
