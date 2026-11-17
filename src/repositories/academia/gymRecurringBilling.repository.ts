import type { Competence } from '@/billing/shared/types/competence';
import { PrismaService } from '@/database/prisma.service';
import { Injectable } from '@nestjs/common';
import {
  GymRecurringBilling,
  Prisma,
  RecurringBillingStatus,
  StudentAccessPlanStatus,
} from '@prisma/client';
import type { BillingTermsChange } from './types/billingTermsChange';
import type { EligibleRow } from './types/eligibleRow';
import type { IssuableBilling } from './types/issuableBilling';
import type { LinkedRows } from './types/linkedRows';
import type { NewRecurringBillingData } from './types/newRecurringBillingData';
import type { NewRecurringLink } from './types/newRecurringLink';
import type { PlanFollow } from './types/planFollow';

const ACTIVE = RecurringBillingStatus.ACTIVE;
const ACTIVE_PLAN = StudentAccessPlanStatus.ACTIVE;

interface LastCompetenceRow {
  id: string;
  last: number;
}

// The only Prisma layer of the gym's recurring billing (ADR-007). A student
// has at most one ACTIVE row, enforced by a partial unique index; the
// transactions below also lock the Client row, as the plan activation does,
// so concurrent writers on the same student take turns.
@Injectable()
export class GymRecurringBillingRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findActiveByClient(
    clientId: string,
  ): Promise<GymRecurringBilling | null> {
    return await this.prisma.gymRecurringBilling.findFirst({
      where: { clientId, status: ACTIVE },
    });
  }

  // Creates the new active plan (archiving the previous one) and the recurring
  // row together. Returns null when the student already has an ACTIVE row.
  async createLink(data: NewRecurringLink): Promise<LinkedRows | null> {
    const { plan, billing } = data;
    return await this.prisma.$transaction(async (tx) => {
      await this.lockClient(tx, billing.clientId);
      if (await this.hasActive(tx, billing.clientId)) return null;

      const previous = await tx.studentAccessPlan.findFirst({
        where: { clientId: billing.clientId, status: ACTIVE_PLAN },
        select: { id: true },
      });
      await tx.studentAccessPlan.updateMany({
        where: { clientId: billing.clientId, status: ACTIVE_PLAN },
        data: { status: StudentAccessPlanStatus.ARCHIVED },
      });
      const created = await tx.studentAccessPlan.create({
        data: {
          client: { connect: { id: plan.clientId } },
          accessPlan: { connect: { id: plan.accessPlanId } },
          validityType: plan.validityType,
          validityValue: plan.validityValue,
          referencePrice: plan.referencePrice,
          expiresAt: plan.expiresAt,
          status: ACTIVE_PLAN,
        },
      });
      const row = await tx.gymRecurringBilling.create({ data: billing });
      return {
        plan: created,
        billing: row,
        previousPlanId: previous?.id ?? null,
      };
    });
  }

  // Undoes createLink: removes the recurring row and the new plan and makes
  // the displaced plan active again. Every step is idempotent (ADR-007).
  async rollbackLink(rows: LinkedRows): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.gymRecurringBilling.deleteMany({
        where: { id: rows.billing.id },
      });
      await tx.studentAccessPlan.deleteMany({ where: { id: rows.plan.id } });
      if (rows.previousPlanId) {
        await tx.studentAccessPlan.updateMany({
          where: { id: rows.previousPlanId, clientId: rows.plan.clientId },
          data: { status: ACTIVE_PLAN },
        });
      }
    });
  }

  // A recurring row for a student whose plan is already active (bulk
  // activation). Null when the student already has an ACTIVE row.
  async createForActivePlan(
    data: NewRecurringBillingData,
  ): Promise<GymRecurringBilling | null> {
    return await this.prisma.$transaction(async (tx) => {
      await this.lockClient(tx, data.clientId);
      if (await this.hasActive(tx, data.clientId)) return null;
      return await tx.gymRecurringBilling.create({ data });
    });
  }

  async deleteById(id: string): Promise<void> {
    await this.prisma.gymRecurringBilling.deleteMany({ where: { id } });
  }

  // Unlink: archives the active plan and ends the active recurring row.
  // Null when the student had neither.
  async endLink(
    clientId: string,
    endedAt: Date,
  ): Promise<{ billingId: string | null } | null> {
    return await this.prisma.$transaction(async (tx) => {
      await this.lockClient(tx, clientId);
      const plan = await tx.studentAccessPlan.findFirst({
        where: { clientId, status: ACTIVE_PLAN },
        select: { id: true },
      });
      const billing = await tx.gymRecurringBilling.findFirst({
        where: { clientId, status: ACTIVE },
        select: { id: true },
      });
      if (!plan && !billing) return null;

      if (plan) {
        await tx.studentAccessPlan.update({
          where: { id: plan.id },
          data: { status: StudentAccessPlanStatus.ARCHIVED },
        });
      }
      if (billing) {
        await tx.gymRecurringBilling.update({
          where: { id: billing.id },
          data: { status: RecurringBillingStatus.ENDED, endedAt },
        });
      }
      return { billingId: billing?.id ?? null };
    });
  }

  async updateTerms(
    clientId: string,
    change: BillingTermsChange,
  ): Promise<GymRecurringBilling | null> {
    const { count } = await this.prisma.gymRecurringBilling.updateMany({
      where: { clientId, status: ACTIVE },
      data: change,
    });
    return count === 0 ? null : await this.findActiveByClient(clientId);
  }

  // A plain re-assignment keeps the recurring row but points it at the new
  // plan (and its price, unless the amount is custom).
  async followPlan(clientId: string, follow: PlanFollow): Promise<void> {
    await this.prisma.gymRecurringBilling.updateMany({
      where: { clientId, status: ACTIVE },
      data: {
        accessPlanId: follow.accessPlanId,
        amountCents: follow.amountCents,
      },
    });
  }

  async findEligible(academiaId: string): Promise<EligibleRow[]> {
    const clients = await this.prisma.client.findMany({
      where: {
        academiaId,
        accessPlans: { some: { status: ACTIVE_PLAN } },
        recurringBillings: { none: { status: ACTIVE } },
      },
      select: {
        id: true,
        name: true,
        taxId: { select: { clientId: true } },
        accessPlans: {
          where: { status: ACTIVE_PLAN },
          select: {
            referencePrice: true,
            accessPlan: { select: { name: true } },
          },
        },
      },
      orderBy: { name: 'asc' },
    });
    return clients.map((client) => ({
      clientId: client.id,
      name: client.name,
      planName: client.accessPlans[0].accessPlan.name,
      referencePrice: client.accessPlans[0].referencePrice,
      hasTaxId: client.taxId !== null,
    }));
  }

  // Every ACTIVE billing with its student and the gym owner who bills.
  async findIssuable(): Promise<IssuableBilling[]> {
    const rows = await this.prisma.gymRecurringBilling.findMany({
      where: { status: ACTIVE, client: { academiaId: { not: null } } },
      include: {
        client: {
          include: {
            academia: {
              include: { owner: { include: { product: true } } },
            },
          },
        },
      },
      orderBy: { startedAt: 'asc' },
    });
    return rows.map(({ client, ...billing }) => {
      const { academia, ...student } = client;
      return { billing, client: student, owner: academia?.owner ?? null };
    });
  }

  // The highest competence among all invoices of each ACTIVE row, including
  // canceled ones, so a canceled fee is never issued again (ADR-007).
  async findLastCompetences(): Promise<Map<string, Competence>> {
    const rows = await this.prisma.$queryRaw<LastCompetenceRow[]>(
      Prisma.sql`SELECT i."recurringBillingId" AS "id",
          MAX(i."competenceYear" * 100 + i."competenceMonth")::int AS "last"
        FROM "Invoice" i
        JOIN "GymRecurringBilling" b ON b."id" = i."recurringBillingId"
        WHERE b."status" = 'ACTIVE'
        GROUP BY i."recurringBillingId"`,
    );
    return new Map(
      rows.map((row) => [
        row.id,
        { year: Math.floor(row.last / 100), month: row.last % 100 },
      ]),
    );
  }

  private async lockClient(
    tx: Prisma.TransactionClient,
    clientId: string,
  ): Promise<void> {
    await tx.$queryRaw`SELECT "id" FROM "Client" WHERE "id" = ${clientId} FOR UPDATE`;
  }

  private async hasActive(
    tx: Prisma.TransactionClient,
    clientId: string,
  ): Promise<boolean> {
    const live = await tx.gymRecurringBilling.findFirst({
      where: { clientId, status: ACTIVE },
      select: { id: true },
    });
    return live !== null;
  }
}
