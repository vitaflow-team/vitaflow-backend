import type { AuthenticatedRequest } from '@/common/types/authenticatedRequest';
import {
  Body,
  Controller,
  Post,
  Request,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { DualBucketThrottlerGuard } from './dualBucketThrottler.guard';
import { GoogleLinkDTO } from './googleLink.Dto';
import { GoogleLinkIntentDTO } from './googleLinkIntent.Dto';
import { GoogleLinkIntentResponseDTO } from './googleLinkIntentResponse.Dto';
import { SignInResponseDTO } from './signInResponse.Dto';

// "Conectar Google" (unified-login-account ADR-009). Separate from
// AuthController, whose sign-in route is public: every route here acts on
// the authenticated account and on no other.
@ApiTags('Auth')
@ApiBearerAuth('jwt')
@Controller('auth/google')
@UseGuards(AuthGuard, DualBucketThrottlerGuard)
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
export class GoogleLinkController {
  constructor(private readonly authService: AuthService) {}

  @Post('link-intent')
  @ApiOperation({
    summary: 'Ask to connect Google to the signed-in account',
    description:
      'Returns a five-minute intent to send back with the Google ID token. ' +
      'An account with staff access must supply its current password.',
  })
  @ApiResponse({ status: 201, type: GoogleLinkIntentResponseDTO })
  @ApiResponse({ status: 401, description: 'invalid_password' })
  @ApiResponse({ status: 409, description: 'google_already_linked' })
  @ApiResponse({ status: 429, description: 'Too many requests.' })
  async issueLinkIntent(
    @Body() body: GoogleLinkIntentDTO,
    @Request() req: AuthenticatedRequest,
  ): Promise<GoogleLinkIntentResponseDTO> {
    return await this.authService.issueGoogleLinkIntent(
      req.user.id,
      body.password,
    );
  }

  @Post('link')
  @ApiOperation({
    summary: 'Connect a Google identity to the signed-in account',
    description:
      'The Google email must equal the account email. Acts on the ' +
      'authenticated account only — no account identifier is accepted.',
  })
  @ApiResponse({ status: 201, type: SignInResponseDTO })
  @ApiResponse({
    status: 401,
    description: 'invalid_intent, or the Google token failed verification.',
  })
  @ApiResponse({
    status: 409,
    description:
      'google_email_mismatch, google_identity_in_use or google_already_linked',
  })
  @ApiResponse({ status: 429, description: 'Too many requests.' })
  async link(
    @Body() body: GoogleLinkDTO,
    @Request() req: AuthenticatedRequest,
  ): Promise<SignInResponseDTO> {
    return await this.authService.linkGoogle(req.user.id, body);
  }
}
