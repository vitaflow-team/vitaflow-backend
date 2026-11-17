import { JwtService } from '@nestjs/jwt';
import { JWT_ALGORITHM } from './jwtOptions';

const GOOGLE_LINK_PURPOSE = 'google_link';

// Long enough to go to Google and come back, short enough that a leaked
// intent is useless (unified-login-account ADR-009).
export const GOOGLE_LINK_INTENT_TTL = '5m';

// Proof that the signed-in owner of `userId` asked, moments ago, to connect
// Google — and, for an account with staff access, did so with the password.
// It carries a purpose instead of an email, so AuthGuard never accepts it
// as an access token, and an access token never passes for an intent.
export async function signGoogleLinkIntent(
  jwt: JwtService,
  userId: string,
): Promise<string> {
  return await jwt.signAsync(
    { purpose: GOOGLE_LINK_PURPOSE, id: userId },
    { expiresIn: GOOGLE_LINK_INTENT_TTL, algorithm: JWT_ALGORITHM },
  );
}

export async function isGoogleLinkIntentFor(
  jwt: JwtService,
  intent: string,
  userId: string,
): Promise<boolean> {
  try {
    const payload = await jwt.verifyAsync<{ purpose?: unknown; id?: unknown }>(
      intent,
      { secret: process.env.JWT_SECRET, algorithms: [JWT_ALGORITHM] },
    );
    return payload.purpose === GOOGLE_LINK_PURPOSE && payload.id === userId;
  } catch {
    return false;
  }
}
