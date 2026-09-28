// Minimal byte sequences carrying each format's real signature, so the
// server-side content check sees genuine images without binary fixtures.
export const PNG_BYTES = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('png-body'),
]);

export const JPEG_BYTES = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  Buffer.from('jpeg-body'),
]);

export const WEBP_BYTES = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([0x24, 0x00, 0x00, 0x00]),
  Buffer.from('WEBPVP8 '),
]);

export function avatarFile(
  overrides: Partial<Express.Multer.File> = {},
): Express.Multer.File {
  const buffer = overrides.buffer ?? PNG_BYTES;
  return {
    fieldname: 'avatar',
    originalname: 'avatar.png',
    encoding: '7bit',
    mimetype: 'image/png',
    size: buffer.length,
    stream: null as unknown as Express.Multer.File['stream'],
    destination: '',
    filename: '',
    path: '',
    ...overrides,
    buffer,
  };
}
