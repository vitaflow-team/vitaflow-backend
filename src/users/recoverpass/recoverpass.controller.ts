import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { NewPasswordDto } from './newPassword.Dto';
import { RecoverpassDTO } from './recoverpass.Dto';
import { RecoverpassService } from './recoverpass.service';

@ApiTags('User')
@Controller('users')
export class RecoverpassController {
  constructor(private recoverpassService: RecoverpassService) {}

  @ApiOperation({
    summary: 'Send password recovery email',
    description:
      'Creates a password recovery token and sends an email to the user.',
  })
  @ApiResponse({
    status: 201,
    description: 'Password recovery email sent successfully.',
  })
  @ApiResponse({
    status: 400,
    description: 'Email not found.',
  })
  @Post('recoverpass')
  async postRecoverpass(@Body() body: RecoverpassDTO) {
    return await this.recoverpassService.postRecoverpass(body);
  }

  @ApiOperation({
    summary: 'Verify password recovery token',
    description:
      'Validates whether a provided password recovery token is valid, expired, or invalid.',
  })
  @ApiResponse({
    status: 200,
    description: 'Token is valid.',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid or expired token.',
  })
  @Post('newpassword')
  async postChangePassword(@Body() body: NewPasswordDto) {
    return await this.recoverpassService.postChangePassword(body);
  }
}
