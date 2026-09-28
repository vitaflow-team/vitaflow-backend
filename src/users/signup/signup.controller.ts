import { DualBucketThrottlerGuard } from '@/auth/dualBucketThrottler.guard';
import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AccountResponseDTO } from './accountResponse.Dto';
import { ActiveDTO } from './activate.Dto';
import { SignUpDTO } from './signup.Dto';
import { SignUpService } from './signup.service';

@ApiTags('User')
@Controller('users')
export class SignUpController {
  constructor(private readonly service: SignUpService) {}

  @ApiOperation({
    summary: 'Creates a new user account',
    description:
      'Creates a new user account with an inactive status and generates an activation token.',
  })
  @ApiResponse({
    status: 201,
    description: 'User created successfully.',
    type: AccountResponseDTO,
  })
  @ApiResponse({
    status: 400,
    description:
      'Invalid input, password mismatch, or e-mail already in use by another user.',
  })
  @ApiResponse({ status: 429, description: 'Too many requests.' })
  @ApiResponse({ status: 500, description: 'Free plan unavailable.' })
  @Post('signup')
  @UseGuards(DualBucketThrottlerGuard)
  async postNewUser(@Body() body: SignUpDTO): Promise<AccountResponseDTO> {
    return await this.service.postNewUser(body);
  }

  @ApiOperation({
    summary: 'Activate a new user account',
  })
  @ApiResponse({
    status: 201,
    description: 'User account activated.',
    type: AccountResponseDTO,
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid or expired token.',
  })
  @ApiResponse({
    status: 429,
    description: 'Too many requests.',
  })
  @Post('/activate')
  @UseGuards(DualBucketThrottlerGuard)
  async activateNewUser(@Body() body: ActiveDTO): Promise<AccountResponseDTO> {
    return await this.service.activateNewUser(body);
  }
}
