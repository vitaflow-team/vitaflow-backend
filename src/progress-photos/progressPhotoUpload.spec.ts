import { AppError } from '@/utils/app.erro';
import { JPEG_BYTES, progressPhotoFile, WEBP_BYTES } from 'mock/imageFile.mock';
import {
  assertValidProgressPhoto,
  PROGRESS_PHOTO_MAX_BYTES,
  progressPhotoFileFilter,
  PROGRESS_PHOTO_UPLOAD_OPTIONS,
} from './progressPhotoUpload';

function filterResult(file: Express.Multer.File) {
  const callback = jest.fn();
  progressPhotoFileFilter({}, file, callback);
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

describe('progress photo upload rules (UT-006, UT-007)', () => {
  it('caps the multipart body at 8 MB and a single file', () => {
    expect(PROGRESS_PHOTO_MAX_BYTES).toBe(8 * 1024 * 1024);
    expect(PROGRESS_PHOTO_UPLOAD_OPTIONS).toEqual({
      limits: { fileSize: PROGRESS_PHOTO_MAX_BYTES, files: 1 },
      fileFilter: progressPhotoFileFilter,
    });
  });

  describe('fileFilter', () => {
    it.each(['image/png', 'image/jpeg', 'image/webp'])(
      'accepts a declared %s',
      (mimetype) => {
        expect(filterResult(progressPhotoFile({ mimetype }))).toEqual([
          null,
          true,
        ]);
      },
    );

    it.each(['text/plain', 'image/svg+xml', 'image/gif', 'application/pdf'])(
      'rejects a declared %s with a 400',
      (mimetype) => {
        const [error, accepted] = filterResult(progressPhotoFile({ mimetype }));

        expect(accepted).toBe(false);
        expect(error).toBeInstanceOf(AppError);
        expect((error as AppError).getStatus()).toBe(400);
      },
    );
  });

  describe('assertValidProgressPhoto', () => {
    it('accepts a valid image/png under the limit', () => {
      expect(() => assertValidProgressPhoto(progressPhotoFile())).not.toThrow();
    });

    it('accepts JPEG and WEBP content', () => {
      expect(() =>
        assertValidProgressPhoto(
          progressPhotoFile({ mimetype: 'image/jpeg', buffer: JPEG_BYTES }),
        ),
      ).not.toThrow();
      expect(() =>
        assertValidProgressPhoto(
          progressPhotoFile({ mimetype: 'image/webp', buffer: WEBP_BYTES }),
        ),
      ).not.toThrow();
    });

    it('UT-007 rejects a file over 8 MB with a 413', () => {
      const error = thrownBy(() =>
        assertValidProgressPhoto(
          progressPhotoFile({ size: PROGRESS_PHOTO_MAX_BYTES + 1 }),
        ),
      );

      expect(error).toBeInstanceOf(AppError);
      expect(error?.getStatus()).toBe(413);
    });

    it('UT-006 rejects a non-image mime type with a 400', () => {
      const error = thrownBy(() =>
        assertValidProgressPhoto(progressPhotoFile({ mimetype: 'text/plain' })),
      );

      expect(error?.getStatus()).toBe(400);
    });

    it('UT-006 rejects a renamed non-image that declares image/png', () => {
      const error = thrownBy(() =>
        assertValidProgressPhoto(
          progressPhotoFile({
            buffer: Buffer.from('<?php system($_GET[1]); ?>'),
          }),
        ),
      );

      expect(error?.getStatus()).toBe(400);
    });
  });
});
