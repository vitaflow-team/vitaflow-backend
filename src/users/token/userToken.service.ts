import { UserTokenRepository } from '@/repositories/users/userToken.repository';
import { Injectable, Logger } from '@nestjs/common';
import { TokenType, UsersToken } from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';

const HOUR_MS = 60 * 60 * 1000;

export const TOKEN_TTL_MS: Record<TokenType, number> = {
  [TokenType.ACTIVATION]: 2 * HOUR_MS,
  [TokenType.RECOVERY]: 3 * HOUR_MS,
};

// 32 random bytes = 256 bits of entropy.
const TOKEN_BYTES = 32;

export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

// Issues and looks up activation/recovery tokens. The raw value only ever
// exists in the email link; the database holds its hash. Consuming a token
// (deleting it together with the change it authorizes) is done atomically by
// the repository method that applies that change.
@Injectable()
export class UserTokenService {
  private readonly logger = new Logger(UserTokenService.name);

  constructor(private readonly userTokens: UserTokenRepository) {}

  // Any earlier token of the same type for this user is deleted first, so
  // at most one is ever live per type per user.
  async issue(userID: string, type: TokenType): Promise<string> {
    const raw = randomBytes(TOKEN_BYTES).toString('base64url');

    await this.userTokens.replace({
      userID,
      type,
      tokenHash: hashToken(raw),
      expiresAt: new Date(Date.now() + TOKEN_TTL_MS[type]),
    });

    return raw;
  }

  // Returns the live token matching the raw value, or null. An expired one
  // is deleted on the spot so it can never be used again.
  async findLive(raw: string, type: TokenType): Promise<UsersToken | null> {
    const token = await this.userTokens.findByHash(hashToken(raw));
    if (!token || token.type !== type) {
      this.logger.warn(`token_rejected reason=unknown type=${type}`);
      return null;
    }

    if (token.expiresAt.getTime() <= Date.now()) {
      await this.userTokens.deleteById(token.id);
      this.logger.warn(`token_rejected reason=expired type=${type}`);
      return null;
    }

    return token;
  }
}
