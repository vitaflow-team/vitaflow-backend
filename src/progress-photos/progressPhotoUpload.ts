import { AppError } from '@/utils/app.erro';
import { detectImage } from '@/utils/imageSignature';
import { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';

// A progress photo is a full-body phone-camera shot, not a small profile
// picture, so it gets a more generous cap than AVATAR_MAX_BYTES (2 MB).
export const PROGRESS_PHOTO_MAX_BYTES = 8 * 1024 * 1024;

export const PROGRESS_PHOTO_MIME_TYPES: readonly string[] = [
  'image/jpeg',
  'image/png',
  'image/webp',
];

const INVALID_TYPE_MESSAGE =
  'Formato de imagem inválido. Use JPEG, PNG ou WEBP.';
const TOO_LARGE_MESSAGE = 'A imagem deve ter no máximo 8 MB.';

// First gate, run by multer before the body is buffered: only the declared
// type is known here, so the content is re-checked by
// `assertValidProgressPhoto`.
export function progressPhotoFileFilter(
  _request: unknown,
  file: Express.Multer.File,
  callback: (error: Error | null, acceptFile: boolean) => void,
): void {
  if (!PROGRESS_PHOTO_MIME_TYPES.includes(file.mimetype)) {
    callback(new AppError(INVALID_TYPE_MESSAGE, 400), false);
    return;
  }
  callback(null, true);
}

// `fileSize` makes multer abort the stream past the limit (413) instead of
// buffering an arbitrarily large body into memory.
export const PROGRESS_PHOTO_UPLOAD_OPTIONS: MulterOptions = {
  limits: { fileSize: PROGRESS_PHOTO_MAX_BYTES, files: 1 },
  fileFilter: progressPhotoFileFilter,
};

export function assertValidProgressPhoto(file: Express.Multer.File): void {
  if (!file) {
    throw new AppError(INVALID_TYPE_MESSAGE, 400);
  }
  if (file.size > PROGRESS_PHOTO_MAX_BYTES) {
    throw new AppError(TOO_LARGE_MESSAGE, 413);
  }
  if (
    !PROGRESS_PHOTO_MIME_TYPES.includes(file.mimetype) ||
    !detectImage(file.buffer)
  ) {
    throw new AppError(INVALID_TYPE_MESSAGE, 400);
  }
}
