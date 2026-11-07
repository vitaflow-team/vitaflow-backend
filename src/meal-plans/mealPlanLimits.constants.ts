// No existing precedent in the codebase defines a meal-text limit (ADR-006
// reuses food-diary's unstructured free-text shape, but food-diary's own
// `description` field has no configured max); these are this task's own,
// first-time configuration.
export const MEAL_TEXT_MAX_LENGTH = 1000;
export const MEAL_LABEL_MAX_LENGTH = 100;
export const MEALS_PER_DAY_MAX = 20;

// AI generation intake bounds (this task's own, first-time configuration —
// no existing nutrition precedent in the codebase to mirror).
export const MEALS_PER_DAY_MIN = 1;
export const TARGET_CALORIES_MIN = 800;
export const TARGET_CALORIES_MAX = 6000;
