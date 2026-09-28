import 'reflect-metadata';
import { ClientRegisterDTO } from '@/clients/register/client.register.Dto';
import { ProfileDTO } from '@/users/profile/profile.Dto';
import { NewPasswordDto } from '@/users/recoverpass/newPassword.Dto';
import { RecoverpassDTO } from '@/users/recoverpass/recoverpass.Dto';
import { SignInDTO } from '@/users/signin/signin.Dto';
import { SignUpDTO } from '@/users/signup/signup.Dto';
import { BadRequestException, Type } from '@nestjs/common';
import { createValidationPipe } from './validationPipe';

const PASSWORD_72 = 'Aa1' + 'a'.repeat(69);
const PASSWORD_73 = 'Aa1' + 'a'.repeat(70);

const validSignUp = {
  name: 'Jane Doe',
  email: 'jane@example.com',
  password: 'StrongPass123',
  checkPassword: 'StrongPass123',
  termsAccepted: true,
  healthDataConsent: true,
};

const validClient = {
  name: 'John Client',
  phone: '(11) 98888-7777',
  email: 'client@example.com',
};

// Runs a body through the exact pipe configuration `main.ts` installs.
function validateBody(metatype: Type, value: object): Promise<unknown> {
  return createValidationPipe().transform(value, { type: 'body', metatype });
}

async function rejectionMessages(
  metatype: Type,
  value: object,
): Promise<string[]> {
  const error: unknown = await validateBody(metatype, value).catch(
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(BadRequestException);
  const response = (error as BadRequestException).getResponse() as {
    message: string[];
  };
  return response.message;
}

describe('Global ValidationPipe - auth and input hardening', () => {
  describe('whitelisting (US-001)', () => {
    it('UT-001 rejects a payload with a field the DTO does not declare', async () => {
      const messages = await rejectionMessages(SignUpDTO, {
        ...validSignUp,
        isAdmin: true,
      });

      expect(messages).toContain('property isAdmin should not exist');
    });

    it('accepts a payload with only declared fields', async () => {
      await expect(validateBody(SignUpDTO, validSignUp)).resolves.toEqual(
        expect.objectContaining({ email: validSignUp.email }),
      );
    });

    it('EC-2 accepts an absent optional field (ClientRegisterDTO without id)', async () => {
      await expect(
        validateBody(ClientRegisterDTO, validClient),
      ).resolves.toBeInstanceOf(ClientRegisterDTO);
    });

    it('keeps every field real callers send: recovery token and profile email', async () => {
      await expect(
        validateBody(NewPasswordDto, {
          token: 'token-1',
          password: 'StrongPass123',
          checkPassword: 'StrongPass123',
        }),
      ).resolves.toEqual(expect.objectContaining({ token: 'token-1' }));

      await expect(
        validateBody(ProfileDTO, {
          name: 'Jane Doe',
          email: 'jane@example.com',
          phone: '(11) 98888-7777',
          addressLine1: 'Av. Paulista, 1000',
          district: 'Bela Vista',
          city: 'São Paulo',
          region: 'SP',
          postalCode: '01310-000',
        }),
      ).resolves.toBeInstanceOf(ProfileDTO);
    });
  });

  describe('email rules (US-002)', () => {
    it.each<[string, Type, object]>([
      ['SignUpDTO', SignUpDTO, validSignUp],
      ['SignInDTO', SignInDTO, { password: 'anything' }],
      ['RecoverpassDTO', RecoverpassDTO, {}],
      ['ClientRegisterDTO', ClientRegisterDTO, validClient],
    ])('UT-002 %s rejects a malformed email', async (_name, metatype, base) => {
      const messages = await rejectionMessages(metatype, {
        ...base,
        email: 'not-an-email',
      });

      expect(messages).toContain('Email must be a valid email address.');
    });

    it('trims and lowercases the email before it reaches the service', async () => {
      const dto = (await validateBody(SignInDTO, {
        email: '  Test@Example.COM ',
        password: 'anything',
      })) as SignInDTO;

      expect(dto.email).toBe('test@example.com');
    });
  });

  describe('password bounds (US-002)', () => {
    it.each<[string, Type, object]>([
      ['SignUpDTO', SignUpDTO, validSignUp],
      ['NewPasswordDto', NewPasswordDto, { token: 'token-1' }],
    ])(
      'UT-003 %s accepts 72 characters and rejects 73',
      async (_n, type, base) => {
        await expect(
          validateBody(type, {
            ...base,
            password: PASSWORD_72,
            checkPassword: PASSWORD_72,
          }),
        ).resolves.toBeInstanceOf(type);

        const messages = await rejectionMessages(type, {
          ...base,
          password: PASSWORD_73,
          checkPassword: PASSWORD_73,
        });
        expect(messages).toContain(
          'The password must be at most 72 bytes long.',
        );
      },
    );

    it('UT-003 rejects a password under 72 characters but over 72 bytes', async () => {
      const multiByte = 'Aa1' + 'é'.repeat(35); // 38 characters, 73 bytes

      const messages = await rejectionMessages(SignUpDTO, {
        ...validSignUp,
        password: multiByte,
        checkPassword: multiByte,
      });

      expect(messages).toContain('The password must be at most 72 bytes long.');
    });

    it('UT-003 still applies the format rules at 72 characters or fewer', async () => {
      const weak = 'a'.repeat(72);

      const messages = await rejectionMessages(SignUpDTO, {
        ...validSignUp,
        password: weak,
        checkPassword: weak,
      });

      expect(messages).toContain(
        'The password must contain uppercase, lowercase letters and numbers.',
      );
    });
  });
});
