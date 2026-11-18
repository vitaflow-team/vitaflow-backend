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
  Users,
  UsersToken,
} from '@prisma/client';
import type { PlatformSubscriber } from './types/platformSubscriber';
import type { UserProfileRow } from './types/userProfileRow';

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

  // The only lookup by email (unified-login-account ADR-008): one email is
  // one account, enforced by the Users_email_key index on lower(email).
  // Exact but case-insensitive, with LIKE wildcards escaped — an email
  // containing `_` or `%` matches that address and no other.
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

  // The users behind a batch of gateway customers, with their current plan:
  // the platform payment sync matches a whole page of payments in one query.
  async findSubscribersByCustomerIds(
    asaasCustomerIds: string[],
  ): Promise<PlatformSubscriber[]> {
    if (asaasCustomerIds.length === 0) return [];
    const rows = await this.prisma.users.findMany({
      where: { asaasCustomerId: { in: asaasCustomerIds } },
      select: {
        id: true,
        asaasCustomerId: true,
        product: { select: { type: true, name: true } },
      },
    });
    return rows.flatMap((row) =>
      row.asaasCustomerId === null
        ? []
        : [{ ...row, asaasCustomerId: row.asaasCustomerId }],
    );
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

  // unified-login-account ADR-010: grants the pending tier to the existing
  // account in the same transaction that consumes the invitation token. An
  // account whose invitation was withdrawn (no pending tier left) gets null
  // before the token is touched, so nothing is half-applied.
  async acceptBackofficeInvitation(token: UsersToken): Promise<Users | null> {
    return await this.prisma.$transaction(async (tx) => {
      const account = await tx.users.findUnique({
        where: { id: token.userID },
      });
      if (!account?.pendingBackofficeTier) {
        return null;
      }
      if (!(await this.consumeToken(tx, token.id))) {
        return null;
      }

      return await tx.users.update({
        where: { id: token.userID },
        data: {
          isBackoffice: true,
          backofficeTier: account.pendingBackofficeTier,
          pendingBackofficeTier: null,
        },
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

  async getUserProfile(userId: string): Promise<UserProfileRow | null> {
    return await this.prisma.users.findUnique({
      where: { id: userId },
      include: {
        userAddresses: true,
        product: true,
        oAuthIdentity: true,
      },
    });
  }

  // unified-login-account ADR-006: the moment a plan-less account becomes a
  // customer. Both consents are stamped together with the plan, so a plan
  // never exists without the acceptance that authorizes it.
  async activateAsCustomer(id: string, productId: string): Promise<Users> {
    const acceptedAt = new Date();
    return await this.prisma.users.update({
      where: { id },
      data: {
        termsAcceptedAt: acceptedAt,
        healthDataConsentAt: acceptedAt,
        product: { connect: { id: productId } },
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
      await tx.pushDevice.deleteMany({ where: { userId } });
      await tx.pushCategoryPreference.deleteMany({ where: { userId } });
      await tx.pushSettings.deleteMany({ where: { userId } });
      await tx.reengagementEpisode.deleteMany({ where: { userId } });
      await tx.reengagementPush.deleteMany({ where: { userId } });
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

  // Staff rows plus the existing accounts that hold an invitation not yet
  // accepted (unified-login-account ADR-010), so the staff screen shows
  // both kinds of pending invitation.
  async findAllBackofficeStaff(): Promise<Users[]> {
    return await this.prisma.users.findMany({
      where: {
        OR: [{ isBackoffice: true }, { pendingBackofficeTier: { not: null } }],
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async setPendingBackofficeTier(
    id: string,
    tier: BackofficeTier | null,
  ): Promise<Users> {
    return await this.prisma.users.update({
      where: { id },
      data: { pendingBackofficeTier: tier },
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
