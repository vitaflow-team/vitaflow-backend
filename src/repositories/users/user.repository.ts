import { PrismaService } from '@/database/prisma.service';
import { ProfileAddressDTO } from '@/users/profile/profileAddress.Dto';
import { escapeLikePattern } from '@/utils/escapeLikePattern';
import { Injectable } from '@nestjs/common';
import {
  Prisma,
  Product,
  UserAddress,
  Users,
  UsersToken,
} from '@prisma/client';

@Injectable()
export class UserRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: Prisma.UsersCreateInput): Promise<Users> {
    return await this.prisma.users.create({
      data,
    });
  }

  async findUnique(where: Prisma.UsersWhereUniqueInput): Promise<Users | null> {
    return await this.prisma.users.findUnique({
      where,
    });
  }

  // Exact but case-insensitive: accounts stored before emails were
  // normalized (mixed case) still resolve from the lowercased input.
  async findByEmail(
    email: string,
  ): Promise<(Users & { product: Product | null }) | null> {
    return await this.prisma.users.findFirst({
      where: {
        email: { equals: escapeLikePattern(email), mode: 'insensitive' },
      },
      include: {
        product: true,
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findByEmailInsensitive(
    email: string,
  ): Promise<(Users & { product: Product | null }) | null> {
    return await this.prisma.users.findFirst({
      where: {
        email: {
          equals: email,
          mode: 'insensitive',
        },
      },
      include: {
        product: true,
      },
    });
  }

  async findByIdWithProduct(
    id: string,
  ): Promise<(Users & { product: Product | null }) | null> {
    return await this.prisma.users.findUnique({
      where: { id },
      include: {
        product: true,
      },
    });
  }

  async findByStripeCustomerId(
    stripeCustomerId: string,
  ): Promise<Users | null> {
    return await this.prisma.users.findUnique({
      where: { stripeCustomerId },
    });
  }

  async updateSubscription(
    id: string,
    data: {
      productId?: string | null;
      stripeCustomerId?: string;
      stripeSubscriptionId?: string | null;
      subscriptionStatus?: string | null;
      subscriptionCancelAt?: Date | null;
      subscriptionCurrentPeriodEnd?: Date | null;
    },
  ): Promise<Users & { product: Product | null }> {
    return await this.prisma.users.update({
      where: { id },
      data,
      include: {
        product: true,
      },
    });
  }

  async activateUser(id: string): Promise<Users> {
    return await this.prisma.users.update({
      where: { id },
      data: { active: true },
    });
  }

  async updatePassword(id: string, password: string): Promise<Users> {
    return await this.prisma.users.update({
      where: { id },
      data: { password },
    });
  }

  // Consuming the token and applying its effect share one transaction, so a
  // token works exactly once: a concurrent or repeated use finds nothing
  // left to delete, changes nothing and gets null.
  async activateUserWithToken(token: UsersToken): Promise<Users | null> {
    return await this.prisma.$transaction(async (tx) => {
      if (!(await this.consumeToken(tx, token.id))) {
        return null;
      }

      return await tx.users.update({
        where: { id: token.userID },
        data: { active: true },
      });
    });
  }

  async updatePasswordWithToken(
    token: UsersToken,
    password: string,
  ): Promise<Users | null> {
    return await this.prisma.$transaction(async (tx) => {
      if (!(await this.consumeToken(tx, token.id))) {
        return null;
      }

      return await tx.users.update({
        where: { id: token.userID },
        data: { password },
      });
    });
  }

  private async consumeToken(
    tx: Prisma.TransactionClient,
    tokenId: string,
  ): Promise<boolean> {
    const { count } = await tx.usersToken.deleteMany({
      where: { id: tokenId, expiresAt: { gt: new Date() } },
    });

    return count === 1;
  }

  async getUserProfile(
    userId: string,
  ): Promise<
    | (Users & { userAddresses: UserAddress | null; product: Product | null })
    | null
  > {
    return await this.prisma.users.findUnique({
      where: { id: userId },
      include: {
        userAddresses: true,
        product: true,
      },
    });
  }

  // Deletion is explicit because no relation in the schema cascades, and
  // `Client.userId` is a plain column rather than a foreign key. One
  // interactive transaction keeps it all-or-nothing: children first, the
  // user last, so no statement ever hits a dangling reference.
  async deleteAccount(userId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.measurementRecord.deleteMany({ where: { userId } });
      await tx.progressPhoto.deleteMany({ where: { userId } });
      await tx.notification.deleteMany({ where: { userId } });
      await tx.notificationPreference.deleteMany({ where: { userId } });
      await tx.professionalProfile.deleteMany({ where: { userId } });
      await tx.connectionRequest.deleteMany({
        where: { OR: [{ userId }, { professionalId: userId }] },
      });
      await tx.usersToken.deleteMany({ where: { userID: userId } });
      await tx.userAddress.deleteMany({ where: { userId } });
      await tx.oAuthIdentity.deleteMany({ where: { userId } });
      // Clients this user registered as a professional are their data.
      await tx.client.deleteMany({ where: { professionalId: userId } });
      // Clients registered by *other* professionals belong to them: keep
      // the record and only drop the link to the user going away.
      await tx.client.updateMany({
        where: { userId },
        data: { userId: null },
      });
      await tx.users.delete({ where: { id: userId } });
    });
  }

  async updateUserProfile(
    id: string,
    userData: Prisma.UsersUpdateInput,
    address?: ProfileAddressDTO,
  ): Promise<Users & { address: ProfileAddressDTO | null }> {
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.users.update({
        where: { id },
        data: {
          name: userData.name,
          birthDate: userData.birthDate,
          avatar: userData.avatar,
          phone: userData.phone,
        },
      });

      if (address) {
        await tx.userAddress.upsert({
          where: { userId: id },
          update: address,
          create: { userId: id, ...address },
        });
      }

      return { ...user, address: address ?? null };
    });
  }
}
