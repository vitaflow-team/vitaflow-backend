import { GoogleAuthService } from '@/auth/google-auth.service';

export const googleAuthServiceMock = {
  provide: GoogleAuthService,
  useValue: {
    verify: jest.fn(),
  },
};
