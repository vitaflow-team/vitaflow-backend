import { DualBucketThrottlerGuard } from '@/auth/dualBucketThrottler.guard';
import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { NewPasswordDto } from './newPassword.Dto';
import { RecoverpassDTO } from './recoverpass.Dto';
import { RecoverpassService } from './recoverpass.service';

@ApiTags('User')
@Controller('users')
export class RecoverpassController {
  constructor(private readonly recoverpassService: RecoverpassService) {}

  @ApiOperation({
    summary: 'Send password recovery email',
    description:
      'Creates a password recovery token and sends an email to the user.',
  })
  @ApiResponse({
    status: 201,
    description:
      'Recovery requested. The same response is returned whether or not the email has an account.',
    type: Boolean,
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid email.',
  })
  @ApiResponse({
    status: 429,
    description: 'Too many requests.',
  })
  @Post('recoverpass')
  @UseGuards(DualBucketThrottlerGuard)
  async postRecoverpass(@Body() body: RecoverpassDTO): Promise<true> {
    return await this.recoverpassService.postRecoverpass(body);
  }

  @ApiOperation({
    summary: 'Set a new password with a recovery token',
    description:
      'Consumes a valid password recovery token and replaces the password.',
  })
  @ApiResponse({
    status: 201,
    description: 'Password changed.',
    type: Boolean,
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid or expired token.',
  })
  @ApiResponse({
    status: 401,
    description: 'Password confirmation does not match.',
  })
  @ApiResponse({
    status: 429,
    description: 'Too many requests.',
  })
  @Post('newpassword')
  @UseGuards(DualBucketThrottlerGuard)
  async postChangePassword(@Body() body: NewPasswordDto): Promise<true> {
    return await this.recoverpassService.postChangePassword(body);
  }
}
