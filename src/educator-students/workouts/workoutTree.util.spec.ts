import { MUSCLE_GROUPS } from './workoutLimits.constants';
import {
  computeConflicts,
  effectiveVideoUrl,
  sessionLabel,
  toCopyTree,
  validateActivatable,
  CopySource,
} from './workoutTree.util';

const item = (name: string, overrides = {}) => ({
  source: 'LIBRARY' as const,
  exerciseId: 'ex-1',
  name,
  muscleGroup: 'Peito',
  equipment: 'GYM' as const,
  sets: 3,
  reps: '8-12',
  load: '40 kg',
  videoUrl: null,
  ...overrides,
});

describe('workout tree utilities', () => {
  it('UT-011 keeps the muscle-group catalog equal to the seven agreed values', () => {
    expect([...MUSCLE_GROUPS]).toEqual([
      'Abdômen',
      'Braços',
      'Costas',
      'Ombros',
      'Panturrilhas',
      'Peito',
      'Pernas',
    ]);
  });

  describe('validateActivatable', () => {
    it('UT-012 accepts a tree whose sessions all have an exercise', () => {
      expect(
        validateActivatable({
          sessions: [
            { name: 'A', exercises: [item('Supino')] },
            { name: 'B', exercises: [item('Remada')] },
          ],
        }),
      ).toEqual([]);
    });

    it('UT-012 reports no sessions for an empty tree', () => {
      expect(validateActivatable({ sessions: [] })).toEqual([
        { code: 'no_sessions' },
      ]);
    });

    it('UT-012 names each session that has no exercise', () => {
      const problems = validateActivatable({
        sessions: [
          { name: 'Peito', exercises: [item('Supino')] },
          { name: 'Costas', exercises: [] },
          { name: 'Pernas', exercises: [] },
        ],
      });

      expect(problems).toEqual([
        { code: 'empty_session', sessionLabel: 'B', sessionName: 'Costas' },
        { code: 'empty_session', sessionLabel: 'C', sessionName: 'Pernas' },
      ]);
    });
  });

  describe('computeConflicts', () => {
    const library = (
      id: string,
      tags: Array<'KNEE' | 'SHOULDER' | 'SPINE'>,
    ) => ({
      id,
      contraindications: tags,
    });

    it('UT-013 returns the single intersecting restriction', () => {
      const result = computeConflicts(
        [library('a', ['KNEE', 'SPINE']), library('b', ['SHOULDER'])],
        ['KNEE'],
      );

      expect(Object.fromEntries(result)).toEqual({ a: ['KNEE'] });
    });

    it('UT-013 returns both when two restrictions intersect', () => {
      const result = computeConflicts(
        [library('a', ['KNEE', 'SPINE'])],
        ['SPINE', 'KNEE', 'SHOULDER'],
      );

      expect(result.get('a')).toEqual(['SPINE', 'KNEE']);
    });

    it('UT-013 returns none when nothing intersects or the student has no restrictions', () => {
      expect(
        computeConflicts([library('a', ['KNEE'])], ['SHOULDER']).size,
      ).toBe(0);
      expect(computeConflicts([library('a', ['KNEE'])], []).size).toBe(0);
    });

    it('UT-013 ignores free items and items without a live reference', () => {
      const result = computeConflicts(
        [
          { id: 'free', contraindications: null },
          { id: 'orphan', contraindications: undefined },
          library('live', ['KNEE']),
        ],
        ['KNEE'],
      );

      expect([...result.keys()]).toEqual(['live']);
    });
  });

  describe('toCopyTree', () => {
    const source: CopySource = {
      title: 'Hipertrofia',
      weeklyFrequency: 4,
      sessions: [
        {
          name: 'Peito',
          exercises: [
            { id: 'old-1', ...item('Supino') },
            { id: 'old-2', ...item('Crucifixo', { exerciseId: null }) },
          ],
        },
        { name: 'Costas', exercises: [] },
      ],
    };

    it('UT-014 drops ids, is a draft, and keeps order and values', () => {
      const copy = toCopyTree(source);

      expect(copy.status).toBe('DRAFT');
      expect(copy.title).toBe('Hipertrofia');
      expect(copy.weeklyFrequency).toBe(4);
      expect(JSON.stringify(copy)).not.toContain('old-');
      expect(copy.sessions.map((s) => s.name)).toEqual(['Peito', 'Costas']);
      expect(copy.sessions[0].exercises.map((e) => e.name)).toEqual([
        'Supino',
        'Crucifixo',
      ]);
      expect(copy.sessions[0].exercises[0]).toMatchObject({
        sets: 3,
        reps: '8-12',
        load: '40 kg',
      });
    });

    it('UT-014 appends the copy suffix only when asked', () => {
      expect(toCopyTree(source, true).title).toBe('Hipertrofia (cópia)');
      expect(toCopyTree(source, false).title).toBe('Hipertrofia');
    });

    it('UT-050 keeps the saved name of an item whose library reference was cleared', () => {
      const copy = toCopyTree(source);

      expect(copy.sessions[0].exercises[1]).toMatchObject({
        exerciseId: null,
        name: 'Crucifixo',
        muscleGroup: 'Peito',
      });
    });
  });

  it('UT-015 derives session labels from position', () => {
    const moved = ['C', 'A', 'B'].map((_, position) => sessionLabel(position));

    expect(moved).toEqual(['A', 'B', 'C']);
    expect(sessionLabel(6)).toBe('G');
  });

  describe('effectiveVideoUrl', () => {
    it('UT-016 prefers the educator link', () => {
      expect(
        effectiveVideoUrl({
          videoUrl: 'https://youtu.be/x',
          exercise: { videoUrl: 'https://lib/y' },
        }),
      ).toBe('https://youtu.be/x');
    });

    it('UT-016 falls back to the library video while the reference exists', () => {
      expect(
        effectiveVideoUrl({
          videoUrl: null,
          exercise: { videoUrl: 'https://lib/y' },
        }),
      ).toBe('https://lib/y');
    });

    it('UT-016 is null with no link and no library video, or a cleared reference', () => {
      expect(
        effectiveVideoUrl({ videoUrl: null, exercise: { videoUrl: null } }),
      ).toBeNull();
      expect(effectiveVideoUrl({ videoUrl: null, exercise: null })).toBeNull();
    });
  });
});
