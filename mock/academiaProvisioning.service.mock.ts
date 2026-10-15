import { AcademiaProvisioningService } from '@/academia/academia.service';

export const academiaProvisioningServiceMock = {
  provide: AcademiaProvisioningService,
  useValue: {
    provisionForOwner: jest.fn().mockResolvedValue(null),
  },
};
