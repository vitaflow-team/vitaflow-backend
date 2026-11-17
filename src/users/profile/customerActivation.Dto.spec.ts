import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CustomerActivationDTO } from './customerActivation.Dto';

function buildDto(overrides: Record<string, unknown> = {}) {
  return plainToInstance(CustomerActivationDTO, {
    termsAccepted: true,
    healthDataConsent: true,
    ...overrides,
  });
}

async function invalidProperties(dto: CustomerActivationDTO) {
  const errors = await validate(dto);
  return errors.map((error) => error.property);
}

// Same rules as SignUpDTO's consent fields (signup.Dto.spec.ts).
describe('CustomerActivationDTO — unified login account UT-030', () => {
  it('passes with both consents accepted', async () => {
    await expect(invalidProperties(buildDto())).resolves.toEqual([]);
  });

  it('rejects termsAccepted: false', async () => {
    await expect(
      invalidProperties(buildDto({ termsAccepted: false })),
    ).resolves.toEqual(['termsAccepted']);
  });

  it('rejects healthDataConsent: false', async () => {
    await expect(
      invalidProperties(buildDto({ healthDataConsent: false })),
    ).resolves.toEqual(['healthDataConsent']);
  });

  it.each(['termsAccepted', 'healthDataConsent'])(
    'rejects a missing %s field',
    async (field) => {
      await expect(
        invalidProperties(buildDto({ [field]: undefined })),
      ).resolves.toEqual([field]);
    },
  );

  it('rejects a truthy non-boolean such as the string "true"', async () => {
    await expect(
      invalidProperties(buildDto({ termsAccepted: 'true' })),
    ).resolves.toEqual(['termsAccepted']);
  });
});
