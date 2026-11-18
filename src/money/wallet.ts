import { requireMerchantAccess, type SessionUser } from '@/accounts';
import { db } from '@/shared/db';
import { walletAccount } from './ledger';

const TRANSACTIONS_PAGE_SIZE = 25;

// Amounts are from the merchant's side: positive = Shiply owes the merchant.
export type WalletSummary = {
  balancePiasters: number;
  // Booked today and not yet in a closed cash cycle.
  processingPiasters: number;
  // In closed cycles that are waiting for (or prepared in) a cash-out not yet paid.
  inNextCashOutPiasters: number;
};

export async function getWalletSummary(user: SessionUser, merchantId: string): Promise<WalletSummary> {
  requireMerchantAccess(user, merchantId, 'finance');
  const wallet = walletAccount(merchantId);
  const [balance, unclosed, waitingCycles] = await Promise.all([
    db.ledgerLine.aggregate({ where: { accountCode: wallet }, _sum: { amountPiasters: true } }),
    db.$queryRaw<{ total: bigint | null }[]>`
      SELECT SUM(l."amountPiasters") AS total
      FROM "LedgerLine" l
      JOIN "LedgerEntry" e ON e."id" = l."entryId"
      LEFT JOIN "CashCycleEntry" c ON c."entryId" = e."id"
      WHERE l."accountCode" = ${wallet} AND e."reason" IN ('order_delivered', 'order_returned') AND c."entryId" IS NULL`,
    db.cashCycle.findMany({
      where: { merchantId, OR: [{ cashOutId: null }, { cashOut: { status: { in: ['prepared', 'approved'] } } }] },
      select: { netPiasters: true },
    }),
  ]);
  return {
    balancePiasters: 0 - (balance._sum.amountPiasters ?? 0),
    processingPiasters: 0 - Number(unclosed[0]?.total ?? 0),
    inNextCashOutPiasters: waitingCycles.reduce((sum, cycle) => sum + cycle.netPiasters, 0),
  };
}

export type WalletTransaction = {
  entryId: string;
  reason: string;
  amountPiasters: number;
  postedAt: Date;
  orderNumber: string | null;
  cashOutNumber: string | null;
};

export async function listWalletTransactions(
  user: SessionUser,
  merchantId: string,
  { page }: { page: number },
): Promise<{ transactions: WalletTransaction[]; pageCount: number }> {
  requireMerchantAccess(user, merchantId, 'finance');
  const wallet = walletAccount(merchantId);
  const total = await db.ledgerLine.count({ where: { accountCode: wallet } });
  const pageCount = Math.max(1, Math.ceil(total / TRANSACTIONS_PAGE_SIZE));
  const safePage = Math.min(Math.max(1, Math.floor(page) || 1), pageCount);
  const lines = await db.ledgerLine.findMany({
    where: { accountCode: wallet },
    include: { entry: { select: { id: true, reason: true, postedAt: true, orderId: true, cashOutId: true } } },
    orderBy: [{ entry: { postedAt: 'desc' } }, { id: 'desc' }],
    skip: (safePage - 1) * TRANSACTIONS_PAGE_SIZE,
    take: TRANSACTIONS_PAGE_SIZE,
  });
  const orderIds = lines.map((line) => line.entry.orderId).filter((id): id is string => Boolean(id));
  const cashOutIds = lines.map((line) => line.entry.cashOutId).filter((id): id is string => Boolean(id));
  const [orders, cashOuts] = await Promise.all([
    db.order.findMany({ where: { id: { in: orderIds } }, select: { id: true, number: true } }),
    db.cashOut.findMany({ where: { id: { in: cashOutIds } }, select: { id: true, number: true } }),
  ]);
  const orderNumbers = new Map(orders.map((order) => [order.id, order.number]));
  const cashOutNumbers = new Map(cashOuts.map((cashOut) => [cashOut.id, cashOut.number]));
  return {
    transactions: lines.map((line) => ({
      entryId: line.entry.id,
      reason: line.entry.reason,
      amountPiasters: 0 - line.amountPiasters,
      postedAt: line.entry.postedAt,
      orderNumber: line.entry.orderId ? (orderNumbers.get(line.entry.orderId) ?? null) : null,
      cashOutNumber: line.entry.cashOutId ? (cashOutNumbers.get(line.entry.cashOutId) ?? null) : null,
    })),
    pageCount,
  };
}
