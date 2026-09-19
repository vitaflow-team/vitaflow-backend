import { calculateBmi, classifyBmi } from './bmi.util';

describe('BMI utilities', () => {
  it('UT-001 calculates BMI rounded to one decimal', () => {
    expect(calculateBmi(70, 175)).toBe(22.9);
  });

  it.each([
    ['UT-002', 18.49, 'ABAIXO_DO_PESO'],
    ['UT-003', 18.5, 'PESO_NORMAL'],
    ['UT-004', 24.99, 'PESO_NORMAL'],
    ['UT-005', 25, 'SOBREPESO'],
    ['UT-006', 29.99, 'SOBREPESO'],
    ['UT-007', 30, 'OBESIDADE_GRAU_I'],
    ['UT-008', 34.99, 'OBESIDADE_GRAU_I'],
    ['UT-009', 35, 'OBESIDADE_GRAU_II'],
    ['UT-010', 39.99, 'OBESIDADE_GRAU_II'],
    ['UT-011', 40, 'OBESIDADE_GRAU_III'],
  ] as const)(
    '%s classifies %s in the expected WHO band',
    (_id, bmi, expected) => {
      expect(classifyBmi(bmi)).toBe(expected);
    },
  );
});
