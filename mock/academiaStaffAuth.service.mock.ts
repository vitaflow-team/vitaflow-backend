import { AcademiaStaffAuthService } from '@/academia/staff/academiaStaffAuth.service';

export const academiaStaffAuthServiceMock = {
  provide: AcademiaStaffAuthService,
  useValue: {
    findByEmail: jest.fn().mockResolvedValue(null),
    sendActivationEmail: jest.fn(),
    activate: jest.fn(),
  },
};
