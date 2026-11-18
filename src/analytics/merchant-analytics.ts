import { requireMerchantAccess, type SessionUser } from '@/accounts';
import { LEDGER_ACCOUNTS, walletAccount } from '@/money';
import { AppError } from '@/shared/app-error';
import { cairoDateString, cairoDateToUtcStart } from '@/shared/cairo-time';
import { db } from '@/shared/db';

export const ANALYTICS_PERIODS = [7, 30, 90] as const;
export type AnalyticsPeriodDays = (typeof ANALYTICS_PERIODS)[number];

export const UNSPECIFIED_REASON = 'unspecified';
const MS_PER_DAY = 86_400_000;
// The third and later tries are counted together (an order has at most three attempts).
const LAST_ATTEMPT_BUCKET = 2;
// A merchant is paid out at most daily, so a 90-day period has well under this many cash-outs.
const MAX_CASH_OUTS = 100;
const MAX_REASONS = 20;

export type MoneyDay = { date: string; cashCollectedPiasters: number; feesPiasters: number; netPiasters: number };
export type PaidCashOut = { id: string; number: string; amountPiasters: number; paidAt: Date };

export type MerchantAnalytics = {
  period: { from: Date; to: Date };
  completedOrders: number;
  deliveredCount: number;
  notDeliveredCount: number;
  // Delivered ÷ (delivered + returned), between 0 and 1. Null when nothing was completed.
  successRate: number | null;
  averageDeliveryHours: number | null;
  // Shares (0 to 1) of delivered orders by the try they were delivered on.
  attempts: { first: number; second: number; third: number };
  notDeliveredReasons: { reason: string; count: number }[];
  byGovernorate: { governorateCode: string; orders: number; delivered: number }[];
  // Null when the user has no finance access.
  moneyByDay: MoneyDay[] | null;
  cashOuts: PaidCashOut[] | null;
};

type Window = { from: Date; end: Date; days: string[] };

function addDays(cairoDate: string, days: number): string {
  return new Date(new Date(`${cairoDate}T12:00:00Z`).getTime() + days * MS_PER_DAY).toISOString().slice(0, 10);
}

// The last `days` Cairo calendar days, today included: from the first day's midnight to the next midnight after today.
function periodWindow(days: number, now: Date): Window {
  const today = cairoDateString(now);
  const firstDay = addDays(today, -(days - 1));
  const dayList = Array.from({ length: days }, (_, index) => addDays(firstDay, index));
  return { from: cairoDateToUtcStart(firstDay), end: cairoDateToUtcStart(addDays(today, 1)), days: dayList };
}

function hasFinanceAccess(user: SessionUser, merchantId: string): boolean {
  try {
    requireMerchantAccess(user, merchantId, 'finance');
    return true;
  } catch {
    return false;
  }
}

// Final outcomes (delivered or returned) reached in the period, per governorate.
async function outcomesByGovernorate(merchantId: string, { from, end }: Window) {
  return db.$queryRaw<{ governorateCode: string; status: 'delivered' | 'returned'; count: number }[]>`
    SELECT a."governorateCode" AS "governorateCode", e."toStatus"::text AS status, COUNT(*)::int AS count
    FROM "OrderEvent" e
    JOIN "Order" o ON o.id = e."orderId"
    JOIN "Area" a ON a.id = o."areaId"
    WHERE o."merchantId" = ${merchantId}::uuid
      AND e.kind = 'status_changed'
      AND e."toStatus" IN ('delivered', 'returned')
      AND e.at >= ${from} AND e.at < ${end}
    GROUP BY 1, 2`;
}

async function deliveredByTry(merchantId: string, { from, end }: Window) {
  return db.$queryRaw<{ bucket: number; count: number }[]>`
    SELECT LEAST(o.attempts, ${LAST_ATTEMPT_BUCKET})::int AS bucket, COUNT(*)::int AS count
    FROM "OrderEvent" e
    JOIN "Order" o ON o.id = e."orderId"
    WHERE o."merchantId" = ${merchantId}::uuid
      AND e.kind = 'status_changed'
      AND e."toStatus" = 'delivered'
      AND e.at >= ${from} AND e.at < ${end}
    GROUP BY 1`;
}

// From the first pick-up to delivery, for orders delivered in the period.
async function averageDeliveryHours(merchantId: string, { from, end }: Window): Promise<number | null> {
  const [row] = await db.$queryRaw<{ hours: number | null }[]>`
    SELECT AVG(EXTRACT(EPOCH FROM (e.at - picked.at)) / 3600)::float8 AS hours
    FROM "OrderEvent" e
    JOIN "Order" o ON o.id = e."orderId"
    JOIN LATERAL (
      SELECT MIN(p.at) AS at FROM "OrderEvent" p
      WHERE p."orderId" = e."orderId" AND p.kind = 'status_changed' AND p."toStatus" = 'picked_up'
    ) picked ON picked.at IS NOT NULL
    WHERE o."merchantId" = ${merchantId}::uuid
      AND e.kind = 'status_changed'
      AND e."toStatus" = 'delivered'
      AND e.at >= ${from} AND e.at < ${end}`;
  return row?.hours ?? null;
}

async function failedAttemptReasons(merchantId: string, { from, end }: Window) {
  return db.$queryRaw<{ reason: string; count: number }[]>`
    SELECT COALESCE(NULLIF(e.reason, ''), ${UNSPECIFIED_REASON}) AS reason, COUNT(*)::int AS count
    FROM "OrderEvent" e
    JOIN "Order" o ON o.id = e."orderId"
    WHERE o."merchantId" = ${merchantId}::uuid
      AND e.kind = 'status_changed'
      AND e."toStatus" = 'attempt_failed'
      AND e.at >= ${from} AND e.at < ${end}
    GROUP BY 1
    ORDER BY count DESC, reason
    LIMIT ${MAX_REASONS}`;
}

// Cash collected is what the courier took (cash in transit); net is what the wallet was credited.
async function moneyByCairoDay(merchantId: string, window: Window): Promise<MoneyDay[]> {
  const wallet = walletAccount(merchantId);
  const rows = await db.$queryRaw<{ date: string; cash: bigint; wallet: bigint }[]>`
    SELECT to_char((le."postedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Africa/Cairo', 'YYYY-MM-DD') AS date,
           COALESCE(SUM(ll."amountPiasters") FILTER (WHERE ll."accountCode" = ${LEDGER_ACCOUNTS.cashInTransit}), 0)::bigint AS cash,
           COALESCE(SUM(ll."amountPiasters") FILTER (WHERE ll."accountCode" = ${wallet}), 0)::bigint AS wallet
    FROM "LedgerEntry" le
    JOIN "LedgerLine" ll ON ll."entryId" = le.id
    WHERE le."merchantId" = ${merchantId}::uuid
      AND le.reason IN ('order_delivered', 'order_returned')
      AND le."postedAt" >= ${window.from} AND le."postedAt" < ${window.end}
    GROUP BY 1`;
  const byDate = new Map(rows.map((row) => [row.date, row]));
  return window.days.map((date) => {
    const row = byDate.get(date);
    const cashCollectedPiasters = Number(row?.cash ?? 0);
    // The wallet is credited (negative) with what Shiply owes the merchant.
    const netPiasters = -Number(row?.wallet ?? 0);
    return { date, cashCollectedPiasters, feesPiasters: cashCollectedPiasters - netPiasters, netPiasters };
  });
}

async function paidCashOuts(merchantId: string, { from, end }: Window): Promise<PaidCashOut[]> {
  const rows = await db.cashOut.findMany({
    where: { merchantId, status: 'paid', paidAt: { gte: from, lt: end } },
    orderBy: { paidAt: 'desc' },
    take: MAX_CASH_OUTS,
    select: { id: true, number: true, amountPiasters: true, paidAt: true },
  });
  return rows.map((row) => ({ ...row, paidAt: row.paidAt as Date }));
}

function summarizeOutcomes(rows: Awaited<ReturnType<typeof outcomesByGovernorate>>) {
  const governorates = new Map<string, { governorateCode: string; orders: number; delivered: number }>();
  let deliveredCount = 0;
  let notDeliveredCount = 0;
  for (const row of rows) {
    const entry = governorates.get(row.governorateCode) ?? { governorateCode: row.governorateCode, orders: 0, delivered: 0 };
    entry.orders += row.count;
    if (row.status === 'delivered') {
      entry.delivered += row.count;
      deliveredCount += row.count;
    } else {
      notDeliveredCount += row.count;
    }
    governorates.set(row.governorateCode, entry);
  }
  const byGovernorate = [...governorates.values()].sort((a, b) => b.orders - a.orders || a.governorateCode.localeCompare(b.governorateCode));
  return { deliveredCount, notDeliveredCount, byGovernorate };
}

function attemptShares(rows: { bucket: number; count: number }[], deliveredCount: number) {
  const share = (bucket: number) => {
    if (deliveredCount === 0) return 0;
    return (rows.find((row) => row.bucket === bucket)?.count ?? 0) / deliveredCount;
  };
  return { first: share(0), second: share(1), third: share(LAST_ATTEMPT_BUCKET) };
}

export async function getMerchantAnalytics(
  user: SessionUser,
  merchantId: string,
  { days }: { days: AnalyticsPeriodDays },
  now: Date = new Date(),
): Promise<MerchantAnalytics> {
  requireMerchantAccess(user, merchantId, 'orders');
  if (!ANALYTICS_PERIODS.includes(days)) throw new AppError('invalid_input');
  const window = periodWindow(days, now);
  const showMoney = hasFinanceAccess(user, merchantId);

  const [outcomes, tries, hours, reasons, money, cashOuts] = await Promise.all([
    outcomesByGovernorate(merchantId, window),
    deliveredByTry(merchantId, window),
    averageDeliveryHours(merchantId, window),
    failedAttemptReasons(merchantId, window),
    showMoney ? moneyByCairoDay(merchantId, window) : null,
    showMoney ? paidCashOuts(merchantId, window) : null,
  ]);
  const { deliveredCount, notDeliveredCount, byGovernorate } = summarizeOutcomes(outcomes);
  const completedOrders = deliveredCount + notDeliveredCount;

  return {
    period: { from: window.from, to: new Date(window.end.getTime() - 1) },
    completedOrders,
    deliveredCount,
    notDeliveredCount,
    successRate: completedOrders === 0 ? null : deliveredCount / completedOrders,
    averageDeliveryHours: hours,
    attempts: attemptShares(tries, deliveredCount),
    notDeliveredReasons: reasons,
    byGovernorate,
    moneyByDay: money,
    cashOuts,
  };
}
