import { UserRepository } from '@/repositories/users/user.repository';
import { AppError } from '@/utils/app.erro';
import { PasswordHash } from '@/utils/password.hash';
import { UploadService } from '@/utils/upload.service';
import { Body, Controller, Post } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SignInDTO } from './signin.Dto';

const UnauthorizedUser = 'Usuário não autorizado.';
const AccountInactive = UnauthorizedUser + ' Conta inativa.';

@ApiTags('User')
@Controller('users')
export class SignInController {
  constructor(
    private user: UserRepository,

    private hash: PasswordHash,

    private jwtService: JwtService,

    private uploadService: UploadService,
  ) {}

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
    const { email, password, socialLogin } = body;

    const user = await this.user.findByEmail({ email });
    if (!user) {
      throw new AppError(UnauthorizedUser, 401);
    }

    if (!user.active) {
      throw new AppError(AccountInactive, 401);
    }

    if (!socialLogin) {
      const validPassword = await this.hash.compareHash(
        password,
        user.password,
      );
      if (!validPassword) {
        throw new AppError(UnauthorizedUser, 401);
      }
    }

    const signedAvatarUrl = user.avatar
      ? await this.uploadService.getSignedUrl(user.avatar)
      : null;

    const payload = {
      name: user.name,
      email: user.email,
      productId: user.productId,
      productGroupId: user.product?.groupId,
      avatar: signedAvatarUrl,
      id: user.id,
    };

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      avatar: signedAvatarUrl,
      productId: user.productId,
      productGroupId: user.product?.groupId,
      accessToken: await this.jwtService.signAsync(payload),
    };
  }
}
