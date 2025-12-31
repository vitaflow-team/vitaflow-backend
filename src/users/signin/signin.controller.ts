import { Body, Controller, Post } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SignInDTO } from './signin.Dto';
import { SignInService } from './signin.service';

@ApiTags('User')
@Controller('users')
export class SignInController {
  constructor(private service: SignInService) {}

  @ApiOperation({
    summary: 'User Sign-In',
    description: 'Authenticate user and return JWT token.',
  })
  @ApiBody({ type: SignInDTO })
  @ApiResponse({
    status: 201,
    description: 'User authenticated successfully.',
    schema: {
      example: {
        id: 'cuid-user-456',
        name: 'John Doe',
        email: 'johndoe@example.com',
        accessToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
        picture: 'https://example.com/profile.jpg',
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized user or inactive account.',
    schema: {
      example: {
        statusCode: 401,
        message: 'Unauthorized user.',
      },
    },
  })
  @Post('signin')
  async postSignIn(@Body() body: SignInDTO) {
    return this.service.postSignIn(body);
  }
}
