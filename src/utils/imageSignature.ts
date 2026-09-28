// Leading bytes of each accepted image format. A client picks the declared
// mime type and file name freely; the content itself is what's checked here.
const IMAGE_SIGNATURES = [
  { mimeType: 'image/jpeg', extension: 'jpg', matches: isJpeg },
  { mimeType: 'image/png', extension: 'png', matches: isPng },
  { mimeType: 'image/webp', extension: 'webp', matches: isWebp },
] as const;

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function isJpeg(buffer: Buffer): boolean {
  return (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  );
}

function isPng(buffer: Buffer): boolean {
  return (
    buffer.length >= PNG_MAGIC.length &&
    buffer.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)
  );
}

function isWebp(buffer: Buffer): boolean {
  return (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  );
}

export function detectImage(
  buffer: Buffer,
): { mimeType: string; extension: string } | null {
  const signature = IMAGE_SIGNATURES.find(({ matches }) => matches(buffer));
  return signature
    ? { mimeType: signature.mimeType, extension: signature.extension }
    : null;
}
