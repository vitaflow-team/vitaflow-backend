import { AppError } from '@/utils/app.erro';
import { OAuth2Client } from 'google-auth-library';
import { GoogleAuthService } from './google-auth.service';

describe('GoogleAuthService.verify', () => {
  const originalClientId = process.env.GOOGLE_CLIENT_ID;
  let service: GoogleAuthService;
  let verifyIdToken: jest.Mock;

  const validPayload = () => ({
    sub: 'google-sub',
    email: 'user@example.com',
    name: 'User Name',
    picture: 'https://example.com/avatar.png',
    email_verified: true,
    aud: 'google-client-id',
    iss: 'https://accounts.google.com',
    exp: Math.floor(Date.now() / 1000) + 3600,
  });

  beforeEach(() => {
    process.env.GOOGLE_CLIENT_ID = 'google-client-id';
    service = new GoogleAuthService();
    verifyIdToken = jest.fn();
    (
      service as unknown as {
        client: Pick<OAuth2Client, 'verifyIdToken'>;
      }
    ).client = { verifyIdToken } as Pick<OAuth2Client, 'verifyIdToken'>;
  });

  afterAll(() => {
    process.env.GOOGLE_CLIENT_ID = originalClientId;
  });

  function ticket(payload: Record<string, unknown>) {
    return { getPayload: () => payload };
  }

  async function expectUnauthorized(token = 'id-token') {
    const rejection = service.verify(token);
    await expect(rejection).rejects.toBeInstanceOf(AppError);
    await expect(rejection).rejects.toMatchObject({ status: 401 });
  }

  it('UT-001 returns the narrow verified identity for a valid token', async () => {
    verifyIdToken.mockResolvedValue(ticket(validPayload()));

    await expect(service.verify('id-token')).resolves.toEqual({
      sub: 'google-sub',
      email: 'user@example.com',
      name: 'User Name',
      picture: 'https://example.com/avatar.png',
    });
    expect(verifyIdToken).toHaveBeenCalledWith({
      idToken: 'id-token',
      audience: 'google-client-id',
    });
  });

  it('UT-002 maps an invalid signature rejection to AppError(401)', async () => {
    verifyIdToken.mockRejectedValue(new Error('invalid signature'));
    await expectUnauthorized();
  });

  it('UT-003 rejects a wrong audience with AppError(401)', async () => {
    verifyIdToken.mockResolvedValue(
      ticket({ ...validPayload(), aud: 'another-client' }),
    );
    await expectUnauthorized();
  });

  it('UT-004 rejects a wrong or missing issuer with AppError(401)', async () => {
    verifyIdToken.mockResolvedValue(
      ticket({ ...validPayload(), iss: 'https://attacker.example' }),
    );
    await expectUnauthorized();
  });

  it('UT-005 rejects a token expired one second ago with AppError(401)', async () => {
    verifyIdToken.mockResolvedValue(
      ticket({
        ...validPayload(),
        exp: Math.floor(Date.now() / 1000) - 1,
      }),
    );
    await expectUnauthorized();
  });

  it('UT-006 rejects a payload without sub with AppError(401)', async () => {
    verifyIdToken.mockResolvedValue(ticket({ ...validPayload(), sub: '' }));
    await expectUnauthorized();
  });

  it('UT-007 rejects an unverified email with AppError(401)', async () => {
    verifyIdToken.mockResolvedValue(
      ticket({ ...validPayload(), email_verified: false }),
    );
    await expectUnauthorized();
  });

  it('UT-008 maps malformed token errors to AppError(401)', async () => {
    verifyIdToken.mockRejectedValue(new Error('malformed jwt'));
    await expectUnauthorized('not-a-token');
  });

  it('UT-009 rejects an empty token with AppError(401)', async () => {
    await expectUnauthorized('');
    expect(verifyIdToken).not.toHaveBeenCalled();
  });
});
