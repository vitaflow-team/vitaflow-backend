import { PrismaService } from '@/database/prisma.service';
import { Injectable } from '@nestjs/common';
import { Prisma, ProductType } from '@prisma/client';
import type { MonthTotals } from './types/monthTotals';
import type { PlatformDelinquentCounts } from './types/platformDelinquentCounts';
import type { PlatformDelinquentRow } from './types/platformDelinquentRow';
import type { PlatformDelinquentsQuery } from './types/platformDelinquentsQuery';
import type { PlatformFigures } from './types/platformFigures';
import type { PlatformSummaryFigures } from './types/platformSummaryFigures';
import type { PlatformSummaryQuery } from './types/platformSummaryQuery';

interface SummarySqlRow {
  accountType: ProductType | null;
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
  userId: string;
  name: string;
  accountType: ProductType;
  planName: string;
  totalOwedCents: bigint;
  oldestDaysOverdue: number;
}

interface CountsSqlRow {
  total: bigint;
  d1to7: bigint;
  d8to30: bigint;
  d31Plus: bigint;
}

// Refunded and canceled payments belong to no figure (ADR-004).
const COUNTED = Prisma.sql`p."status" IN ('PENDING', 'OVERDUE', 'PAID')`;
const OPEN = Prisma.sql`p."status" IN ('PENDING', 'OVERDUE')`;
const DUE_DATE = Prisma.sql`p."dueDate"`;
const PAID_AT = Prisma.sql`p."paidAt"`;

// An open payment whose due date is before today (ADR-004): overdue is read
// from the date, never from the status the gateway flips later.
function overdue(today: string): Prisma.Sql {
  return Prisma.sql`${OPEN} AND p."dueDate" < ${today}::date`;
}

function inMonth(
  column: Prisma.Sql,
  start: string,
  nextStart: string,
): Prisma.Sql {
  return Prisma.sql`${column} >= ${start}::date AND ${column} < ${nextStart}::date`;
}

function expected(start: string, nextStart: string): Prisma.Sql {
  return Prisma.sql`COALESCE(SUM(p."valueCents") FILTER (WHERE ${inMonth(DUE_DATE, start, nextStart)}), 0)`;
}

function received(start: string, nextStart: string): Prisma.Sql {
  return Prisma.sql`COALESCE(SUM(COALESCE(p."paidAmountCents", p."valueCents")) FILTER (
      WHERE p."status" = 'PAID' AND ${inMonth(PAID_AT, start, nextStart)}
    ), 0)`;
}

function stillOwed(start: string, nextStart: string): Prisma.Sql {
  return Prisma.sql`COALESCE(SUM(p."valueCents") FILTER (
      WHERE ${OPEN} AND ${inMonth(DUE_DATE, start, nextStart)}
    ), 0)`;
}

function band(today: string, from: number, to: number | null): Prisma.Sql {
  const upper =
    to === null
      ? Prisma.empty
      : Prisma.sql`AND (${today}::date - p."dueDate") <= ${to}`;
  return Prisma.sql`COALESCE(SUM(p."valueCents") FILTER (
      WHERE ${overdue(today)} AND (${today}::date - p."dueDate") >= ${from} ${upper}
    ), 0)`;
}

function monthTotals(row: SummarySqlRow, which: 'cur' | 'prev'): MonthTotals {
  return {
    expectedCents: Number(row[`${which}Expected`]),
    receivedCents: Number(row[`${which}Received`]),
    stillOwedCents: Number(row[`${which}StillOwed`]),
  };
}

function emptyTotals(): MonthTotals {
  return { expectedCents: 0, receivedCents: 0, stillOwedCents: 0 };
}

function figuresOf(row: SummarySqlRow | undefined): PlatformFigures {
  if (!row) {
    return {
      current: emptyTotals(),
      previous: emptyTotals(),
      overdue: {
        d1to7Cents: 0,
        d8to30Cents: 0,
        d31PlusCents: 0,
        delinquentCount: 0,
      },
    };
  }
  return {
    current: monthTotals(row, 'cur'),
    previous: monthTotals(row, 'prev'),
    overdue: {
      d1to7Cents: Number(row.band1to7),
      d8to30Cents: Number(row.band8to30),
      d31PlusCents: Number(row.band31Plus),
      delinquentCount: Number(row.delinquentCount),
    },
  };
}

// Read side of the platform payment table (ADR-006, ADR-010). Every figure is
// plain SQL over indexed columns: the platform panel never asks the gateway.
@Injectable()
export class PlatformFinancialRepository {
  constructor(private readonly prisma: PrismaService) {}

  // The calendar date of the earliest stored payment: months before it have no
  // history, which is not the same as zero.
  async earliestDueDate(): Promise<string | null> {
    const rows = await this.prisma.$queryRaw<{ first: string | null }[]>(
      Prisma.sql`SELECT to_char(MIN("dueDate"), 'YYYY-MM-DD') AS "first" FROM "PlatformPayment"`,
    );
    return rows[0].first;
  }

  // The last time any payment row was confirmed against the gateway.
  async lastSyncedAt(): Promise<Date | null> {
    const result = await this.prisma.platformPayment.aggregate({
      _max: { updatedAt: true },
    });
    return result._max.updatedAt;
  }

  // Expected, received and still owed for the selected and the previous month
  // plus today's overdue bands, per account type and in total, in ONE
  // statement so every figure comes from the same snapshot. ROLLUP adds the
  // total row, whose delinquent count is distinct across account types.
  async summaryFigures(
    query: PlatformSummaryQuery,
  ): Promise<PlatformSummaryFigures> {
    const { current, previous, today } = query;
    const rows = await this.prisma.$queryRaw<SummarySqlRow[]>(Prisma.sql`
      SELECT
        p."productType"::text AS "accountType",
        ${expected(current.start, current.nextStart)} AS "curExpected",
        ${received(current.start, current.nextStart)} AS "curReceived",
        ${stillOwed(current.start, current.nextStart)} AS "curStillOwed",
        ${expected(previous.start, previous.nextStart)} AS "prevExpected",
        ${received(previous.start, previous.nextStart)} AS "prevReceived",
        ${stillOwed(previous.start, previous.nextStart)} AS "prevStillOwed",
        ${band(today, 1, 7)} AS "band1to7",
        ${band(today, 8, 30)} AS "band8to30",
        ${band(today, 31, null)} AS "band31Plus",
        COUNT(DISTINCT p."userId") FILTER (WHERE ${overdue(today)}) AS "delinquentCount"
      FROM "PlatformPayment" p
      WHERE ${COUNTED}
        AND (
          (p."dueDate" >= ${previous.start}::date AND p."dueDate" < ${current.nextStart}::date)
          OR (p."paidAt" >= ${previous.start}::date AND p."paidAt" < ${current.nextStart}::date)
          OR (${overdue(today)})
        )
      GROUP BY ROLLUP (p."productType")
    `);
    return {
      total: figuresOf(rows.find((row) => row.accountType === null)),
      byAccountType: Object.fromEntries(
        Object.values(ProductType).map((type) => [
          type,
          figuresOf(rows.find((row) => row.accountType === type)),
        ]),
      ) as PlatformSummaryFigures['byAccountType'],
    };
  }

  // One row per user with at least one overdue payment, worst first: amount
  // owed, then the oldest overdue payment, then name (US-023).
  async delinquentUsers(
    query: PlatformDelinquentsQuery,
  ): Promise<PlatformDelinquentRow[]> {
    const { today, limit, offset } = query;
    const rows = await this.prisma.$queryRaw<DelinquentSqlRow[]>(Prisma.sql`
      SELECT
        p."userId" AS "userId",
        u."name" AS "name",
        (array_agg(p."productType"::text ORDER BY p."dueDate" ASC, p."id" ASC))[1] AS "accountType",
        (array_agg(p."productName" ORDER BY p."dueDate" ASC, p."id" ASC))[1] AS "planName",
        SUM(p."valueCents") AS "totalOwedCents",
        (${today}::date - MIN(p."dueDate"))::int AS "oldestDaysOverdue"
      FROM "PlatformPayment" p
      JOIN "Users" u ON u."id" = p."userId"
      WHERE ${overdue(today)}
      GROUP BY p."userId", u."name"
      ORDER BY SUM(p."valueCents") DESC, MIN(p."dueDate") ASC, u."name" ASC, p."userId" ASC
      LIMIT ${limit} OFFSET ${offset}
    `);
    return rows.map((row) => ({
      userId: row.userId,
      name: row.name,
      accountType: row.accountType,
      planName: row.planName,
      totalOwedCents: Number(row.totalOwedCents),
      oldestDaysOverdue: row.oldestDaysOverdue,
    }));
  }

  // The number of delinquent users and how they spread over the aging bands,
  // the band being the one their oldest overdue payment falls in.
  async delinquentCounts(today: string): Promise<PlatformDelinquentCounts> {
    const rows = await this.prisma.$queryRaw<CountsSqlRow[]>(Prisma.sql`
      SELECT
        COUNT(*) AS "total",
        COUNT(*) FILTER (WHERE d."days" BETWEEN 1 AND 7) AS "d1to7",
        COUNT(*) FILTER (WHERE d."days" BETWEEN 8 AND 30) AS "d8to30",
        COUNT(*) FILTER (WHERE d."days" >= 31) AS "d31Plus"
      FROM (
        SELECT (${today}::date - MIN(p."dueDate")) AS "days"
        FROM "PlatformPayment" p
        WHERE ${overdue(today)}
        GROUP BY p."userId"
      ) d
    `);
    const row = rows[0];
    return {
      total: Number(row.total),
      d1to7: Number(row.d1to7),
      d8to30: Number(row.d8to30),
      d31Plus: Number(row.d31Plus),
    };
  }
}
