import { AppError } from '@/utils/app.erro';
import { avatarFile, JPEG_BYTES, WEBP_BYTES } from 'mock/imageFile.mock';
import {
  assertValidAvatar,
  AVATAR_MAX_BYTES,
  avatarFileFilter,
  AVATAR_UPLOAD_OPTIONS,
} from './avatarUpload';

function filterResult(file: Express.Multer.File) {
  const callback = jest.fn();
  avatarFileFilter({}, file, callback);
  return callback.mock.calls[0] as [Error | null, boolean];
}

function thrownBy(action: () => void): AppError | undefined {
  try {
    action();
  } catch (error) {
    return error as AppError;
  }
  return undefined;
}

describe('avatar upload rules (UT-006)', () => {
  it('caps the multipart body at 2 MB and a single file', () => {
    expect(AVATAR_MAX_BYTES).toBe(2 * 1024 * 1024);
    expect(AVATAR_UPLOAD_OPTIONS).toEqual({
      limits: { fileSize: AVATAR_MAX_BYTES, files: 1 },
      fileFilter: avatarFileFilter,
    });
  });

  describe('fileFilter', () => {
    it.each(['image/png', 'image/jpeg', 'image/webp'])(
      'accepts a declared %s',
      (mimetype) => {
        expect(filterResult(avatarFile({ mimetype }))).toEqual([null, true]);
      },
    );

    it.each(['text/plain', 'image/svg+xml', 'image/gif', 'application/pdf'])(
      'rejects a declared %s with a 400',
      (mimetype) => {
        const [error, accepted] = filterResult(avatarFile({ mimetype }));

        expect(accepted).toBe(false);
        expect(error).toBeInstanceOf(AppError);
        expect((error as AppError).getStatus()).toBe(400);
      },
    );
  });

  describe('assertValidAvatar', () => {
    it('accepts a valid image/png under the limit', () => {
      expect(() => assertValidAvatar(avatarFile())).not.toThrow();
    });

    it('accepts JPEG and WEBP content', () => {
      expect(() =>
        assertValidAvatar(
          avatarFile({ mimetype: 'image/jpeg', buffer: JPEG_BYTES }),
        ),
      ).not.toThrow();
      expect(() =>
        assertValidAvatar(
          avatarFile({ mimetype: 'image/webp', buffer: WEBP_BYTES }),
        ),
      ).not.toThrow();
    });

    it('rejects a file over 2 MB with a 413', () => {
      const error = thrownBy(() =>
        assertValidAvatar(avatarFile({ size: AVATAR_MAX_BYTES + 1 })),
      );

      expect(error).toBeInstanceOf(AppError);
      expect(error?.getStatus()).toBe(413);
    });

    it('rejects a non-image mime type with a 400', () => {
      const error = thrownBy(() =>
        assertValidAvatar(avatarFile({ mimetype: 'text/plain' })),
      );

      expect(error?.getStatus()).toBe(400);
    });

    it('rejects a renamed non-image that declares image/png', () => {
      const error = thrownBy(() =>
        assertValidAvatar(
          avatarFile({ buffer: Buffer.from('<?php system($_GET[1]); ?>') }),
        ),
      );

      expect(error?.getStatus()).toBe(400);
    });
  });
});
