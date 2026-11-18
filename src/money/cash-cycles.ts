import { Prisma } from '@prisma/client';
import { requireMerchantAccess, type SessionUser } from '@/accounts';
import { AppError } from '@/shared/app-error';
import { cairoDateToUtcStart } from '@/shared/cairo-time';
import { db } from '@/shared/db';
import { LEDGER_ACCOUNTS, walletAccount } from './ledger';

const ORDER_REASONS = ['order_delivered', 'order_returned'];
const CYCLES_PAGE_SIZE = 25;
const UNIQUE_VIOLATION = 'P2002';

export type CashCycleView = {
  id: string;
  cycleDate: string;
  cashCollectedPiasters: number;
  feesPiasters: number;
  netPiasters: number;
  orderCount: number;
  closedAt: Date;
  cashOutId: string | null;
};

function nextDayString(cairoDate: string): string {
  const [year, month, day] = cairoDate.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day + 1, 12)).toISOString().slice(0, 10);
}

// From the start of this Cairo day to the start of the next (23 or 25 hours on clock-change days).
function dayWindow(cairoDate: string): { start: Date; end: Date } {
  try {
    return { start: cairoDateToUtcStart(cairoDate), end: cairoDateToUtcStart(nextDayString(cairoDate)) };
  } catch {
    throw new AppError('invalid_input');
  }
}

// Closes one Cairo day for every merchant that had orders booked that day. Safe to run
// again (and at the same time): a day already closed for a merchant is skipped.
export async function closeCashCycles(cairoDate: string): Promise<{ closed: number }> {
  const { start, end } = dayWindow(cairoDate);
  const entries = await db.ledgerEntry.findMany({
    where: { reason: { in: ORDER_REASONS }, postedAt: { gte: start, lt: end }, merchantId: { not: null } },
    select: { id: true, merchantId: true, lines: { select: { accountCode: true, amountPiasters: true } } },
  });
  const byMerchant = new Map<string, typeof entries>();
  for (const entry of entries) {
    const merchantId = entry.merchantId as string;
    byMerchant.set(merchantId, [...(byMerchant.get(merchantId) ?? []), entry]);
  }

  let closed = 0;
  for (const [merchantId, merchantEntries] of byMerchant) {
    const wallet = walletAccount(merchantId);
    let cashCollectedPiasters = 0;
    let walletTotal = 0;
    for (const line of merchantEntries.flatMap((entry) => entry.lines)) {
      if (line.accountCode === LEDGER_ACCOUNTS.cashInTransit) cashCollectedPiasters += line.amountPiasters;
      if (line.accountCode === wallet) walletTotal += line.amountPiasters;
    }
    // The wallet is credited (negative) with what Shiply owes; net owed is its negation.
    const netPiasters = -walletTotal;
    try {
      await db.cashCycle.create({
        data: {
          merchantId,
          // A @db.Date column: the Cairo calendar date itself, stored at midnight UTC.
          cycleDate: new Date(`${cairoDate}T00:00:00Z`),
          cashCollectedPiasters,
          feesPiasters: cashCollectedPiasters - netPiasters,
          netPiasters,
          orderCount: merchantEntries.length,
          entries: { create: merchantEntries.map((entry) => ({ entryId: entry.id })) },
        },
      });
      closed += 1;
    } catch (error) {
      // Already closed (by an earlier or simultaneous run): leave it as it is.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === UNIQUE_VIOLATION) continue;
      throw error;
    }
  }
  return { closed };
}

export async function listCashCycles(user: SessionUser, merchantId: string, { page }: { page: number }): Promise<{ cycles: CashCycleView[]; pageCount: number }> {
  requireMerchantAccess(user, merchantId, 'finance');
  const total = await db.cashCycle.count({ where: { merchantId } });
  const pageCount = Math.max(1, Math.ceil(total / CYCLES_PAGE_SIZE));
  const safePage = Math.min(Math.max(1, Math.floor(page) || 1), pageCount);
  const rows = await db.cashCycle.findMany({
    where: { merchantId },
    orderBy: { cycleDate: 'desc' },
    skip: (safePage - 1) * CYCLES_PAGE_SIZE,
    take: CYCLES_PAGE_SIZE,
  });
  return {
    cycles: rows.map((row) => ({
      id: row.id,
      cycleDate: row.cycleDate.toISOString().slice(0, 10),
      cashCollectedPiasters: row.cashCollectedPiasters,
      feesPiasters: row.feesPiasters,
      netPiasters: row.netPiasters,
      orderCount: row.orderCount,
      closedAt: row.closedAt,
      cashOutId: row.cashOutId,
    })),
    pageCount,
  };
}
