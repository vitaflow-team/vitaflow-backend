import { AppError } from '@/utils/app.erro';
import { Injectable, Logger } from '@nestjs/common';
import { LoginTicket, OAuth2Client } from 'google-auth-library';

export interface GoogleVerifiedIdentity {
  sub: string;
  email: string;
  name?: string;
  picture?: string;
}

const GOOGLE_AUTH_FAILURE = 'Falha ao entrar com Google.';
const GOOGLE_ISSUERS = new Set([
  'accounts.google.com',
  'https://accounts.google.com',
]);

@Injectable()
export class GoogleAuthService {
  private readonly client = new OAuth2Client();
  private readonly logger = new Logger(GoogleAuthService.name);

  async verify(idToken: string): Promise<GoogleVerifiedIdentity> {
    if (typeof idToken !== 'string' || !idToken.trim()) {
      throw this.reject('missing_token');
    }

    const audience = process.env.GOOGLE_CLIENT_ID;
    if (!audience) {
      this.logger.error(
        'GOOGLE_CLIENT_ID is not configured — every Google sign-in will fail.',
      );
      throw this.reject('client_not_configured');
    }

    let ticket: LoginTicket;
    try {
      ticket = await this.client.verifyIdToken({ idToken, audience });
    } catch (error) {
      // Never log the raw idToken — only the library's own error message,
      // which describes the failure (bad signature, malformed JWT, etc.)
      // without including the token itself.
      this.logger.warn(
        `Google ID token verification failed: ${(error as Error).message}`,
      );
      throw this.reject('invalid_token');
    }

    const payload = ticket.getPayload();
    const now = Math.floor(Date.now() / 1000);

    if (!payload) {
      throw this.reject('invalid_token');
    }
    if (payload.aud !== audience) {
      this.logger.warn(
        `Google token audience mismatch: expected this app's GOOGLE_CLIENT_ID, ` +
          `got a token issued for a different client.`,
      );
      throw this.reject('wrong_audience');
    }
    if (!payload.iss || !GOOGLE_ISSUERS.has(payload.iss)) {
      throw this.reject('wrong_issuer');
    }
    if (typeof payload.exp !== 'number' || payload.exp <= now) {
      throw this.reject('token_expired');
    }
    if (!payload.sub) {
      throw this.reject('missing_sub');
    }
    if (!payload.email || payload.email_verified !== true) {
      throw this.reject('email_not_verified');
    }

    return {
      sub: payload.sub,
      email: payload.email,
      name: payload.name,
      picture: payload.picture,
    };
  }

  private reject(reason: string): AppError {
    return new AppError(GOOGLE_AUTH_FAILURE, 401, reason);
  }
}
