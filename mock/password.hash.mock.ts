import { PasswordHash } from '@/utils/password.hash';

export const passwordHashMock = {
  provide: PasswordHash,
  useValue: {
    compareHash: jest
      .fn()
      .mockImplementation(async (payload: string, hashed: string) => {
        return Promise.resolve(payload === hashed);
      }),

    generateHash: jest
      .fn()
      .mockImplementation(async ({ payload }: { payload: string }) => {
        return Promise.resolve(payload);
      }),
  },
};
