import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ActiveDTO } from './activate.Dto';
import { SignUpDTO } from './signup.Dto';
import { SignUpService } from './signup.service';

@ApiTags('User')
@Controller('users')
export class SignUpController {
  constructor(private service: SignUpService) {}

  @ApiOperation({
    summary: 'Creates a new user account',
    description:
      'Creates a new user account with an inactive status and generates an activation token.',
  })
  @ApiResponse({
    status: 201,
    description: 'User created successfully.',
    example: {
      id: 'cuid-user-456',
      name: 'John Doe',
      email: 'johndoe@example.com',
      avatar: 'https://example.com/avatar.jpg',
      active: false,
      createdAt: '2025-02-25T01:25:13.248Z',
      updatedAt: '2025-02-25T01:25:13.248Z',
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Este e-mail já está sendo usado por outro usuário.',
  })
  @Post('signup')
  async postNewUser(@Body() body: SignUpDTO) {
    return this.service.postNewUser(body);
  }

  @ApiOperation({
    summary: 'Activate a new user account',
  })
  @ApiResponse({
    status: 201,
    description: 'User account activated.',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid or expired token.',
  })
  @Post('/activate')
  async activateNewUser(@Body() body: ActiveDTO) {
    return this.service.activateNewUser(body);
  }
}
