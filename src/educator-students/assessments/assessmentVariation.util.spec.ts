import { computeVariation, VariationInput } from './assessmentVariation.util';

function assessment(
  day: string,
  weightKg: number,
  bodyFatPercent: number | null = null,
  enteredAt = day,
): VariationInput {
  return {
    assessedOn: new Date(`${day}T00:00:00.000Z`),
    createdAt: new Date(`${enteredAt}T12:00:00.000Z`),
    weightKg,
    bodyFatPercent,
  };
}

describe('computeVariation', () => {
  it('UT-012 returns the weight change from the first to the latest assessment', () => {
    const result = computeVariation([
      assessment('2026-07-21', 80.3),
      assessment('2026-09-15', 78.2),
    ]);

    expect(result?.weightKg).toBe(-2.1);
  });

  it('UT-013 returns null with a single assessment, not zero', () => {
    expect(computeVariation([assessment('2026-09-15', 78.2)])).toBeNull();
    expect(computeVariation([])).toBeNull();
  });

  it('UT-014 uses the first and latest assessments that both have body fat', () => {
    const result = computeVariation([
      assessment('2026-07-21', 80.3, null),
      assessment('2026-08-18', 79.0, 20.0),
      assessment('2026-09-15', 78.2, 18.4),
    ]);

    expect(result?.bodyFatPoints).toBe(-1.6);
  });

  it('UT-014 gives no body-fat change with fewer than two values', () => {
    const result = computeVariation([
      assessment('2026-08-18', 79.0, 20.0),
      assessment('2026-09-15', 78.2, null),
    ]);

    expect(result).toEqual({ weightKg: -0.8, bodyFatPoints: null });
  });

  it('UT-015 orders by assessment date, not by order of entry', () => {
    const result = computeVariation([
      assessment('2026-09-15', 78.2, null, '2026-09-16'),
      assessment('2026-08-18', 79.0, null, '2026-09-17'),
    ]);

    expect(result?.weightKg).toBe(-0.8);
  });

  it('UT-015 breaks a same-date tie by order of entry', () => {
    const result = computeVariation([
      {
        ...assessment('2026-09-15', 79.0),
        createdAt: new Date('2026-09-15T08:00:00Z'),
      },
      {
        ...assessment('2026-09-15', 78.0),
        createdAt: new Date('2026-09-15T18:00:00Z'),
      },
    ]);

    expect(result?.weightKg).toBe(-1);
  });

  it('UT-016 returns zero, not null, when nothing changed', () => {
    const result = computeVariation([
      assessment('2026-08-18', 78.2, 18.4),
      assessment('2026-09-15', 78.2, 18.4),
    ]);

    expect(result).toEqual({ weightKg: 0, bodyFatPoints: 0 });
    expect(Object.is(result?.weightKg, -0)).toBe(false);
  });
});
