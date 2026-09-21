import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { AppError } from '@/utils/app.erro';
import { UploadService } from '@/utils/upload.service';
import { Injectable, Logger } from '@nestjs/common';
import { ProfileDTO } from './profile.Dto';

@Injectable()
export class ProfileService {
  private readonly logger = new Logger(ProfileService.name);

  constructor(
    private user: UserRepository,

    private uploadService: UploadService,

    private clients: ClientsRepository,
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

    // Members simply have no client rows, so the count is naturally 0 for
    // them — no branch on the user's product type needed.
    const clientsCount = await this.clients.countByProfessionalId(userId);

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      birthDate: user.birthDate,
      avatar: signedAvatarUrl,
      phone: user.phone ?? null,
      productId: user.productId,
      productName: user.product?.name ?? null,
      // The session's plan claims are refreshed from this response, so the
      // current product's audience and group travel with it instead of
      // being inferred on the client.
      productType: user.product?.type ?? null,
      productGroupId: user.product?.groupId ?? null,
      subscriptionStatus: user.subscriptionStatus,
      subscriptionCancelAt: user.subscriptionCancelAt,
      subscriptionCurrentPeriodEnd: user.subscriptionCurrentPeriodEnd,
      // Deliberately a boolean, not the id: this response reaches client
      // components, so the raw Stripe identifiers never leave the server.
      hasStripeCustomer: Boolean(user.stripeCustomerId),
      clientsCount,
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

  async deleteProfile(userId: string): Promise<void> {
    const user = await this.user.getUserProfile(userId);

    if (!user) {
      throw new AppError('Usuário não encontrado.', 404);
    }

    const avatar = user.avatar;

    await this.user.deleteAccount(userId);

    // Id and timestamp only: this line outlives the account, so it must not
    // carry the email or name we were just asked to erase.
    this.logger.log(
      `account_deleted user=${userId} at=${new Date().toISOString()}`,
    );

    // Storage runs outside the transaction, so it can only be touched once
    // the erasure is committed — and only for files this app hosts. A
    // failure here leaves an orphan object, never a half-deleted account.
    if (this.uploadService.isBucketUrl(avatar)) {
      try {
        await this.uploadService.deleteImage(avatar!);
      } catch {
        this.logger.error(
          `account_deleted_avatar_removal_failed user=${userId}`,
        );
      }
    }
  }
}
