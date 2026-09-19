import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CreateMeasurementRecordDTO,
  UpdateMeasurementRecordDTO,
} from './progress.Dto';

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
