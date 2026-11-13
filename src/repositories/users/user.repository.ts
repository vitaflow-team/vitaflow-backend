import type { ActivePremiumUserRow } from '@/backoffice/metrics/ltvBySegment.util';
import type { CohortUserRow } from '@/backoffice/metrics/cohortRetention.util';
import { PrismaService } from '@/database/prisma.service';
import { ProfileAddressDTO } from '@/users/profile/profileAddress.Dto';
import { PAID_STATUSES } from '@/users/subscription/subscriptionExpiry';
import { escapeLikePattern } from '@/utils/escapeLikePattern';
import { startOfMonth, startOfNextMonth } from '@/utils/monthRange';
import { Injectable } from '@nestjs/common';
import {
  BackofficeTier,
  Prisma,
  Product,
  ProductTier,
  ProductType,
  UserAddress,
  Users,
  UsersToken,
} from '@prisma/client';

export interface RegisteredByRoleAndPlanCount {
  role: ProductType;
  free: number;
  premium: number;
}

export interface RoleCount {
  role: ProductType;
  count: number;
}

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

  async findByAsaasCustomerId(asaasCustomerId: string): Promise<Users | null> {
    return await this.prisma.users.findUnique({
      where: { asaasCustomerId },
    });
  }

  async updateSubscription(
    id: string,
    data: {
      productId?: string | null;
      asaasCustomerId?: string;
      asaasSubscriptionId?: string | null;
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

  // Mirrors AcademiaRepository.findChurnRiskBaselineAt/markChurnRiskBaselined
  // (churn-risk-alert-independent ADR-008): null = never evaluated by the
  // independent-professional churn-risk feature yet.
  async findIndependentChurnRiskBaselineAt(
    professionalId: string,
  ): Promise<Date | null> {
    const user = await this.prisma.users.findUnique({
      where: { id: professionalId },
      select: { independentChurnRiskBaselineAt: true },
    });
    return user?.independentChurnRiskBaselineAt ?? null;
  }

  async markIndependentChurnRiskBaselined(
    professionalId: string,
    at: Date,
  ): Promise<void> {
    await this.prisma.users.update({
      where: { id: professionalId },
      data: { independentChurnRiskBaselineAt: at },
    });
  }

  async findManyByIds(ids: string[]): Promise<Users[]> {
    if (ids.length === 0) return [];
    return await this.prisma.users.findMany({ where: { id: { in: ids } } });
  }

  // Batch type resolution for a list of professional ids (churn-risk-alert-
  // independent TechSpec § Core Interfaces) — reuses the same
  // product/select: { type: true } shape as searchDirectory, just batched by
  // id instead of filtered by a single criterion.
  async findProductTypesByIds(
    ids: string[],
  ): Promise<Map<string, ProductType>> {
    if (ids.length === 0) return new Map();
    const rows = await this.prisma.users.findMany({
      where: { id: { in: ids } },
      select: { id: true, product: { select: { type: true } } },
    });
    const types = new Map<string, ProductType>();
    for (const row of rows) {
      if (row.product) types.set(row.id, row.product.type);
    }
    return types;
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

  // Platform metrics dashboard (task_01): every registered user has exactly
  // one product at all times (PRD Business Rules), so one count() per
  // role×plan cell is used instead of groupBy — unlike groupBy, it never
  // silently omits a cell with zero users, the exact gap UT-002 guards
  // against. "Premium" collapses ProductTier.STANDARD and PREMIUM (any paid
  // plan); only FREE is "free" — the PRD's Free/Premium framing only has
  // two buckets even though ProductTier itself has three values.
  async countRegisteredByRoleAndPlan(): Promise<
    RegisteredByRoleAndPlanCount[]
  > {
    return await Promise.all(
      Object.values(ProductType).map(async (role) => {
        const [free, premium] = await Promise.all([
          this.prisma.users.count({
            where: {
              isBackoffice: false,
              product: { type: role, tier: ProductTier.FREE },
            },
          }),
          this.prisma.users.count({
            where: {
              isBackoffice: false,
              product: { type: role, tier: { not: ProductTier.FREE } },
            },
          }),
        ]);
        return { role, free, premium };
      }),
    );
  }

  // New registrations this month, grouped the same role-by-role way as
  // countRegisteredByRoleAndPlan above (see its comment for why not groupBy).
  async countNewRegistrationsThisMonth(): Promise<RoleCount[]> {
    const now = new Date();
    const createdAt = { gte: startOfMonth(now), lt: startOfNextMonth(now) };
    return await Promise.all(
      Object.values(ProductType).map(async (role) => ({
        role,
        count: await this.prisma.users.count({
          where: { isBackoffice: false, product: { type: role }, createdAt },
        }),
      })),
    );
  }

  // "Canceled this month" reads subscriptionCancelAt's *current* value, so a
  // cancel-then-reactivate within the month (which clears it back to null)
  // is never counted (PRD Business Rules, UT-006) — a null value never
  // satisfies a gte/lt range, so this needs no extra "not null" check.
  async countCanceledThisMonth(): Promise<RoleCount[]> {
    const now = new Date();
    const subscriptionCancelAt = {
      gte: startOfMonth(now),
      lt: startOfNextMonth(now),
    };
    return await Promise.all(
      Object.values(ProductType).map(async (role) => ({
        role,
        count: await this.prisma.users.count({
          where: {
            isBackoffice: false,
            product: { type: role },
            subscriptionCancelAt,
          },
        }),
      })),
    );
  }

  // Sums each active subscriber's own product price (ADR-001: platform
  // subscriptions only, "active" = PAID_STATUSES, the same definition
  // premium access already uses). `price` lives on `Product`, not `Users`,
  // so a per-subscriber-weighted total can't come from a single-model
  // `_sum`/`groupBy` aggregate the way `countAdmins` uses `count` — a
  // product-level aggregate would sum each product's price once, not once
  // per active subscriber. This reads every active user's product price
  // directly and reduces client-side instead.
  async sumActiveSubscriptionRevenue(): Promise<number> {
    const activeUsers = await this.prisma.users.findMany({
      where: {
        isBackoffice: false,
        subscriptionStatus: { in: PAID_STATUSES },
      },
      select: { product: { select: { price: true } } },
    });

    return activeUsers.reduce(
      (total, user) => total + (user.product?.price ?? 0),
      0,
    );
  }

  // Cohort retention / LTV by segment (cohort-ltv-analysis ADR-007): one bulk
  // fetch for every user created since `since`, bucketed and zero-filled in
  // memory by computeCohortRetention — not a per-cell count() — since the
  // retention grid has up to 12 cohort months × 12 elapsed months × 4 roles ×
  // 2 plans, and a per-cell query at that scale would be hundreds of
  // round-trips per request.
  async findCohortUsers(since: Date): Promise<CohortUserRow[]> {
    const users = await this.prisma.users.findMany({
      where: { isBackoffice: false, createdAt: { gte: since } },
      select: {
        createdAt: true,
        subscriptionCancelAt: true,
        product: { select: { type: true, tier: true } },
      },
    });

    return users
      .filter((user) => user.product)
      .map((user) => ({
        cohortMonthStart: startOfMonth(user.createdAt),
        subscriptionCancelAt: user.subscriptionCancelAt,
        productType: user.product!.type,
        tier: user.product!.tier,
      }));
  }

  // One bulk fetch of every currently-active Premium subscriber
  // (cohort-ltv-analysis ADR-001, ADR-004: Free excluded from both the ARPU
  // numerator and the churn-rate population), bucketed by role in
  // computeLtvBySegment. "Active" reuses the same PAID_STATUSES definition
  // as sumActiveSubscriptionRevenue above.
  async findActivePremiumUsersForLtv(
    now: Date,
  ): Promise<ActivePremiumUserRow[]> {
    const cancelRange = { gte: startOfMonth(now), lt: startOfNextMonth(now) };
    const users = await this.prisma.users.findMany({
      where: {
        isBackoffice: false,
        subscriptionStatus: { in: PAID_STATUSES },
        product: { tier: { not: ProductTier.FREE } },
      },
      select: {
        subscriptionCancelAt: true,
        product: { select: { type: true, price: true } },
      },
    });

    return users
      .filter((user) => user.product)
      .map((user) => ({
        productType: user.product!.type,
        price: user.product!.price,
        canceledThisMonth: Boolean(
          user.subscriptionCancelAt &&
            user.subscriptionCancelAt >= cancelRange.gte &&
            user.subscriptionCancelAt < cancelRange.lt,
        ),
      }));
  }

  // Distinguishes "role has zero currently-active Premium users" (ltv: null,
  // entry present — findActivePremiumUsersForLtv returns no rows for it) from
  // "role has no active Premium product offered at all" (entry omitted
  // entirely, cohort-ltv-analysis US-002.EC-3) — a distinction the active-user
  // query above cannot make on its own.
  async findRolesWithActivePremiumProduct(): Promise<ProductType[]> {
    const products = await this.prisma.product.findMany({
      where: { tier: { not: ProductTier.FREE }, active: true },
      select: { type: true },
      distinct: ['type'],
    });

    return products.map((product) => product.type);
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
