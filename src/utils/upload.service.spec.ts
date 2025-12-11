/* eslint-disable @typescript-eslint/require-await */
/* eslint-disable @typescript-eslint/no-unsafe-return */
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

    process.env.GCP_PROJECT_ID = 'test-project';
    process.env.GCP_CLIENT_EMAIL = 'test-email';
    process.env.GCP_PRIVATE_KEY = 'test-key';
    process.env.GCP_BUCKET = 'test-bucket';

    mockBucketFile.mockImplementation(mockGcsFile);

    service = new UploadService();
  });

  describe('uploadImage', () => {
    const mockFile: Express.Multer.File = {
      fieldname: 'avatar',
      originalname: 'test.jpg',
      encoding: '7bit',
      mimetype: 'image/jpeg',
      size: 1024,
      stream: null as any,
      destination: '',
      filename: '',
      path: '',
      buffer: Buffer.from('test buffer'),
    };
    const expectedFilename = `${mockDateNow}-${mockFile.originalname}`;

    beforeEach(() => {
      mockCreateWriteStream.mockClear();
    });

    it('should upload the file and return the GCS URL', async () => {
      const url = await service.uploadImage(mockFile);

      expect(mockBucketFile).toHaveBeenCalledWith(expectedFilename);

      expect(mockCreateWriteStream).toHaveBeenCalledWith({
        resumable: false,
        contentType: 'image/jpeg',
      });

      expect(mockWriteStream.end).toHaveBeenCalledWith(mockFile.buffer);

      expect(url).toBe(
        `https://storage.googleapis.com/${process.env.GCP_BUCKET}/${expectedFilename}`,
      );
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
});
