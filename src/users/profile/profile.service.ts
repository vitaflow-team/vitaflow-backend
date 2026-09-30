import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { ProgressPhotosRepository } from '@/repositories/progress-photos/progressPhotos.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { AppError } from '@/utils/app.erro';
import { UploadService } from '@/utils/upload.service';
import { Injectable, Logger } from '@nestjs/common';
import { UserAddress } from '@prisma/client';
import { deriveExpiry } from '../subscription/subscriptionExpiry';
import { assertValidAvatar } from './avatarUpload';
import { ProfileAddressDTO } from './profileAddress.Dto';
import { ProfileDTO } from './profile.Dto';
import { ProfileResponseDTO } from './profileResponse.Dto';
import { ProfileUpdateResponseDTO } from './profileUpdateResponse.Dto';

@Injectable()
export class ProfileService {
  private readonly logger = new Logger(ProfileService.name);

  constructor(
    private readonly user: UserRepository,
    private readonly uploadService: UploadService,
    private readonly clients: ClientsRepository,
    private readonly progressPhotos: ProgressPhotosRepository,
  ) {}

  async postProfile(
    avatar: Express.Multer.File,
    body: ProfileDTO,
    userId: string,
  ): Promise<ProfileUpdateResponseDTO> {
    const existingUser = await this.user.getUserProfile(userId);
    if (!existingUser) {
      throw new AppError('Usuário não encontrado.', 404);
    }

    const avatarUrl = await this.replaceAvatar(avatar, existingUser.avatar);

    const { birthDate, name, phone } = body;
    const updated = await this.user.updateUserProfile(
      userId,
      {
        birthDate: birthDate ? new Date(birthDate) : null,
        name,
        phone,
        avatar: avatarUrl,
      },
      this.toAddressInput(body),
    );

    return this.toProfileUpdateResponse(updated);
  }

  private toAddressInput({
    addressLine1,
    addressLine2,
    city,
    district,
    postalCode,
    region,
  }: ProfileDTO): ProfileAddressDTO {
    return { addressLine1, addressLine2, city, district, postalCode, region };
  }

  // Returns the avatar URL to store: the current one when no file was sent,
  // otherwise the newly uploaded one.
  private async replaceAvatar(
    avatar: Express.Multer.File,
    currentAvatar: string | null,
  ): Promise<string | null> {
    if (!avatar) {
      return currentAvatar;
    }

    assertValidAvatar(avatar);
    const avatarUrl = await this.uploadService.uploadImage(avatar);
    // Only a file this app hosts is ours to delete — a Google avatar URL
    // could otherwise resolve to a same-named object in our bucket.
    if (this.uploadService.isBucketUrl(currentAvatar)) {
      await this.uploadService.deleteImage(currentAvatar!);
    }
    return avatarUrl;
  }

  // Named fields only: spreading the row would also serialize the password
  // hash and the Stripe identifiers.
  private toProfileUpdateResponse(
    updated: Awaited<ReturnType<UserRepository['updateUserProfile']>>,
  ): ProfileUpdateResponseDTO {
    return {
      id: updated.id,
      name: updated.name,
      email: updated.email,
      birthDate: updated.birthDate,
      avatar: updated.avatar,
      phone: updated.phone,
      active: updated.active,
      productId: updated.productId,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
      address: updated.address,
    };
  }

  async getProfile(userId: string): Promise<ProfileResponseDTO> {
    const user = await this.user.getUserProfile(userId);

    if (!user) {
      throw new AppError('Usuário não encontrado.', 404);
    }

    const signedAvatarUrl = user.avatar
      ? await this.uploadService.getSignedUrl(user.avatar)
      : null;

    // Members simply have no client rows, so the count is naturally 0 for
    // them — no branch on the user's product type needed.
    const clientsCount = await this.clients.countByProfessionalId(userId);

    return this.toProfileResponse(user, signedAvatarUrl, clientsCount);
  }

  private toProfileResponse(
    user: NonNullable<Awaited<ReturnType<UserRepository['getUserProfile']>>>,
    signedAvatarUrl: string | null,
    clientsCount: number,
  ): ProfileResponseDTO {
    // The product is loaded here, so Gratuito (price 0) is recognised and
    // never reports an expiry, however stale its subscription columns are.
    const expiry = deriveExpiry({
      status: user.subscriptionStatus,
      cancelAt: user.subscriptionCancelAt,
      periodEnd: user.subscriptionCurrentPeriodEnd,
      planPrice: user.product?.price ?? null,
    });

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
      // Derived server-side so the UI only formats and words them.
      expiresAt: expiry.expiresAt,
      autoRenew: expiry.autoRenew,
      // Deliberately a boolean, not the id: this response reaches client
      // components, so the raw Stripe identifiers never leave the server.
      hasStripeCustomer: Boolean(user.stripeCustomerId),
      clientsCount,
      address: this.toAddressResponse(user.userAddresses),
    };
  }

  private toAddressResponse(
    address: UserAddress | null,
  ): ProfileResponseDTO['address'] {
    if (!address) {
      return null;
    }
    return {
      addressLine1: address.addressLine1,
      addressLine2: address.addressLine2,
      district: address.district,
      city: address.city,
      region: address.region,
      postalCode: address.postalCode,
    };
  }

  async deleteProfile(userId: string): Promise<void> {
    const user = await this.user.getUserProfile(userId);

    if (!user) {
      throw new AppError('Usuário não encontrado.', 404);
    }

    const avatar = user.avatar;
    // Captured before the transaction removes the rows, same as `avatar`
    // above — every progress photo this account ever uploaded (ADR-001/
    // PRD Business Rules), deleted from storage the same way the avatar is.
    const progressPhotos = await this.progressPhotos.findAllByUser(userId);

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

    // Every object deleted independently: one failure must not stop the
    // rest from being attempted, and storageFilename is always this app's
    // own object key (never an external URL), so no isBucketUrl gate here.
    for (const photo of progressPhotos) {
      try {
        await this.uploadService.deleteImage(photo.storageFilename);
      } catch {
        this.logger.error(
          `account_deleted_progress_photo_removal_failed user=${userId} photoId=${photo.id}`,
        );
      }
    }
  }
}
