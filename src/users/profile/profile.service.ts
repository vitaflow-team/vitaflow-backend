import { UserRepository } from '@/repositories/users/user.repository';
import { AppError } from '@/utils/app.erro';
import { UploadService } from '@/utils/upload.service';
import { Injectable } from '@nestjs/common';
import { ProfileDTO } from './profile.Dto';

@Injectable()
export class ProfileService {
  constructor(
    private user: UserRepository,

    private uploadService: UploadService,
  ) {}

  async postProfile(
    avatar: Express.Multer.File,
    body: ProfileDTO,
    userId: string,
  ) {
    const existingUser = await this.user.getUserProfile(userId);
    if (!existingUser) {
      throw new AppError('Usuário não encontrado.', 402);
    }

    const {
      addressLine1,
      addressLine2,
      city,
      district,
      postalCode,
      region,
      birthDate,
      name,
      phone,
    } = body;

    const address = {
      addressLine1,
      addressLine2,
      city,
      district,
      postalCode,
      region,
    };

    let avatarUrl = existingUser.avatar;
    if (avatar) {
      avatarUrl = await this.uploadService.uploadImage(avatar);
      if (existingUser.avatar) {
        await this.uploadService.deleteImage(existingUser.avatar);
      }
    }

    const userBirthDate = birthDate ? new Date(birthDate) : null;

    const result = await this.user.updateUserProfile(
      userId,
      {
        birthDate: userBirthDate,
        name,
        phone,
        avatar: avatarUrl,
      },
      address,
    );

    return result;
  }

  async getProfile(userId: string) {
    const user = await this.user.getUserProfile(userId);

    if (!user) {
      throw new AppError('Usuário não encontrado.', 402);
    }

    const signedAvatarUrl = user.avatar
      ? await this.uploadService.getSignedUrl(user.avatar)
      : null;

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      birthDate: user.birthDate,
      avatar: signedAvatarUrl,
      phone: user.phone ?? null,
      address: user.userAddresses
        ? {
            addressLine1: user.userAddresses.addressLine1,
            addressLine2: user.userAddresses.addressLine2,
            district: user.userAddresses.district,
            city: user.userAddresses.city,
            region: user.userAddresses.region,
            postalCode: user.userAddresses.postalCode,
          }
        : null,
    };
  }
}
