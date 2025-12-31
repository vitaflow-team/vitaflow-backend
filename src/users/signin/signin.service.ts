import { UserRepository } from '@/repositories/users/user.repository';
import { AppError } from '@/utils/app.erro';
import { PasswordHash } from '@/utils/password.hash';
import { UploadService } from '@/utils/upload.service';
import { JwtService } from '@nestjs/jwt';
import { SignInDTO } from './signin.Dto';

const UnauthorizedUser = 'Usuário não autorizado.';
const AccountInactive = UnauthorizedUser + ' Conta inativa.';

import { Injectable } from '@nestjs/common';

@Injectable()
export class SignInService {
  constructor(
    private user: UserRepository,

    private hash: PasswordHash,

    private jwtService: JwtService,

    private uploadService: UploadService,
  ) {}

  async postSignIn({ email, password, socialLogin }: SignInDTO) {
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
      productType: user.product?.type,
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
      productType: user.product?.type,
      productGroupId: user.product?.groupId,
      accessToken: await this.jwtService.signAsync(payload),
    };
  }
}
