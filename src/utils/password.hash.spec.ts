import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { PasswordHash } from './password.hash';

const actualBcrypt = jest.requireActual<typeof bcrypt>('bcrypt');

jest.mock('bcrypt');

describe('PasswordHash  Tests', () => {
  let passwordHash: PasswordHash;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PasswordHash],
    }).compile();

    passwordHash = module.get<PasswordHash>(PasswordHash);
  });

  it('Validates if the hash is generated', async () => {
    const payload = 'password123';
    const hashed = 'hashedPassword123';

    (bcrypt.hash as jest.Mock).mockResolvedValue(hashed);

    const result = await passwordHash.generateHash(payload);

    expect(bcrypt.hash).toHaveBeenCalledWith(payload, 12);
    expect(result).toBe(hashed);
  });

  it('UT-004 produces a hash whose cost factor, read back from it, is 12', async () => {
    (bcrypt.hash as jest.Mock).mockImplementation(actualBcrypt.hash);

    const hashed = await passwordHash.generateHash('StrongPass123');

    expect(actualBcrypt.getRounds(hashed)).toBe(12);
    await expect(actualBcrypt.compare('StrongPass123', hashed)).resolves.toBe(
      true,
    );
  });

  it('Validates that the hash is correct', async () => {
    const payload = 'password123';
    const hashed = 'hashedPassword123';

    (bcrypt.compare as jest.Mock).mockResolvedValue(true);

    const result = await passwordHash.compareHash(payload, hashed);

    expect(bcrypt.compare).toHaveBeenCalledWith(payload, hashed);
    expect(result).toBe(true);
  });

  it('Returns false when the hash does not match', async () => {
    const payload = 'password123';
    const hashed = 'hashedPassword123';

    (bcrypt.compare as jest.Mock).mockResolvedValue(false);

    const result = await passwordHash.compareHash(payload, hashed);

    expect(bcrypt.compare).toHaveBeenCalledWith(payload, hashed);
    expect(result).toBe(false);
  });
});
