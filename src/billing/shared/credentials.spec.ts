import {
  hashWebhookToken,
  keyFingerprint,
  newWebhookToken,
  verifyWebhookToken,
} from './credentials';

describe('key fingerprint and webhook token (UT-007, UT-008)', () => {
  it('fingerprints a key deterministically, ignoring surrounding spaces', () => {
    expect(keyFingerprint('  fake-key-0001  ')).toBe(
      keyFingerprint('fake-key-0001'),
    );
    expect(keyFingerprint('fake-key-0001')).not.toBe(
      keyFingerprint('fake-key-0002'),
    );
  });

  it('generates tokens with at least 32 bytes of randomness that verify only themselves', () => {
    const token = newWebhookToken();
    const other = newWebhookToken();
    const hash = hashWebhookToken(token);

    expect(Buffer.from(token, 'base64url').length).toBeGreaterThanOrEqual(32);
    expect(token).not.toBe(other);
    expect(verifyWebhookToken(token, hash)).toBe(true);
    expect(verifyWebhookToken(other, hash)).toBe(false);
  });
});
