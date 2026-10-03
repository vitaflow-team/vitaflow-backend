import { createValidationPipe } from '@/config/validationPipe';
import { ArgumentMetadata, BadRequestException } from '@nestjs/common';
import { todayInBrt } from '../assessedOnTimestamp.util';
import { CreateAssessmentDTO } from './createAssessment.Dto';
import { UpdateAssessmentDTO } from './updateAssessment.Dto';

const pipe = createValidationPipe();

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
  return (error.getResponse() as { message: string[] }).message.join(' | ');
}

function dayOffset(days: number): string {
  const base = new Date(`${todayInBrt()}T00:00:00.000Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

const valid = { assessedOn: todayInBrt(), weightKg: 78.2, heightCm: 179 };

// field, min, max (inclusive), step outside by one decimal
const RANGES: Array<[string, number, number]> = [
  ['weightKg', 20, 300],
  ['heightCm', 50, 250],
  ['waistCm', 30, 200],
  ['hipCm', 30, 200],
  ['armCm', 10, 200],
  ['chestCm', 10, 200],
  ['abdomenCm', 10, 200],
  ['thighCm', 10, 200],
  ['calfCm', 10, 200],
  ['bodyFatPercent', 1, 70],
  ['flexibilityCm', -50, 80],
];

describe('assessment DTOs (through the app validation pipe)', () => {
  it.each(RANGES)(
    'UT-001..007 %s accepts %p and %p and rejects values just outside',
    async (field, min, max) => {
      await expect(
        run(CreateAssessmentDTO, { ...valid, [field]: min }),
      ).resolves.toBeDefined();
      await expect(
        run(CreateAssessmentDTO, { ...valid, [field]: max }),
      ).resolves.toBeDefined();

      for (const outside of [min - 0.1, max + 0.1]) {
        const result = await messages(
          run(CreateAssessmentDTO, {
            ...valid,
            [field]: Math.round(outside * 10) / 10,
          }),
        );
        expect(result).toContain(field);
      }
    },
  );

  it('UT-006 resting heart rate accepts 30 to 150 whole numbers only', async () => {
    for (const ok of [30, 58, 150]) {
      await expect(
        run(CreateAssessmentDTO, { ...valid, restingHeartRate: ok }),
      ).resolves.toBeDefined();
    }
    for (const bad of [29, 151, 70.5, '60']) {
      expect(
        await messages(
          run(CreateAssessmentDTO, { ...valid, restingHeartRate: bad }),
        ),
      ).toContain('restingHeartRate');
    }
  });

  it('UT-008 accepts one decimal place and rejects two', async () => {
    await expect(
      run(CreateAssessmentDTO, { ...valid, weightKg: 70.5 }),
    ).resolves.toBeDefined();
    for (const field of ['weightKg', 'bodyFatPercent']) {
      expect(
        await messages(run(CreateAssessmentDTO, { ...valid, [field]: 18.55 })),
      ).toContain(field);
    }
  });

  it.each([0, -5, 'abc', '78.2', Number.NaN, Infinity, '1e3', '9'.repeat(400)])(
    'UT-009 rejects weight %p, never coercing it to a number',
    async (weightKg) => {
      expect(
        await messages(run(CreateAssessmentDTO, { ...valid, weightKg })),
      ).toContain('weightKg');
    },
  );

  it('UT-010 accepts today and old dates and rejects tomorrow and impossible dates', async () => {
    for (const assessedOn of [todayInBrt(), dayOffset(-1), '1990-01-01']) {
      await expect(
        run(CreateAssessmentDTO, { ...valid, assessedOn }),
      ).resolves.toBeDefined();
    }
    for (const assessedOn of [
      dayOffset(1),
      '2026-13-40',
      '2026-02-30',
      'not-a-date',
      '15/09/2026',
      20260915,
    ]) {
      expect(
        await messages(run(CreateAssessmentDTO, { ...valid, assessedOn })),
      ).toContain('assessedOn');
    }
  });

  it('UT-011 requires date, weight and height and accepts just those', async () => {
    await expect(run(CreateAssessmentDTO, valid)).resolves.toBeDefined();

    for (const missing of ['assessedOn', 'weightKg', 'heightCm']) {
      const body: Record<string, unknown> = { ...valid };
      delete body[missing];
      expect(await messages(run(CreateAssessmentDTO, body))).toContain(missing);
    }
  });

  it('accepts null for optional values (cleared fields)', async () => {
    await expect(
      run(CreateAssessmentDTO, { ...valid, bodyFatPercent: null, armCm: null }),
    ).resolves.toBeDefined();
  });

  it('accepts acceptDeclaration only as a boolean on creation', async () => {
    await expect(
      run(CreateAssessmentDTO, { ...valid, acceptDeclaration: true }),
    ).resolves.toBeDefined();
    expect(
      await messages(
        run(CreateAssessmentDTO, { ...valid, acceptDeclaration: 'yes' }),
      ),
    ).toContain('acceptDeclaration');
    expect(
      await messages(
        run(UpdateAssessmentDTO, { ...valid, acceptDeclaration: true }),
      ),
    ).toContain('acceptDeclaration');
  });

  it('UT-171 rejects fields the DTO does not declare', async () => {
    for (const extra of [
      { clientId: 'other' },
      { id: 'x' },
      { createdAt: '2026-01-01' },
    ]) {
      expect(
        await messages(run(CreateAssessmentDTO, { ...valid, ...extra })),
      ).toMatch(/should not exist/);
      await messages(run(UpdateAssessmentDTO, { ...valid, ...extra }));
    }
  });
});
