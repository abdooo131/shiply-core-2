import type { OrderStatus } from '@prisma/client';
import { requireMerchantAccess, type SessionUser } from '@/accounts';
import { listOrders, parseOrderListQuery } from '@/orders/order-list';
import { cairoDateString, cairoDateToUtcStart } from '@/shared/cairo-time';
import { db } from '@/shared/db';

const CHART_DAYS = 14;
const MAX_NEEDS_ACTION = 5;
const MS_PER_DAY = 86_400_000;
const FINAL_STATUSES: OrderStatus[] = ['delivered', 'returned', 'canceled'];

export type NeedsActionOrder = {
  id: string;
  number: string;
  customerName: string;
  areaNameEn: string;
  areaNameAr: string;
  // What the courier said when they asked the merchant; null when the hub gave no reason.
  reason: string | null;
  attempts: number;
};

export type DeliveryDay = { date: string; delivered: number; returned: number };

export type HomeSummary = {
  todayCreated: number;
  todayPickedUp: number;
  todayDelivered: number;
  needsAction: NeedsActionOrder[];
  needsActionCount: number;
  openCounts: { inProgress: number; new: number; comingBack: number };
  deliveriesLast14Days: DeliveryDay[];
  expectedFromActivePiasters: number;
};

type DayStatusCount = { day: string; status: 'picked_up' | 'delivered' | 'returned'; count: number };

// A Cairo calendar date moved by whole days. Noon UTC is the same calendar day in Cairo.
function addDays(cairoDate: string, days: number): string {
  return new Date(new Date(`${cairoDate}T12:00:00Z`).getTime() + days * MS_PER_DAY).toISOString().slice(0, 10);
}

// One grouped query: how many orders reached each status on each Cairo day of the window.
async function countStatusesPerCairoDay(merchantId: string, from: Date, to: Date): Promise<DayStatusCount[]> {
  // Timeline times are stored as UTC without a zone, so they are read as UTC before turning them into Cairo days.
  return db.$queryRaw<DayStatusCount[]>`
    SELECT to_char((e."at" AT TIME ZONE 'UTC') AT TIME ZONE 'Africa/Cairo', 'YYYY-MM-DD') AS day,
           e."toStatus"::text AS status,
           COUNT(DISTINCT e."orderId")::int AS count
    FROM "OrderEvent" e
    JOIN "Order" o ON o."id" = e."orderId"
    WHERE o."merchantId" = ${merchantId}::uuid
      AND e."kind" = 'status_changed'
      AND e."toStatus" IN ('picked_up', 'delivered', 'returned')
      AND e."at" >= (${from}::timestamptz AT TIME ZONE 'UTC')
      AND e."at" < (${to}::timestamptz AT TIME ZONE 'UTC')
    GROUP BY 1, 2`;
}

// The reason on the newest "asked the merchant" timeline entry of each order, in one query.
async function awaitingReasons(orderIds: string[]): Promise<Map<string, string | null>> {
  if (orderIds.length === 0) return new Map();
  const events = await db.orderEvent.findMany({
    where: { orderId: { in: orderIds }, kind: 'status_changed', toStatus: 'awaiting_merchant_action' },
    orderBy: { at: 'desc' },
    select: { orderId: true, reason: true },
  });
  const reasons = new Map<string, string | null>();
  for (const event of events) if (!reasons.has(event.orderId)) reasons.set(event.orderId, event.reason);
  return reasons;
}

export async function getHomeSummary(user: SessionUser, merchantId: string, now: Date = new Date()): Promise<HomeSummary> {
  requireMerchantAccess(user, merchantId, 'orders');
  const today = cairoDateString(now);
  const todayStart = cairoDateToUtcStart(today);
  const tomorrowStart = cairoDateToUtcStart(addDays(today, 1));
  const chartDates = Array.from({ length: CHART_DAYS }, (_, index) => addDays(today, index - (CHART_DAYS - 1)));
  const chartStart = cairoDateToUtcStart(chartDates[0] ?? today);

  const [todayCreated, perDay, needing, expected] = await Promise.all([
    db.order.count({ where: { merchantId, createdAt: { gte: todayStart, lt: tomorrowStart } } }),
    countStatusesPerCairoDay(merchantId, chartStart, tomorrowStart),
    listOrders(user, merchantId, parseOrderListQuery({ tab: 'needs_action' }), now),
    db.order.aggregate({ where: { merchantId, status: { notIn: FINAL_STATUSES } }, _sum: { codAmountPiasters: true } }),
  ]);

  const countOf = (date: string, status: DayStatusCount['status']) =>
    perDay.find((row) => row.day === date && row.status === status)?.count ?? 0;
  const shown = needing.orders.slice(0, MAX_NEEDS_ACTION);
  const reasons = await awaitingReasons(shown.map((order) => order.id));

  return {
    todayCreated,
    todayPickedUp: countOf(today, 'picked_up'),
    todayDelivered: countOf(today, 'delivered'),
    needsAction: shown.map((order) => ({
      id: order.id,
      number: order.number,
      customerName: order.customerName,
      areaNameEn: order.areaNameEn,
      areaNameAr: order.areaNameAr,
      reason: reasons.get(order.id) ?? null,
      attempts: order.attempts,
    })),
    needsActionCount: needing.tabCounts.needs_action,
    openCounts: {
      inProgress: needing.tabCounts.in_progress,
      new: needing.tabCounts.new,
      comingBack: needing.tabCounts.coming_back,
    },
    deliveriesLast14Days: chartDates.map((date) => ({
      date,
      delivered: countOf(date, 'delivered'),
      returned: countOf(date, 'returned'),
    })),
    expectedFromActivePiasters: expected._sum.codAmountPiasters ?? 0,
  };
}
