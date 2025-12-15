import { UploadService } from '@/utils/upload.service';

export const uploadServiceMock = {
  provide: UploadService,
  useValue: {
    uploadImage: jest.fn(),
    deleteImage: jest.fn(),
    getSignedUrl: jest.fn(),
  },
};
