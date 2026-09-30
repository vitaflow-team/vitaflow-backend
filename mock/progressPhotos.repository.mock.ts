import { ProgressPhotosRepository } from '@/repositories/progress-photos/progressPhotos.repository';

export const progressPhotosRepositoryMock = {
  provide: ProgressPhotosRepository,
  useValue: {
    create: jest.fn(),
    findById: jest.fn(),
    findByUserAndAngle: jest.fn(),
    findLatestByUserAndAngle: jest.fn(),
    findAllByUser: jest.fn(),
    delete: jest.fn(),
  },
};
