import { PrismaService } from '@/database/prisma.service';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { DelinquentClientsQuery } from './types/delinquentClientsQuery';
import type { DelinquentRow } from './types/delinquentRow';
import type { SummaryFigures } from './types/summaryFigures';
import type { SummaryFiguresQuery } from './types/summaryFiguresQuery';

interface SummaryRow {
  curExpected: bigint;
  curReceived: bigint;
  curStillOwed: bigint;
  prevExpected: bigint;
  prevReceived: bigint;
  prevStillOwed: bigint;
  band1to7: bigint;
  band8to30: bigint;
  band31Plus: bigint;
  delinquentCount: bigint;
}

interface DelinquentSqlRow {
  clientId: string;
  name: string;
  totalOwedCents: bigint;
  overdueCount: bigint;
  oldestDaysOverdue: number;
}

// Every figure is scoped to the invoices of ALL the owner's billing accounts
// (including REPLACED ones, PRD rule 37) and leaves out canceled invoices and
// reservations the gateway never confirmed (PRD rule 1).
function ownerScope(ownerId: string): Prisma.Sql {
  return Prisma.sql`i."billingAccountId" IN (
      SELECT ba."id" FROM "BillingAccount" ba WHERE ba."userId" = ${ownerId}
    )
    AND i."status" <> 'CANCELED'
    AND i."externalId" IS NOT NULL`;
}

// An open invoice whose due date is before today (ADR-004): overdue is read
// from the date, never from the status column the nightly job updates.
function overduePredicate(today: string): Prisma.Sql {
  return Prisma.sql`i."status" IN ('PENDING', 'OVERDUE') AND i."dueDate" < ${today}::date`;
}

const DUE_DATE = Prisma.sql`i."dueDate"`;
const PAID_AT = Prisma.sql`i."paidAt"`;

function inMonth(
  column: Prisma.Sql,
  start: string,
  nextStart: string,
): Prisma.Sql {
  return Prisma.sql`${column} >= ${start}::date AND ${column} < ${nextStart}::date`;
}

function expected(start: string, nextStart: string): Prisma.Sql {
  return Prisma.sql`COALESCE(SUM(i."amountCents") FILTER (WHERE ${inMonth(DUE_DATE, start, nextStart)}), 0)`;
}

function received(start: string, nextStart: string): Prisma.Sql {
  return Prisma.sql`COALESCE(SUM(COALESCE(i."paidAmountCents", i."amountCents")) FILTER (
      WHERE i."status" IN ('PAID', 'PAID_MANUALLY') AND ${inMonth(PAID_AT, start, nextStart)}
    ), 0)`;
}

function stillOwed(start: string, nextStart: string): Prisma.Sql {
  return Prisma.sql`COALESCE(SUM(i."amountCents") FILTER (
      WHERE i."status" IN ('PENDING', 'OVERDUE') AND ${inMonth(DUE_DATE, start, nextStart)}
    ), 0)`;
}

function band(today: string, from: number, to: number | null): Prisma.Sql {
  const upper =
    to === null
      ? Prisma.empty
      : Prisma.sql`AND (${today}::date - i."dueDate") <= ${to}`;
  return Prisma.sql`COALESCE(SUM(i."amountCents") FILTER (
      WHERE ${overduePredicate(today)} AND (${today}::date - i."dueDate") >= ${from} ${upper}
    ), 0)`;
}

@Injectable()
export class FinancialHealthRepository {
  constructor(private readonly prisma: PrismaService) {}

  // Expected, received and still owed for the selected and the previous
  // month, plus the overdue bands, in ONE statement: the figures always come
  // from the same snapshot, so a webhook landing mid-request can never show a
  // half-updated panel. The month figures use due date (expected, still owed)
  // and payment date (received); the bands use today (ADR-004).
  async summaryFigures(query: SummaryFiguresQuery): Promise<SummaryFigures> {
    const { ownerId, current, previous, today } = query;
    const rows = await this.prisma.$queryRaw<SummaryRow[]>(Prisma.sql`
      SELECT
        ${expected(current.start, current.nextStart)} AS "curExpected",
        ${received(current.start, current.nextStart)} AS "curReceived",
        ${stillOwed(current.start, current.nextStart)} AS "curStillOwed",
        ${expected(previous.start, previous.nextStart)} AS "prevExpected",
        ${received(previous.start, previous.nextStart)} AS "prevReceived",
        ${stillOwed(previous.start, previous.nextStart)} AS "prevStillOwed",
        ${band(today, 1, 7)} AS "band1to7",
        ${band(today, 8, 30)} AS "band8to30",
        ${band(today, 31, null)} AS "band31Plus",
        COUNT(DISTINCT i."clientId") FILTER (WHERE ${overduePredicate(today)}) AS "delinquentCount"
      FROM "Invoice" i
      WHERE ${ownerScope(ownerId)}
        AND (
          (i."dueDate" >= ${previous.start}::date AND i."dueDate" < ${current.nextStart}::date)
          OR (i."paidAt" >= ${previous.start}::date AND i."paidAt" < ${current.nextStart}::date)
          OR (${overduePredicate(today)})
        )
    `);
    const row = rows[0];
    return {
      current: {
        expectedCents: Number(row.curExpected),
        receivedCents: Number(row.curReceived),
        stillOwedCents: Number(row.curStillOwed),
      },
      previous: {
        expectedCents: Number(row.prevExpected),
        receivedCents: Number(row.prevReceived),
        stillOwedCents: Number(row.prevStillOwed),
      },
      overdue: {
        d1to7Cents: Number(row.band1to7),
        d8to30Cents: Number(row.band8to30),
        d31PlusCents: Number(row.band31Plus),
        delinquentCount: Number(row.delinquentCount),
      },
    };
  }

  // One row per person with at least one overdue invoice, worst first: total
  // owed, then the oldest overdue invoice, then name (PRD rule 14); the client
  // id only makes the order total.
  async delinquentClients(
    query: DelinquentClientsQuery,
  ): Promise<DelinquentRow[]> {
    const { ownerId, today, limit, offset } = query;
    const rows = await this.prisma.$queryRaw<DelinquentSqlRow[]>(Prisma.sql`
      SELECT
        i."clientId" AS "clientId",
        c."name" AS "name",
        SUM(i."amountCents") AS "totalOwedCents",
        COUNT(*) AS "overdueCount",
        (${today}::date - MIN(i."dueDate"))::int AS "oldestDaysOverdue"
      FROM "Invoice" i
      JOIN "Client" c ON c."id" = i."clientId"
      WHERE ${ownerScope(ownerId)} AND ${overduePredicate(today)}
      GROUP BY i."clientId", c."name"
      ORDER BY SUM(i."amountCents") DESC, MIN(i."dueDate") ASC, c."name" ASC, i."clientId" ASC
      LIMIT ${limit} OFFSET ${offset}
    `);
    return rows.map((row) => ({
      clientId: row.clientId,
      name: row.name,
      totalOwedCents: Number(row.totalOwedCents),
      overdueCount: Number(row.overdueCount),
      oldestDaysOverdue: row.oldestDaysOverdue,
    }));
  }

  async countDelinquentClients(
    ownerId: string,
    today: string,
  ): Promise<number> {
    const rows = await this.prisma.$queryRaw<{ total: bigint }[]>(Prisma.sql`
      SELECT COUNT(DISTINCT i."clientId") AS "total"
      FROM "Invoice" i
      WHERE ${ownerScope(ownerId)} AND ${overduePredicate(today)}
    `);
    return Number(rows[0].total);
  }

  // Whether the owner has any invoice that counts toward the figures: tells
  // an empty panel apart from a disconnected one that still has history.
  async hasAnyInvoice(ownerId: string): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<{ present: boolean }[]>(Prisma.sql`
      SELECT EXISTS (
        SELECT 1 FROM "Invoice" i WHERE ${ownerScope(ownerId)}
      ) AS "present"
    `);
    return rows[0].present;
  }
}
