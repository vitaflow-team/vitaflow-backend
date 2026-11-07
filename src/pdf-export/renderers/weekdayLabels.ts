import { Weekday } from '@prisma/client';

// Portuguese display labels — presentational only, not a business rule.
export const WEEKDAY_LABELS: Record<Weekday, string> = {
  [Weekday.MONDAY]: 'Segunda-feira',
  [Weekday.TUESDAY]: 'Terça-feira',
  [Weekday.WEDNESDAY]: 'Quarta-feira',
  [Weekday.THURSDAY]: 'Quinta-feira',
  [Weekday.FRIDAY]: 'Sexta-feira',
  [Weekday.SATURDAY]: 'Sábado',
  [Weekday.SUNDAY]: 'Domingo',
};

// The AI-generated Workout model stores its own day as `dayOfWeek: 1..7`
// (Prisma `Int`, not the `Weekday` enum meal plans/EducatorWorkout use) —
// same ISO-style ordering, different representation.
const DAY_OF_WEEK_LABELS: readonly string[] = [
  '',
  'Segunda-feira',
  'Terça-feira',
  'Quarta-feira',
  'Quinta-feira',
  'Sexta-feira',
  'Sábado',
  'Domingo',
];

export function dayOfWeekLabel(dayOfWeek: number): string {
  return DAY_OF_WEEK_LABELS[dayOfWeek] ?? `Dia ${dayOfWeek}`;
}
