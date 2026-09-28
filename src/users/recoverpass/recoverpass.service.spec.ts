import { MailService } from '@/mail/mail.service';
import { UserRepository } from '@/repositories/users/user.repository';
import { UserTokenRepository } from '@/repositories/users/userToken.repository';
import { AppError } from '@/utils/app.erro';
import { PasswordHash } from '@/utils/password.hash';
import { Logger } from '@nestjs/common';
import { TokenType, UsersToken } from '@prisma/client';
import { hashToken, UserTokenService } from '../token/userToken.service';
import { RecoverpassService } from './recoverpass.service';

// Lets the recovery email work, which runs off the response path, settle.
const flushBackgroundWork = () =>
  new Promise((resolve) => setImmediate(resolve));

describe('RecoverpassService - account enumeration (US-004)', () => {
  const existingUser = {
    id: 'user-1',
    name: 'Existing User',
    email: 'existing@example.com',
  };
  const users = { findByEmail: jest.fn() };
  const userTokens = {
    replace: jest.fn().mockResolvedValue({ id: 'token-row-1' }),
  };
  const mail = { sendEmailPassword: jest.fn().mockResolvedValue(undefined) };
  let service: RecoverpassService;

  beforeEach(() => {
    jest.clearAllMocks();
    users.findByEmail.mockImplementation((email: string) =>
      Promise.resolve(email === existingUser.email ? existingUser : null),
    );
    service = new RecoverpassService(
      users as unknown as UserRepository,
      new UserTokenService(userTokens as unknown as UserTokenRepository),
      mail as unknown as MailService,
      {} as PasswordHash,
    );
  });

  it('UT-005 returns an identical response for an existing and a non-existing email', async () => {
    const existing = await service.postRecoverpass({
      email: existingUser.email,
    });
    const missing = await service.postRecoverpass({
      email: 'nobody@example.com',
    });

    expect(existing).toEqual(missing);
    expect(existing).toBe(true);
  });

  it('sends the recovery email only when the account exists', async () => {
    await service.postRecoverpass({ email: 'nobody@example.com' });
    await flushBackgroundWork();
    expect(mail.sendEmailPassword).not.toHaveBeenCalled();

    await service.postRecoverpass({ email: existingUser.email });
    await flushBackgroundWork();
    expect(mail.sendEmailPassword).toHaveBeenCalledWith(
      existingUser.name,
      existingUser.email,
      'Recuperação de senha',
      './resetpassword',
      expect.stringMatching(/\/signin\?token=[\w-]{43}$/),
    );

    // platform-hardening US-002 AC-1: the link carries the raw token, the
    // database only its hash.
    const [stored] = userTokens.replace.mock.calls[0] as [UsersToken];
    const [, , , , link] = mail.sendEmailPassword.mock.calls[0] as string[];
    expect(stored).toMatchObject({
      userID: 'user-1',
      type: TokenType.RECOVERY,
    });
    expect(stored.tokenHash).toBe(hashToken(link.split('token=')[1]));
  });

  it('keeps the same response when sending the email fails, logging without PII', async () => {
    const logError = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    mail.sendEmailPassword.mockRejectedValueOnce(
      new Error('smtp rejected existing@example.com'),
    );

    await expect(
      service.postRecoverpass({ email: existingUser.email }),
    ).resolves.toBe(true);
    await flushBackgroundWork();

    expect(logError).toHaveBeenCalledWith(
      'password_recovery_email_failed user=user-1 error=Error',
    );
    logError.mockRestore();
  });
});

describe('RecoverpassService.postChangePassword', () => {
  const tokenRow = { id: 'token-row-1', userID: 'user-1' } as UsersToken;
  const users = { updatePasswordWithToken: jest.fn() };
  const userToken = { findLive: jest.fn() };
  const hash = { generateHash: jest.fn().mockResolvedValue('new-hash') };
  let service: RecoverpassService;

  beforeEach(() => {
    jest.clearAllMocks();
    userToken.findLive.mockResolvedValue(tokenRow);
    service = new RecoverpassService(
      users as unknown as UserRepository,
      userToken as unknown as UserTokenService,
      {} as MailService,
      hash as unknown as PasswordHash,
    );
  });

  // UT-013: the deepest branch — a live token and matching passwords, but
  // the token is consumed by a concurrent request before the update lands.
  it('rejects with 400 when the token is consumed between lookup and update', async () => {
    users.updatePasswordWithToken.mockResolvedValue(null);

    let error: unknown;
    try {
      await service.postChangePassword({
        token: 'raw-token',
        password: 'newStrongPassword123',
        checkPassword: 'newStrongPassword123',
      });
    } catch (thrown) {
      error = thrown;
    }

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).message).toBe('Token inválido ou expirado.');
    expect((error as AppError).getStatus()).toBe(400);
    expect(userToken.findLive).toHaveBeenCalledWith(
      'raw-token',
      TokenType.RECOVERY,
    );
    expect(users.updatePasswordWithToken).toHaveBeenCalledWith(
      tokenRow,
      'new-hash',
    );
  });
});
