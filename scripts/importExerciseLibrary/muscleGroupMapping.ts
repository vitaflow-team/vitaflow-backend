// Headline muscle group (shown and filtered in Portuguese, e.g. "Peito") for
// each muscle of the dataset's `muscles` list, following the dataset's own
// `muscle_groups` grouping. The individual muscles are imported untranslated
// into primaryMuscles/secondaryMuscles.
export const MUSCLE_GROUP_BY_MUSCLE: Record<string, string> = {
  forearms: 'Braços',
  biceps: 'Braços',
  triceps: 'Braços',
  brachialis: 'Braços',
  neck: 'Costas',
  traps: 'Costas',
  lats: 'Costas',
  'lower back': 'Costas',
  'middle back': 'Costas',
  calves: 'Panturrilhas',
  soleus: 'Panturrilhas',
  chest: 'Peito',
  'serratus anterior': 'Peito',
  abs: 'Abdômen',
  obliques: 'Abdômen',
  abductors: 'Pernas',
  adductors: 'Pernas',
  quads: 'Pernas',
  hamstrings: 'Pernas',
  glutes: 'Pernas',
  shoulders: 'Ombros',
};
