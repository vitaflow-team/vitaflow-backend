import { AppError } from '@/utils/app.erro';
import { detectImage } from '@/utils/imageSignature';
import { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';

export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

export const AVATAR_MIME_TYPES: readonly string[] = [
  'image/jpeg',
  'image/png',
  'image/webp',
];

const INVALID_TYPE_MESSAGE =
  'Formato de imagem inválido. Use JPEG, PNG ou WEBP.';
const TOO_LARGE_MESSAGE = 'A imagem deve ter no máximo 2 MB.';

// First gate, run by multer before the body is buffered: only the declared
// type is known here, so the content is re-checked by `assertValidAvatar`.
export function avatarFileFilter(
  _request: unknown,
  file: Express.Multer.File,
  callback: (error: Error | null, acceptFile: boolean) => void,
): void {
  if (!AVATAR_MIME_TYPES.includes(file.mimetype)) {
    callback(new AppError(INVALID_TYPE_MESSAGE, 400), false);
    return;
  }
  callback(null, true);
}

// `fileSize` makes multer abort the stream past the limit (413) instead of
// buffering an arbitrarily large body into memory.
export const AVATAR_UPLOAD_OPTIONS: MulterOptions = {
  limits: { fileSize: AVATAR_MAX_BYTES, files: 1 },
  fileFilter: avatarFileFilter,
};

export function assertValidAvatar(file: Express.Multer.File): void {
  if (file.size > AVATAR_MAX_BYTES) {
    throw new AppError(TOO_LARGE_MESSAGE, 413);
  }
  if (!AVATAR_MIME_TYPES.includes(file.mimetype) || !detectImage(file.buffer)) {
    throw new AppError(INVALID_TYPE_MESSAGE, 400);
  }
}
