import {
  Body,
  Controller,
  Post,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { DualBucketThrottlerGuard } from './dualBucketThrottler.guard';
import { GoogleSignInDTO } from './googleSignIn.Dto';
import { SignInResponseDTO } from './signInResponse.Dto';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('google')
  @ApiOperation({ summary: 'Sign in with a Google ID token' })
  @ApiBody({ type: GoogleSignInDTO })
  @ApiResponse({
    status: 201,
    description: 'User authenticated successfully.',
    type: SignInResponseDTO,
  })
  @ApiResponse({ status: 400, description: 'Missing or malformed idToken.' })
  @ApiResponse({ status: 401, description: 'Google sign-in failed.' })
  @ApiResponse({ status: 429, description: 'Too many requests.' })
  @UseGuards(DualBucketThrottlerGuard)
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
  async signInWithGoogle(
    @Body() body: GoogleSignInDTO,
  ): Promise<SignInResponseDTO> {
    return await this.authService.signInWithGoogle(body.idToken);
  }
}
