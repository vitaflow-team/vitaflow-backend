import { UploadService } from '@/utils/upload.service';

export const uploadServiceMock = {
  provide: UploadService,
  useValue: {
    uploadImage: jest.fn(),
    deleteImage: jest.fn(),
    getSignedUrl: jest.fn(),
    // Mirrors the real host guard against the bucket the other specs use
    // ('test-bucket'), so callers that gate on it behave realistically.
    isBucketUrl: jest.fn().mockImplementation((url: string | null) => {
      const prefix = 'https://storage.googleapis.com/test-bucket/';
      return (
        typeof url === 'string' &&
        url.startsWith(prefix) &&
        url.length > prefix.length
      );
    }),
  },
};
