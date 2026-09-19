import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SignUpDTO } from './signup.Dto';

function buildValidDto(overrides: Partial<SignUpDTO> = {}) {
  return plainToInstance(SignUpDTO, {
    name: 'Jonh Doe',
    email: 'jonhdoe@jonhdoe.com',
    password: 'StrongPass123',
    checkPassword: 'StrongPass123',
    termsAccepted: true,
    healthDataConsent: true,
    ...overrides,
  });
}

describe('SignUpDTO consent validation', () => {
  it('passes with both consents accepted', async () => {
    const errors = await validate(buildValidDto());
    expect(errors).toHaveLength(0);
  });

  it('rejects termsAccepted: false', async () => {
    const errors = await validate(buildValidDto({ termsAccepted: false }));
    expect(errors.some((error) => error.property === 'termsAccepted')).toBe(
      true,
    );
  });

  it('rejects healthDataConsent: false', async () => {
    const errors = await validate(buildValidDto({ healthDataConsent: false }));
    expect(errors.some((error) => error.property === 'healthDataConsent')).toBe(
      true,
    );
  });

  it('rejects a missing termsAccepted field', async () => {
    const dto = buildValidDto();
    // @ts-expect-error deliberately omitting a required field
    delete dto.termsAccepted;

    const errors = await validate(dto);
    expect(errors.some((error) => error.property === 'termsAccepted')).toBe(
      true,
    );
  });

  it('rejects a missing healthDataConsent field', async () => {
    const dto = buildValidDto();
    // @ts-expect-error deliberately omitting a required field
    delete dto.healthDataConsent;

    const errors = await validate(dto);
    expect(errors.some((error) => error.property === 'healthDataConsent')).toBe(
      true,
    );
  });
});
