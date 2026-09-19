import {
  Body,
  Controller,
  Post,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { DualBucketThrottlerGuard } from './dual-bucket-throttler.guard';
import { GoogleSignInDTO } from './google-signin.Dto';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('google')
  @ApiOperation({ summary: 'Sign in with a Google ID token' })
  @ApiBody({ type: GoogleSignInDTO })
  @UseGuards(DualBucketThrottlerGuard)
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
  async signInWithGoogle(@Body() body: GoogleSignInDTO) {
    return await this.authService.signInWithGoogle(body.idToken);
  }
}
