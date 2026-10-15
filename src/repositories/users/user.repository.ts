import { PrismaService } from '@/database/prisma.service';
import { ProfileAddressDTO } from '@/users/profile/profileAddress.Dto';
import { escapeLikePattern } from '@/utils/escapeLikePattern';
import { Injectable } from '@nestjs/common';
import {
  BackofficeTier,
  Prisma,
  Product,
  ProductType,
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

  // Scoped email uniqueness is now partial (platform-admin-access ADR-005
  // coexistence): a backoffice staff row and a customer row can legitimately
  // share one email as two separate Users rows. Callers that must consider
  // every account at that email (sign-in password matching) use this
  // instead of findByEmail, which only ever returns one of them.
  async findAllByEmail(
    email: string,
  ): Promise<(Users & { product: Product | null })[]> {
    return await this.prisma.users.findMany({
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

  // Scoped to isBackoffice: false, which the Users_email_customer_key
  // partial unique index (platform-admin-access ADR-005 coexistence)
  // guarantees matches at most one row — unlike findByEmailInsensitive,
  // which can now hit either a customer or a staff row sharing the same
  // email with no way to tell which. Google sign-in uses this one: it must
  // never match, and thereby auto-activate or OAuth-link, a staff invite
  // row, since staff are only ever meant to activate through the admin's
  // invitation-token link (ADR-005), not by anyone proving they own the
  // invited email address via Google.
  async findCustomerByEmailInsensitive(
    email: string,
  ): Promise<(Users & { product: Product | null }) | null> {
    return await this.prisma.users.findFirst({
      where: {
        email: { equals: email, mode: 'insensitive' },
        isBackoffice: false,
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

  // Staff activation sets both the real password (never collected at
  // invite time, unlike customer signup) and `active: true` in the same
  // token-consuming transaction as every other token-authorized change.
  async activateStaffWithTokenAndPassword(
    token: UsersToken,
    password: string,
  ): Promise<Users | null> {
    return await this.prisma.$transaction(async (tx) => {
      if (!(await this.consumeToken(tx, token.id))) {
        return null;
      }

      return await tx.users.update({
        where: { id: token.userID },
        data: { active: true, password },
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

  // Scoped to isBackoffice rows only, so a same-email customer row (ADR-005
  // coexistence) is never mistaken for the staff row.
  async findStaffByEmail(email: string): Promise<Users | null> {
    return await this.prisma.users.findFirst({
      where: {
        email: { equals: escapeLikePattern(email), mode: 'insensitive' },
        isBackoffice: true,
      },
    });
  }

  async findManyByIds(ids: string[]): Promise<Users[]> {
    if (ids.length === 0) return [];
    return await this.prisma.users.findMany({ where: { id: { in: ids } } });
  }

  async findAllBackofficeStaff(): Promise<Users[]> {
    return await this.prisma.users.findMany({
      where: { isBackoffice: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  async countAdmins(): Promise<number> {
    return await this.prisma.users.count({
      where: { isBackoffice: true, backofficeTier: BackofficeTier.ADMIN },
    });
  }

  async updateBackofficeTier(id: string, tier: BackofficeTier): Promise<Users> {
    return await this.prisma.users.update({
      where: { id },
      data: { backofficeTier: tier },
    });
  }

  // Never deletes the row (consistent with every other lifecycle-ending
  // action across the Academia module) — `backofficeTier` is left as-is,
  // irrelevant once isBackoffice is false (platform-admin-access ADR-005).
  async setIsBackoffice(id: string, value: boolean): Promise<Users> {
    return await this.prisma.users.update({
      where: { id },
      data: { isBackoffice: value },
    });
  }

  // Every non-staff account the backoffice directory can find (platform-
  // admin-access ADR-006): staff themselves (isBackoffice: true) are never
  // included — they have their own screen, GET /backoffice/staff.
  async searchDirectory(
    search: string | undefined,
    productType: ProductType | undefined,
  ): Promise<(Users & { product: { type: ProductType } | null })[]> {
    return await this.prisma.users.findMany({
      where: {
        isBackoffice: false,
        ...(productType ? { product: { type: productType } } : {}),
        ...(search
          ? {
              OR: [
                {
                  name: {
                    contains: escapeLikePattern(search),
                    mode: 'insensitive',
                  },
                },
                {
                  email: {
                    contains: escapeLikePattern(search),
                    mode: 'insensitive',
                  },
                },
              ],
            }
          : {}),
      },
      include: { product: { select: { type: true } } },
      orderBy: { name: 'asc' },
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
