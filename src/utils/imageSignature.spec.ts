import { JPEG_BYTES, PNG_BYTES, WEBP_BYTES } from 'mock/imageFile.mock';
import { detectImage } from './imageSignature';

describe('detectImage', () => {
  it('recognises PNG, JPEG and WEBP by their leading bytes', () => {
    expect(detectImage(PNG_BYTES)).toEqual({
      mimeType: 'image/png',
      extension: 'png',
    });
    expect(detectImage(JPEG_BYTES)).toEqual({
      mimeType: 'image/jpeg',
      extension: 'jpg',
    });
    expect(detectImage(WEBP_BYTES)).toEqual({
      mimeType: 'image/webp',
      extension: 'webp',
    });
  });

  it('returns null for other content and truncated input', () => {
    expect(detectImage(Buffer.from('GIF89a......'))).toBeNull();
    expect(detectImage(Buffer.from('RIFF....WAVE'))).toBeNull();
    expect(detectImage(PNG_BYTES.subarray(0, 4))).toBeNull();
    expect(detectImage(Buffer.alloc(0))).toBeNull();
  });
});
