import { DualBucketThrottlerGuard } from '@/auth/dualBucketThrottler.guard';
import { SignInResponseDTO } from '@/auth/signInResponse.Dto';
import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SignInDTO } from './signin.Dto';
import { SignInService } from './signin.service';

@ApiTags('User')
@Controller('users')
export class SignInController {
  constructor(private readonly service: SignInService) {}

  @ApiOperation({
    summary: 'User Sign-In',
    description: 'Authenticate user and return JWT token.',
  })
  @ApiBody({ type: SignInDTO })
  @ApiResponse({
    status: 201,
    description: 'User authenticated successfully.',
    type: SignInResponseDTO,
  })
  @ApiResponse({ status: 400, description: 'Invalid email or password.' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized user or inactive account.',
    schema: {
      example: {
        statusCode: 401,
        message: 'Usuário não autorizado.',
      },
    },
  })
  @ApiResponse({ status: 429, description: 'Too many requests.' })
  @Post('signin')
  @UseGuards(DualBucketThrottlerGuard)
  async postSignIn(@Body() body: SignInDTO): Promise<SignInResponseDTO> {
    return await this.service.postSignIn(body);
  }
}
