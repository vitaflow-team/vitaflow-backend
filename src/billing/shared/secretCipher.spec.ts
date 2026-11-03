import { randomBytes } from 'crypto';
import { decodeCipherKey, decryptSecret, encryptSecret } from './secretCipher';

const KEY = randomBytes(32);

describe('secret cipher (UT-006)', () => {
  it('decrypts what it encrypted, with a fresh ciphertext each time, never containing the plaintext', () => {
    const plain = 'fake-asaas-valid-key-0001';
    const first = encryptSecret(plain, KEY);
    const second = encryptSecret(plain, KEY);

    expect(decryptSecret(first, KEY)).toBe(plain);
    expect(first).not.toBe(second);
    expect(first).not.toContain(plain);
  });

  it('fails on a tampered ciphertext and on a wrong key', () => {
    const blob = Buffer.from(encryptSecret('secret-value', KEY), 'base64');
    blob[blob.length - 1] ^= 0xff;
    expect(() => decryptSecret(blob.toString('base64'), KEY)).toThrow();
    expect(() =>
      decryptSecret(encryptSecret('secret-value', KEY), randomBytes(32)),
    ).toThrow();
  });

  it('requires a 32-byte key and never echoes the value it rejects', () => {
    const short = randomBytes(31).toString('base64');
    let message = '';
    try {
      decodeCipherKey(short);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('BILLING_ENCRYPTION_KEY');
    expect(message).not.toContain(short);
    expect(decodeCipherKey(randomBytes(32).toString('base64'))).toHaveLength(
      32,
    );
  });
});
