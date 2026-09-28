import { GoogleAuthService } from '@/auth/googleAuth.service';

export const googleAuthServiceMock = {
  provide: GoogleAuthService,
  useValue: {
    verify: jest.fn(),
  },
};
