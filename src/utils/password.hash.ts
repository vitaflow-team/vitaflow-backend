import { Injectable } from '@nestjs/common';
import { compare, hash } from 'bcrypt';

export const BCRYPT_COST = 12;

// bcrypt only reads the first 72 bytes of its input, so longer passwords are
// rejected at the DTO instead of being silently truncated.
export const PASSWORD_MAX_BYTES = 72;

@Injectable()
export class PasswordHash {
  public async generateHash(payload: string): Promise<string> {
    return await hash(payload, BCRYPT_COST);
  }

  public async compareHash(payload: string, hashed: string): Promise<boolean> {
    return await compare(payload, hashed);
  }
}
