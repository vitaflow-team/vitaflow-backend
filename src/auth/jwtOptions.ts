import { JwtModuleOptions } from '@nestjs/jwt';

// The only algorithm accepted on either side: pinning it keeps a token signed
// with anything else (another HMAC size, `none`) from ever verifying.
export const JWT_ALGORITHM = 'HS256';

// Session lifetime of a backend access token (was 12h).
export const JWT_EXPIRES_IN = '2h';

export function buildJwtOptions(secret: string | undefined): JwtModuleOptions {
  return {
    secret,
    signOptions: { algorithm: JWT_ALGORITHM, expiresIn: JWT_EXPIRES_IN },
    verifyOptions: { algorithms: [JWT_ALGORITHM] },
  };
}
