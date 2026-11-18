import { randomInt, randomUUID } from 'node:crypto';
import type { OrderStatus, Pickup, PickupStatus, Prisma } from '@prisma/client';
import { z } from 'zod';
import { requireMerchantAccess, type SessionUser } from '@/accounts';
import { changeOrderStatus } from '@/orders/order-status';
import { writeAudit } from '@/platform/audit-log';
import { runOnce } from '@/platform/idempotency';
import { AppError } from '@/shared/app-error';
import { db } from '@/shared/db';

export const PICKUPS_PAGE_SIZE = 25;
const MAX_DAYS_AHEAD = 14;
const DAYS_PER_WEEK = 7;
const MS_PER_DAY = 86_400_000;
const MAX_EXPECTED_COUNT = 1000;
const MAX_ORDERS_PER_ADD = 1000;
const MAX_RATING_COMMENT_LENGTH = 300;
const PICKUP_NUMBER_TRIES = 5;
const STAFF_ROLES_FOR_PICKUPS = new Set(['admin', 'operations']);
// 8 digits, first digit 1–9, from a cryptographic source so numbers cannot be guessed in sequence.
const SMALLEST_EIGHT_DIGIT = 10_000_000;
const LARGEST_EIGHT_DIGIT = 99_999_999;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

const Id = z.string().uuid();
const RequestPickupSchema = z.object({
  locationId: z.string().uuid(),
  pickupDate: z.string(),
  expectedCount: z.number().int().min(1).max(MAX_EXPECTED_COUNT),
  repeatWeekly: z.boolean(),
});
const OrderIds = z.array(z.string().uuid()).min(1).max(MAX_ORDERS_PER_ADD);
const CollectedOrderIds = z.array(z.string().uuid()).max(MAX_ORDERS_PER_ADD);
const RatingSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(MAX_RATING_COMMENT_LENGTH).optional(),
});
const ListQuerySchema = z.object({ tab: z.enum(['upcoming', 'history']), page: z.number().int().min(1) });

export type RequestPickupInput = z.input<typeof RequestPickupSchema>;
export type PickupListQuery = z.input<typeof ListQuerySchema>;

export type PickupListRow = {
  id: string;
  number: string;
  pickupDate: string;
  status: PickupStatus;
  addressText: string;
  contactName: string;
  contactMobile: string;
  expectedCount: number;
  attachedOrderCount: number;
  collectedCount: number | null;
  repeatWeekly: boolean;
  rating: number | null;
};

export type PickupListResult = { rows: PickupListRow[]; page: number; pageCount: number; total: number };

export function generatePickupNumber(): string {
  return String(randomInt(SMALLEST_EIGHT_DIGIT, LARGEST_EIGHT_DIGIT + 1));
}

// ---------- Cairo calendar days ----------

const cairoDateFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Africa/Cairo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

// Pickup days are calendar dates stored as UTC midnight (a @db.Date column).
function cairoToday(now: Date): Date {
  return new Date(`${cairoDateFormat.format(now)}T00:00:00Z`);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

function toDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function parsePickupDate(value: string, now: Date): Date {
  const match = DATE_PATTERN.exec(value);
  if (!match) throw new AppError('invalid_pickup_date');
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (toDateString(date) !== value) throw new AppError('invalid_pickup_date');
  const today = cairoToday(now);
  if (date < addDays(today, 1) || date > addDays(today, MAX_DAYS_AHEAD)) throw new AppError('invalid_pickup_date');
  return date;
}

// ---------- Shared steps ----------

function isPickupStaff(user: SessionUser): boolean {
  return user.staffRoles.some((role) => STAFF_ROLES_FOR_PICKUPS.has(role));
}

// Pickups for one place are booked one at a time, so the same place and day is never booked twice.
async function lockLocation(tx: Prisma.TransactionClient, locationId: string): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "PickupLocation" WHERE "id" = ${locationId}::uuid FOR UPDATE`;
}

async function uniquePickupNumber(tx: Prisma.TransactionClient): Promise<string> {
  for (let attempt = 0; attempt < PICKUP_NUMBER_TRIES; attempt += 1) {
    const number = generatePickupNumber();
    if (!(await tx.pickup.findUnique({ where: { number }, select: { id: true } }))) return number;
  }
  throw new Error('Could not find a free pickup number after several tries; try again.');
}

async function findMerchantPickupOrThrow(merchantId: string, pickupId: string): Promise<Pickup> {
  if (!Id.safeParse(pickupId).success) throw new AppError('not_found', 404);
  const pickup = await db.pickup.findFirst({ where: { id: pickupId, merchantId } });
  if (!pickup) throw new AppError('not_found', 404);
  return pickup;
}

// Order status changes go through changeOrderStatus, one order at a time and outside the pickup
// transaction. Only orders still in `from` are moved, so a retry or a racing call is harmless.
async function moveOrders(actor: SessionUser, orderIds: string[], from: OrderStatus, to: OrderStatus): Promise<number> {
  if (orderIds.length === 0) return 0;
  const orders = await db.order.findMany({ where: { id: { in: orderIds }, status: from }, select: { id: true } });
  let moved = 0;
  for (const order of orders) {
    try {
      await changeOrderStatus(actor, order.id, to);
      moved += 1;
    } catch (error) {
      // If another request moved this order first, changeOrderStatus refuses (as invalid_transition,
      // or as forbidden for a merchant); nothing is left to do for it. Any other failure is real.
      const current = await db.order.findUnique({ where: { id: order.id }, select: { status: true } });
      if (current?.status === from) throw error;
    }
  }
  return moved;
}

async function attachedOrderIdsOf(pickupId: string): Promise<string[]> {
  const rows = await db.pickupOrder.findMany({ where: { pickupId }, select: { orderId: true } });
  return rows.map((row) => row.orderId);
}

// A weekly pickup books the same weekday next week (or the first such day still ahead) at the
// location's current address. Nothing is booked if the location was archived or that day is taken.
async function bookNextInSeries(tx: Prisma.TransactionClient, pickup: Pickup, actorUserId: string, now: Date): Promise<void> {
  if (!pickup.repeatWeekly) return;
  const location = await tx.pickupLocation.findUnique({ where: { id: pickup.locationId } });
  if (!location?.isActive) return;

  const tomorrow = addDays(cairoToday(now), 1);
  let pickupDate = addDays(pickup.pickupDate, DAYS_PER_WEEK);
  while (pickupDate < tomorrow) pickupDate = addDays(pickupDate, DAYS_PER_WEEK);

  await lockLocation(tx, location.id);
  const taken = await tx.pickup.findFirst({ where: { locationId: location.id, pickupDate, status: 'scheduled' }, select: { id: true } });
  if (taken) return;

  const next = await tx.pickup.create({
    data: {
      number: await uniquePickupNumber(tx),
      merchantId: pickup.merchantId,
      locationId: location.id,
      addressText: location.addressText,
      areaId: location.areaId,
      contactName: location.contactName,
      contactMobile: location.contactMobile,
      pickupDate,
      expectedCount: pickup.expectedCount,
      repeatWeekly: true,
      seriesId: pickup.seriesId,
      createdBy: actorUserId,
    },
  });
  await writeAudit(tx, {
    actorUserId,
    action: 'pickup.repeat_booked',
    entityType: 'Pickup',
    entityId: next.id,
    before: null,
    after: { previousPickupId: pickup.id, seriesId: pickup.seriesId, pickupDate: toDateString(pickupDate) },
  });
}

// ---------- Merchant actions ----------

// Books a courier visit and attaches the merchant's orders that are `new` right now. The same key
// returns the first result; a second request for the same place and day returns the booked pickup.
export async function requestPickup(
  user: SessionUser,
  merchantId: string,
  rawInput: RequestPickupInput,
  idempotencyKey: string,
  now: Date = new Date(),
): Promise<{ id: string; number: string; attachedOrderCount: number }> {
  requireMerchantAccess(user, merchantId, 'orders');
  const parsed = RequestPickupSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError('invalid_input');
  const input = parsed.data;
  const pickupDate = parsePickupDate(input.pickupDate, now);

  const result = await runOnce(idempotencyKey, `pickup.request:${merchantId}`, async (tx) => {
    await lockLocation(tx, input.locationId);
    const location = await tx.pickupLocation.findFirst({ where: { id: input.locationId, merchantId, isActive: true } });
    if (!location) throw new AppError('not_found', 404);

    const existing = await tx.pickup.findFirst({ where: { locationId: location.id, pickupDate, status: 'scheduled' } });
    const pickup =
      existing ??
      (await tx.pickup.create({
        data: {
          number: await uniquePickupNumber(tx),
          merchantId,
          locationId: location.id,
          addressText: location.addressText,
          areaId: location.areaId,
          contactName: location.contactName,
          contactMobile: location.contactMobile,
          pickupDate,
          expectedCount: input.expectedCount,
          repeatWeekly: input.repeatWeekly,
          seriesId: input.repeatWeekly ? randomUUID() : null,
          createdBy: user.id,
        },
      }));

    // An order already in another pickup is skipped by the unique order id.
    await tx.$executeRaw`
      INSERT INTO "PickupOrder" ("pickupId", "orderId")
      SELECT ${pickup.id}::uuid, "id" FROM "Order"
      WHERE "merchantId" = ${merchantId}::uuid AND "status" = 'new'
      ON CONFLICT DO NOTHING`;
    const attachedOrderCount = await tx.pickupOrder.count({ where: { pickupId: pickup.id } });

    if (!existing) {
      await writeAudit(tx, {
        actorUserId: user.id,
        action: 'pickup.requested',
        entityType: 'Pickup',
        entityId: pickup.id,
        before: null,
        after: { merchantId, locationId: location.id, pickupDate: toDateString(pickupDate), repeatWeekly: pickup.repeatWeekly, seriesId: pickup.seriesId },
      });
    }
    return { id: pickup.id, number: pickup.number, attachedOrderCount };
  });

  // Runs on a repeat too, so orders attached by an interrupted first attempt still move.
  await moveOrders(user, await attachedOrderIdsOf(result.id), 'new', 'pickup_requested');
  return result;
}

// Adds orders created after a pickup was booked to the next scheduled pickup at the location
// (the default location when none is given). Orders that are not `new` are skipped.
export async function addOrdersToPickup(
  user: SessionUser,
  merchantId: string,
  orderIds: string[],
  locationId?: string,
  now: Date = new Date(),
): Promise<{ pickupId: string; number: string; addedCount: number }> {
  requireMerchantAccess(user, merchantId, 'orders');
  const parsedIds = OrderIds.safeParse(orderIds);
  if (!parsedIds.success) throw new AppError('invalid_input');
  if (locationId !== undefined && !Id.safeParse(locationId).success) throw new AppError('not_found', 404);

  const location = await db.pickupLocation.findFirst({
    where: { merchantId, isActive: true, ...(locationId ? { id: locationId } : { isDefault: true }) },
    select: { id: true },
  });
  if (!location && locationId) throw new AppError('not_found', 404);
  const pickup = location
    ? await db.pickup.findFirst({
        where: { locationId: location.id, status: 'scheduled', pickupDate: { gte: cairoToday(now) } },
        orderBy: { pickupDate: 'asc' },
      })
    : null;
  if (!pickup) throw new AppError('no_scheduled_pickup', 409);

  const eligible = await db.order.findMany({
    where: { id: { in: parsedIds.data }, merchantId, status: 'new' },
    select: { id: true },
  });
  const eligibleIds = eligible.map((order) => order.id);
  if (eligibleIds.length > 0) {
    await db.$transaction(async (tx) => {
      const inserted = await tx.pickupOrder.createMany({
        data: eligibleIds.map((orderId) => ({ pickupId: pickup.id, orderId })),
        skipDuplicates: true,
      });
      if (inserted.count === 0) return;
      await writeAudit(tx, {
        actorUserId: user.id,
        action: 'pickup.orders_added',
        entityType: 'Pickup',
        entityId: pickup.id,
        before: null,
        after: { orderIds: eligibleIds },
      });
    });
  }

  const attached = await db.pickupOrder.findMany({
    where: { pickupId: pickup.id, orderId: { in: eligibleIds } },
    select: { orderId: true },
  });
  const addedCount = await moveOrders(user, attached.map((row) => row.orderId), 'new', 'pickup_requested');
  return { pickupId: pickup.id, number: pickup.number, addedCount };
}

// Cancels a scheduled pickup; its orders go back to `new` and can join another pickup.
// Canceling an already canceled pickup does nothing.
export async function cancelPickup(user: SessionUser, merchantId: string, pickupId: string, now: Date = new Date()): Promise<void> {
  requireMerchantAccess(user, merchantId, 'orders');
  const pickup = await findMerchantPickupOrThrow(merchantId, pickupId);
  if (pickup.status === 'canceled') return;
  if (pickup.status !== 'scheduled') throw new AppError('pickup_not_cancellable', 409);

  // Orders move first: if this stops half way, the pickup is still scheduled and a retry finishes.
  const orderIds = await attachedOrderIdsOf(pickup.id);
  await moveOrders(user, orderIds, 'pickup_requested', 'new');

  await db.$transaction(async (tx) => {
    // Atomic status check: a courier collection or a second cancel racing this one matches no row.
    const updated = await tx.pickup.updateMany({ where: { id: pickup.id, status: 'scheduled' }, data: { status: 'canceled' } });
    if (updated.count === 0) {
      const current = await tx.pickup.findUniqueOrThrow({ where: { id: pickup.id }, select: { status: true } });
      if (current.status === 'canceled') return;
      throw new AppError('pickup_not_cancellable', 409);
    }
    await tx.pickupOrder.deleteMany({ where: { pickupId: pickup.id } });
    await writeAudit(tx, {
      actorUserId: user.id,
      action: 'pickup.canceled',
      entityType: 'Pickup',
      entityId: pickup.id,
      before: { status: 'scheduled' },
      after: { status: 'canceled', releasedOrderIds: orderIds },
    });
    await bookNextInSeries(tx, pickup, user.id, now);
  });
}

// Ends a weekly series: no further pickups are booked after the scheduled one.
export async function stopRepeating(user: SessionUser, merchantId: string, pickupId: string): Promise<void> {
  requireMerchantAccess(user, merchantId, 'orders');
  const pickup = await findMerchantPickupOrThrow(merchantId, pickupId);
  await db.$transaction(async (tx) => {
    const where: Prisma.PickupWhereInput = pickup.seriesId
      ? { merchantId, seriesId: pickup.seriesId, repeatWeekly: true }
      : { id: pickup.id, repeatWeekly: true };
    const updated = await tx.pickup.updateMany({ where, data: { repeatWeekly: false } });
    if (updated.count === 0) return;
    await writeAudit(tx, {
      actorUserId: user.id,
      action: 'pickup.repeat_stopped',
      entityType: 'Pickup',
      entityId: pickup.id,
      before: { repeatWeekly: true },
      after: { repeatWeekly: false, seriesId: pickup.seriesId },
    });
  });
}

export async function ratePickup(
  user: SessionUser,
  merchantId: string,
  pickupId: string,
  rawInput: { rating: number; comment?: string },
): Promise<void> {
  requireMerchantAccess(user, merchantId, 'orders');
  const parsed = RatingSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError('invalid_input');
  const pickup = await findMerchantPickupOrThrow(merchantId, pickupId);
  if (pickup.status !== 'collected') throw new AppError('pickup_not_rateable', 409);
  const ratingComment = parsed.data.comment ? parsed.data.comment : null;

  await db.$transaction(async (tx) => {
    await tx.pickup.update({ where: { id: pickup.id }, data: { rating: parsed.data.rating, ratingComment } });
    await writeAudit(tx, {
      actorUserId: user.id,
      action: 'pickup.rated',
      entityType: 'Pickup',
      entityId: pickup.id,
      before: { rating: pickup.rating },
      after: { rating: parsed.data.rating },
    });
  });
}

// Upcoming: scheduled pickups, soonest first. History: collected and canceled, latest first.
export async function listPickups(user: SessionUser, merchantId: string, rawQuery: PickupListQuery): Promise<PickupListResult> {
  requireMerchantAccess(user, merchantId, 'orders');
  const parsed = ListQuerySchema.safeParse(rawQuery);
  if (!parsed.success) throw new AppError('invalid_input');
  const isUpcoming = parsed.data.tab === 'upcoming';
  const where: Prisma.PickupWhereInput = {
    merchantId,
    status: isUpcoming ? 'scheduled' : { in: ['collected', 'canceled'] },
  };
  const direction = isUpcoming ? 'asc' : 'desc';

  const total = await db.pickup.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / PICKUPS_PAGE_SIZE));
  const page = Math.min(parsed.data.page, pageCount);
  const rows = await db.pickup.findMany({
    where,
    orderBy: [{ pickupDate: direction }, { createdAt: direction }, { id: direction }],
    skip: (page - 1) * PICKUPS_PAGE_SIZE,
    take: PICKUPS_PAGE_SIZE,
    include: { _count: { select: { orders: true } } },
  });

  return {
    rows: rows.map((row) => ({
      id: row.id,
      number: row.number,
      pickupDate: toDateString(row.pickupDate),
      status: row.status,
      addressText: row.addressText,
      contactName: row.contactName,
      contactMobile: row.contactMobile,
      expectedCount: row.expectedCount,
      attachedOrderCount: row._count.orders,
      collectedCount: row.collectedCount,
      repeatWeekly: row.repeatWeekly,
      rating: row.rating,
    })),
    page,
    pageCount,
    total,
  };
}

// ---------- Staff actions ----------

// The courier collected the pickup: collected orders become `picked_up`, attached orders the courier
// did not take go back to `new`. Repeating the same call after success does nothing.
export async function markPickupCollected(
  staffUser: SessionUser,
  pickupId: string,
  collectedOrderIds: string[],
  now: Date = new Date(),
): Promise<void> {
  if (!isPickupStaff(staffUser)) throw new AppError('forbidden', 403);
  const parsedIds = CollectedOrderIds.safeParse(collectedOrderIds);
  if (!parsedIds.success) throw new AppError('invalid_input');
  if (!Id.safeParse(pickupId).success) throw new AppError('not_found', 404);
  const pickup = await db.pickup.findUnique({ where: { id: pickupId } });
  if (!pickup) throw new AppError('not_found', 404);
  if (pickup.status === 'collected') return;
  if (pickup.status !== 'scheduled') throw new AppError('pickup_not_collectable', 409);

  const attachedIds = await attachedOrderIdsOf(pickup.id);
  const collectedIds = [...new Set(parsedIds.data)];
  if (collectedIds.some((orderId) => !attachedIds.includes(orderId))) throw new AppError('order_not_in_pickup');
  const leftIds = attachedIds.filter((orderId) => !collectedIds.includes(orderId));

  // Orders move first: if this stops half way, the pickup is still scheduled and a retry finishes.
  await moveOrders(staffUser, collectedIds, 'pickup_requested', 'picked_up');
  await moveOrders(staffUser, leftIds, 'pickup_requested', 'new');

  await db.$transaction(async (tx) => {
    const updated = await tx.pickup.updateMany({
      where: { id: pickup.id, status: 'scheduled' },
      data: { status: 'collected', collectedCount: collectedIds.length },
    });
    if (updated.count === 0) {
      const current = await tx.pickup.findUniqueOrThrow({ where: { id: pickup.id }, select: { status: true } });
      if (current.status === 'collected') return;
      throw new AppError('pickup_not_collectable', 409);
    }
    await tx.pickupOrder.deleteMany({ where: { pickupId: pickup.id, orderId: { in: leftIds } } });
    await writeAudit(tx, {
      actorUserId: staffUser.id,
      action: 'pickup.collected',
      entityType: 'Pickup',
      entityId: pickup.id,
      before: { status: 'scheduled' },
      after: { status: 'collected', collectedOrderIds: collectedIds, releasedOrderIds: leftIds },
    });
    await bookNextInSeries(tx, pickup, staffUser.id, now);
  });
}
