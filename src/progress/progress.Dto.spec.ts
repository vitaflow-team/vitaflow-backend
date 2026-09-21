import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CreateMeasurementRecordDTO,
  DashboardQueryDTO,
  UpdateMeasurementRecordDTO,
} from './progress.Dto';

describe('DashboardQueryDTO validation', () => {
  it.each([
    ['4', 4],
    ['8', 8],
    ['12', 12],
  ])('UT-001 accepts and transforms weeks=%s', async (weeks, expected) => {
    const dto = plainToInstance(DashboardQueryDTO, { weeks });

    expect(await validate(dto)).toHaveLength(0);
    expect(dto.weeks).toBe(expected);
  });

  it('UT-002 accepts an omitted weeks value', async () => {
    const dto = plainToInstance(DashboardQueryDTO, {});

    expect(await validate(dto)).toHaveLength(0);
    expect(dto.weeks).toBeUndefined();
  });

  it.each(['6', '0', '13', '-4'])(
    'UT-003 rejects an out-of-set weeks value: %s',
    async (weeks) => {
      expect(
        await validate(plainToInstance(DashboardQueryDTO, { weeks })),
      ).not.toHaveLength(0);
    },
  );

  it.each(['', 'abc'])(
    'UT-004 rejects an empty or non-numeric weeks value: %s',
    async (weeks) => {
      expect(
        await validate(plainToInstance(DashboardQueryDTO, { weeks })),
      ).not.toHaveLength(0);
    },
  );

  it.each(['4.0', '8.5'])(
    'UT-005 rejects a decimal weeks value: %s',
    async (weeks) => {
      expect(
        await validate(plainToInstance(DashboardQueryDTO, { weeks })),
      ).not.toHaveLength(0);
    },
  );

  it('UT-006 rejects a repeated weeks parameter', async () => {
    const dto = plainToInstance(DashboardQueryDTO, { weeks: ['4', '8'] });

    expect(await validate(dto)).not.toHaveLength(0);
  });
});

function buildDto(
  overrides: Record<string, unknown> = {},
): CreateMeasurementRecordDTO {
  return plainToInstance(CreateMeasurementRecordDTO, {
    weightKg: 62,
    heightCm: 168,
    ...overrides,
  });
}

describe('Measurement record DTO validation', () => {
  it('UT-034 accepts weightKg at the minimum', async () => {
    expect(await validate(buildDto({ weightKg: 20 }))).toHaveLength(0);
  });

  it('UT-035 rejects weightKg below the minimum', async () => {
    const errors = await validate(buildDto({ weightKg: 19.9 }));
    expect(errors.some((error) => error.property === 'weightKg')).toBe(true);
  });

  it('UT-036 accepts weightKg at the maximum', async () => {
    expect(await validate(buildDto({ weightKg: 300 }))).toHaveLength(0);
  });

  it('UT-037 rejects weightKg above the maximum', async () => {
    const errors = await validate(buildDto({ weightKg: 300.1 }));
    expect(errors.some((error) => error.property === 'weightKg')).toBe(true);
  });

  it('UT-038 rejects non-numeric weightKg', async () => {
    const errors = await validate(buildDto({ weightKg: 'abc' }));
    expect(errors.some((error) => error.property === 'weightKg')).toBe(true);
  });

  it('UT-039 rejects negative weightKg', async () => {
    const errors = await validate(buildDto({ weightKg: -10 }));
    expect(errors.some((error) => error.property === 'weightKg')).toBe(true);
  });

  it('UT-040 rejects omitted weightKg', async () => {
    const dto = buildDto();
    delete (dto as Partial<CreateMeasurementRecordDTO>).weightKg;
    const errors = await validate(dto);
    expect(errors.some((error) => error.property === 'weightKg')).toBe(true);
  });

  it('UT-041 accepts omitted waistCm and hipCm', async () => {
    expect(await validate(buildDto())).toHaveLength(0);
  });

  it('UT-042 rejects an out-of-range optional waistCm', async () => {
    const errors = await validate(buildDto({ waistCm: 500 }));
    expect(errors.some((error) => error.property === 'waistCm')).toBe(true);
  });

  it('UT-043 rejects more than one decimal place', async () => {
    const errors = await validate(buildDto({ weightKg: 62.55 }));
    expect(errors.some((error) => error.property === 'weightKg')).toBe(true);
  });

  it('keeps weight and height required for update DTOs', async () => {
    const dto = plainToInstance(UpdateMeasurementRecordDTO, {});
    const errors = await validate(dto);
    expect(errors.map((error) => error.property)).toEqual(
      expect.arrayContaining(['weightKg', 'heightCm']),
    );
  });
});
