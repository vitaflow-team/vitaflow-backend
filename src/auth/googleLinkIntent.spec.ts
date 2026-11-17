import { JwtService } from '@nestjs/jwt';
import {
  isGoogleLinkIntentFor,
  signGoogleLinkIntent,
} from './googleLinkIntent';

const JWT_SECRET = 'google-link-intent-unit-secret';

describe('Google link intent — unified login account UT-013', () => {
  const jwt = new JwtService({ secret: JWT_SECRET });

  // Only the clock the token library reads is controlled; fake timers
  // would also freeze the callbacks its asynchronous signing relies on.
  let now: number;
  const at = (iso: string) => {
    now = new Date(iso).getTime();
  };

  beforeEach(() => {
    process.env.JWT_SECRET = JWT_SECRET;
    at('2026-11-16T12:00:00.000Z');
    jest.spyOn(Date, 'now').mockImplementation(() => now);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('a fresh intent verifies for the account it was issued to', async () => {
    const intent = await signGoogleLinkIntent(jwt, 'user-1');

    await expect(isGoogleLinkIntentFor(jwt, intent, 'user-1')).resolves.toBe(
      true,
    );
  });

  it('still verifies one second before five minutes and is rejected one second after', async () => {
    const intent = await signGoogleLinkIntent(jwt, 'user-1');

    at('2026-11-16T12:04:59.000Z');
    await expect(isGoogleLinkIntentFor(jwt, intent, 'user-1')).resolves.toBe(
      true,
    );

    at('2026-11-16T12:05:01.000Z');
    await expect(isGoogleLinkIntentFor(jwt, intent, 'user-1')).resolves.toBe(
      false,
    );
  });

  it('is rejected for a different account', async () => {
    const intent = await signGoogleLinkIntent(jwt, 'user-1');

    await expect(isGoogleLinkIntentFor(jwt, intent, 'user-2')).resolves.toBe(
      false,
    );
  });

  it('rejects a token signed for another purpose', async () => {
    const other = await jwt.signAsync({ purpose: 'something_else', id: 'u1' });

    await expect(isGoogleLinkIntentFor(jwt, other, 'u1')).resolves.toBe(false);
  });

  it('rejects an ordinary access token of the same account', async () => {
    const accessToken = await jwt.signAsync({
      id: 'user-1',
      email: 'ana@x.com',
    });

    await expect(
      isGoogleLinkIntentFor(jwt, accessToken, 'user-1'),
    ).resolves.toBe(false);
  });

  it('rejects a token signed with another secret, and garbage', async () => {
    const forged = await new JwtService({ secret: 'another-secret' }).signAsync(
      { purpose: 'google_link', id: 'user-1' },
    );

    await expect(isGoogleLinkIntentFor(jwt, forged, 'user-1')).resolves.toBe(
      false,
    );
    await expect(
      isGoogleLinkIntentFor(jwt, 'not-a-token', 'user-1'),
    ).resolves.toBe(false);
  });

  it('carries no email, so it can never pass for an access token', async () => {
    const intent = await signGoogleLinkIntent(jwt, 'user-1');

    expect(jwt.decode(intent)).not.toHaveProperty('email');
  });
});
