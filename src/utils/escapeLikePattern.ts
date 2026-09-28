// Prisma compiles `equals` with `mode: 'insensitive'` to an unescaped ILIKE,
// so `_` and `%` in the value would act as wildcards (`a_b@x.com` matching
// `axb@x.com`). Escaping them keeps the comparison an exact, case-insensitive
// match.
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}
