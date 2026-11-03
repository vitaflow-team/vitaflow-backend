import { createHash, randomBytes, timingSafeEqual } from 'crypto';

export function keyFingerprint(apiKey: string): string {
  return createHash('sha256').update(apiKey.trim()).digest('hex');
}

export function newWebhookToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashWebhookToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function verifyWebhookToken(token: string, hash: string): boolean {
  const provided = Buffer.from(hashWebhookToken(token), 'hex');
  const stored = Buffer.from(hash, 'hex');
  return provided.length === stored.length && timingSafeEqual(provided, stored);
}
