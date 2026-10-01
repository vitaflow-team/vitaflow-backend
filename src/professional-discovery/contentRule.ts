// A first line of defense against ADR-003's content rule (no before/after
// client imagery, no outcome guarantees), not a guarantee — a determined
// professional can phrase around keyword matching (TechSpec Known Risks).
// No human moderation pass exists; this is the only check this PRD scopes.
const BANNED_PATTERNS: RegExp[] = [
  /antes\s*(e|\/)\s*depois/i, // before/after imagery references
  /resultado[s]?\s+garantid[oa]?/i, // "resultado(s) garantido(a)"
  /garant(e|ia|ido|imos)\s+(o\s+)?resultado/i, // "garante/garantia o resultado"
  /emagre[çc]a?\s+\d+\s*kg\s+garantid/i, // "emagreça Xkg garantido"
  /cura\s+garantida/i,
];

export function violatesContentRule(
  ...texts: Array<string | null | undefined>
): boolean {
  const combined = texts.filter(Boolean).join(' ');
  return BANNED_PATTERNS.some((pattern) => pattern.test(combined));
}
