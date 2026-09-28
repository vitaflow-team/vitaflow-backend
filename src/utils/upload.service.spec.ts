/* eslint-disable @typescript-eslint/no-unsafe-return */
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { avatarFile, JPEG_BYTES, PNG_BYTES } from 'mock/imageFile.mock';
import { AppError } from './app.erro';
import { UploadService } from './upload.service';

const mockDateNow = 1700000000000;
global.Date.now = jest.fn(() => mockDateNow);

const mockFileDelete = jest.fn();
const mockFileExists = jest.fn();
const mockFileGetSignedUrl = jest.fn();

const mockCreateWriteStream = jest.fn();

const mockWriteStream = {
  on: jest.fn((event, handler) => {
    if (event === 'finish') {
      setTimeout(() => handler(), 10);
    }
    return mockWriteStream;
  }),
  end: jest.fn(),
};

const mockGcsFile = (filename: string) => ({
  createWriteStream: mockCreateWriteStream.mockImplementation(
    () => mockWriteStream,
  ),
  delete: mockFileDelete,
  exists: mockFileExists,
  getSignedUrl: mockFileGetSignedUrl,
  name: filename,
});

const mockBucketFile = jest.fn(mockGcsFile);

const mockStorageBucket = jest.fn(() => ({
  file: mockBucketFile,
  name: 'test-bucket',
}));

jest.mock('@google-cloud/storage', () => {
  const MockStorage = jest.fn(() => ({
    bucket: mockStorageBucket,
  }));

  return {
    Storage: MockStorage,
  };
});

describe('UploadService', () => {
  let service: UploadService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UploadService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              const env = {
                GCP_PROJECT_ID: 'test-project',
                GCP_CLIENT_EMAIL: 'test-email',
                GCP_PRIVATE_KEY: 'test-key',
                GCP_BUCKET: 'test-bucket',
              };
              return env[key];
            }),
          },
        },
      ],
    }).compile();

    mockBucketFile.mockImplementation(mockGcsFile);

    service = module.get<UploadService>(UploadService);
  });

  beforeAll(() => {
    process.env.GCP_PROJECT_ID = 'test-project';
    process.env.GCP_CLIENT_EMAIL = 'test-email';
    process.env.GCP_PRIVATE_KEY = 'test-key';
    process.env.GCP_BUCKET = 'test-bucket';
  });

  describe('uploadImage', () => {
    const mockFile = avatarFile({
      originalname: 'test.jpg',
      mimetype: 'image/jpeg',
      buffer: JPEG_BYTES,
    });
    const GENERATED_NAME =
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}.jpg$/;

    beforeEach(() => {
      mockCreateWriteStream.mockClear();
    });

    it('should upload the file and return the GCS URL', async () => {
      const url = await service.uploadImage(mockFile);

      const objectName = mockBucketFile.mock.calls[0][0];
      expect(objectName).toMatch(GENERATED_NAME);

      expect(mockCreateWriteStream).toHaveBeenCalledWith({
        resumable: false,
        contentType: 'image/jpeg',
      });

      expect(mockWriteStream.end).toHaveBeenCalledWith(mockFile.buffer);

      expect(url).toBe(
        `https://storage.googleapis.com/test-bucket/${objectName}`,
      );
    });

    // UT-007
    it('never derives the object name from the client file name', async () => {
      const hostile = avatarFile({
        originalname: '../../other-bucket/evil name.png',
        mimetype: 'image/png',
      });

      const first = await service.uploadImage(hostile);
      const second = await service.uploadImage(hostile);

      const names = mockBucketFile.mock.calls.map(([name]) => name);
      for (const name of names) {
        expect(name).toMatch(/^[0-9a-f-]{36}.png$/);
        expect(name).not.toContain('..');
        expect(name).not.toContain('/');
        expect(name).not.toContain('evil');
      }
      expect(names[0]).not.toBe(names[1]);
      expect(first).not.toBe(second);
    });

    it('stores the content type detected from the bytes, not the declared one', async () => {
      await service.uploadImage(
        avatarFile({ mimetype: 'image/jpeg', buffer: PNG_BYTES }),
      );

      expect(mockBucketFile.mock.calls[0][0]).toMatch(/.png$/);
      expect(mockCreateWriteStream).toHaveBeenCalledWith({
        resumable: false,
        contentType: 'image/png',
      });
    });

    it('refuses content that is not a supported image, before touching storage', async () => {
      const error: unknown = await service
        .uploadImage(avatarFile({ buffer: Buffer.from('not an image') }))
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).getStatus()).toBe(400);

      expect(mockBucketFile).not.toHaveBeenCalled();
    });

    it('should reject the promise if stream emits an error', async () => {
      mockWriteStream.on.mockImplementation((event, handler) => {
        if (event === 'error') {
          setTimeout(() => handler(new Error('Stream Error')), 10);
        }
        return mockWriteStream;
      });

      await expect(service.uploadImage(mockFile)).rejects.toThrow(
        'Stream Error',
      );
    });
  });

  describe('deleteImage', () => {
    const mockFileUrl =
      'https://storage.googleapis.com/test-bucket/12345-old.png';
    const objectName = '12345-old.png';

    it('should delete the file if it exists', async () => {
      mockFileExists.mockResolvedValueOnce([true]);

      await service.deleteImage(mockFileUrl);

      expect(mockBucketFile).toHaveBeenCalledWith(objectName);
      expect(mockFileDelete).toHaveBeenCalled();
    });

    it('should return immediately if objectName is empty (URL ends with slash)', async () => {
      const mockFileUrlEndingWithSlash =
        'https://storage.googleapis.com/test-bucket/avatars/';

      await service.deleteImage(mockFileUrlEndingWithSlash);

      expect(mockBucketFile).not.toHaveBeenCalled();
      expect(mockFileExists).not.toHaveBeenCalled();
      expect(mockFileDelete).not.toHaveBeenCalled();
    });

    it('should return immediately if fileUrl is empty', async () => {
      await service.deleteImage('');

      expect(mockBucketFile).not.toHaveBeenCalled();
      expect(mockFileExists).not.toHaveBeenCalled();
    });

    it('should not try to delete if the file does not exist', async () => {
      mockFileExists.mockResolvedValueOnce([false]);

      const consoleLogSpy = jest
        .spyOn(console, 'log')
        .mockImplementation(() => {});

      await service.deleteImage(mockFileUrl);

      expect(mockBucketFile).toHaveBeenCalledWith(objectName);
      expect(mockFileDelete).not.toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith(
        `File not found, skipping deletion: ${objectName}`,
      );

      consoleLogSpy.mockRestore();
    });

    it('should handle error during deletion by logging it', async () => {
      mockFileExists.mockResolvedValueOnce([true]);
      mockFileDelete.mockRejectedValueOnce(new Error('GCS Permission Denied'));

      const consoleErrorSpy = jest
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      await service.deleteImage(mockFileUrl);

      expect(mockFileDelete).toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });
  });

  describe('getSignedUrl', () => {
    const mockFileUrl =
      'https://storage.googleapis.com/test-bucket/user-avatar.jpg';
    const objectName = 'user-avatar.jpg';
    const signedUrl = 'https://storage.googleapis.com/signed-url-for-test';

    it('should return a signed URL with correct v4 and read options', async () => {
      mockFileGetSignedUrl.mockResolvedValueOnce([signedUrl]);

      const url = await service.getSignedUrl(mockFileUrl);

      expect(mockBucketFile).toHaveBeenCalledWith(objectName);
      expect(mockFileGetSignedUrl).toHaveBeenCalledWith(
        expect.objectContaining({
          version: 'v4',
          action: 'read',
        }),
      );

      const optionsCall = mockFileGetSignedUrl.mock.calls[0][0];
      expect(optionsCall.expires).toBeGreaterThan(Date.now());

      expect(url).toBe(signedUrl);
    });

    it('should return empty string if filename is empty', async () => {
      const url = await service.getSignedUrl('');

      expect(mockBucketFile).not.toHaveBeenCalled();
      expect(url).toBe('');
    });
  });

  describe('isBucketUrl', () => {
    // UT-005
    it('accepts a file hosted in the app bucket', () => {
      expect(
        service.isBucketUrl(
          'https://storage.googleapis.com/test-bucket/1-a.png',
        ),
      ).toBe(true);
    });

    // UT-006
    it('rejects external, other-bucket and empty URLs', () => {
      expect(
        service.isBucketUrl('https://lh3.googleusercontent.com/a/abc=s96-c'),
      ).toBe(false);
      expect(
        service.isBucketUrl(
          'https://storage.googleapis.com/other-bucket/1-a.png',
        ),
      ).toBe(false);
      expect(service.isBucketUrl('')).toBe(false);
      expect(service.isBucketUrl(null)).toBe(false);
      expect(service.isBucketUrl(undefined)).toBe(false);
    });
  });
});
