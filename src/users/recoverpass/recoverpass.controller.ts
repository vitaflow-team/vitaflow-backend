import { UserRepository } from '@/repositories/users/user.repository';
import { AppError } from '@/utils/app.erro';
import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { RecoverpassDTO } from './recoverpass.Dto';

@ApiTags('User')
@Controller('users')
export class RecoverpassController {
  constructor(private user: UserRepository) {}

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
    const { email } = body;

    const userExists = await this.user.findByEmail({ email });
    if (!userExists) {
      throw new AppError('E-mail não encontrado.', 400);
    }

    return;
  }
}
