import type { Order, OrderStatus } from '@prisma/client';
import { z } from 'zod';
import { requireMerchantAccess, type SessionUser } from '@/accounts';
import { writeAudit } from '@/platform/audit-log';
import { AppError } from '@/shared/app-error';
import { db } from '@/shared/db';

export const MAX_DELIVERY_ATTEMPTS = 3;

const STAFF_ROLES_FOR_ORDERS = new Set(['admin', 'operations']);
const MAX_REASON_LENGTH = 100;
const MAX_NOTE_LENGTH = 1000;
// Timeline entries per order stay small (a handful of statuses and notes); the cap keeps it bounded.
const MAX_TIMELINE_ENTRIES = 500;

export const ORDER_STATUS_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  new: ['pickup_requested', 'picked_up', 'canceled'],
  pickup_requested: ['picked_up', 'new', 'canceled'],
  picked_up: ['in_progress'],
  in_progress: ['out_for_delivery', 'awaiting_merchant_action', 'returning'],
  out_for_delivery: ['delivered', 'attempt_failed'],
  attempt_failed: ['out_for_delivery', 'rescheduled', 'awaiting_merchant_action', 'returning'],
  rescheduled: ['out_for_delivery'],
  awaiting_merchant_action: ['in_progress', 'returning'],
  returning: ['returned'],
  delivered: [],
  returned: [],
  canceled: [],
};

// Merchants may only cancel before pickup and answer a question the network asked them.
const MERCHANT_TRANSITIONS: Partial<Record<OrderStatus, readonly OrderStatus[]>> = {
  new: ['canceled'],
  pickup_requested: ['canceled'],
  awaiting_merchant_action: ['in_progress', 'returning'],
};

// After the last allowed attempt the parcel must not go out again.
const BLOCKED_AFTER_MAX_ATTEMPTS: ReadonlySet<OrderStatus> = new Set(['out_for_delivery', 'rescheduled']);

const OrderId = z.string().uuid();
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value ? value : null));
const StatusDetails = z.object({ reason: optionalText(MAX_REASON_LENGTH), note: optionalText(MAX_NOTE_LENGTH) });
const NoteText = z.string().trim().min(1).max(MAX_NOTE_LENGTH);

export type OrderTimelineEntry = {
  kind: string;
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus | null;
  reason: string | null;
  note: string | null;
  actorUserId: string | null;
  at: Date;
};

function isOrderStaff(user: SessionUser): boolean {
  return user.staffRoles.some((role) => STAFF_ROLES_FOR_ORDERS.has(role));
}

async function findOrderOrThrow(orderId: string): Promise<Order> {
  if (!OrderId.safeParse(orderId).success) throw new AppError('not_found', 404);
  const order = await db.order.findUnique({ where: { id: orderId } });
  if (!order) throw new AppError('not_found', 404);
  return order;
}

function requireOrderView(user: SessionUser, order: Order): void {
  if (isOrderStaff(user)) return;
  requireMerchantAccess(user, order.merchantId, 'orders');
}

function requireStatusChangeRight(actor: SessionUser, order: Order, to: OrderStatus): void {
  if (isOrderStaff(actor)) return;
  requireMerchantAccess(actor, order.merchantId, 'orders');
  if (!MERCHANT_TRANSITIONS[order.status]?.includes(to)) throw new AppError('forbidden', 403);
}

function isAllowedTransition(order: Order, to: OrderStatus): boolean {
  if (!ORDER_STATUS_TRANSITIONS[order.status].includes(to)) return false;
  const isOutOfAttempts = order.status === 'attempt_failed' && order.attempts >= MAX_DELIVERY_ATTEMPTS;
  return !(isOutOfAttempts && BLOCKED_AFTER_MAX_ATTEMPTS.has(to));
}

export async function changeOrderStatus(
  actor: SessionUser,
  orderId: string,
  to: OrderStatus,
  details: { reason?: string; note?: string } = {},
): Promise<void> {
  const parsed = StatusDetails.safeParse(details);
  if (!parsed.success) throw new AppError('invalid_input');
  const order = await findOrderOrThrow(orderId);
  requireStatusChangeRight(actor, order, to);
  if (!isAllowedTransition(order, to)) throw new AppError('invalid_transition', 409);

  const isFailedAttempt = order.status === 'out_for_delivery' && to === 'attempt_failed';
  await db.$transaction(async (tx) => {
    // Atomic status check: if someone else changed the order since we read it, nothing matches.
    const updated = await tx.order.updateMany({
      where: { id: order.id, status: order.status },
      data: { status: to, ...(isFailedAttempt ? { attempts: { increment: 1 } } : {}) },
    });
    if (updated.count === 0) throw new AppError('invalid_transition', 409);

    await tx.orderEvent.create({
      data: {
        orderId: order.id,
        kind: 'status_changed',
        fromStatus: order.status,
        toStatus: to,
        reason: parsed.data.reason,
        note: parsed.data.note,
        actorUserId: actor.id,
      },
    });
    await writeAudit(tx, {
      actorUserId: actor.id,
      action: 'order.status_changed',
      entityType: 'Order',
      entityId: order.id,
      before: { status: order.status, attempts: order.attempts },
      after: { status: to, attempts: isFailedAttempt ? order.attempts + 1 : order.attempts },
    });
  });
}

export async function addOrderNote(actor: SessionUser, orderId: string, note: string): Promise<void> {
  const order = await findOrderOrThrow(orderId);
  requireOrderView(actor, order);
  const parsed = NoteText.safeParse(note);
  if (!parsed.success) throw new AppError('invalid_input');
  await db.orderEvent.create({ data: { orderId: order.id, kind: 'note', note: parsed.data, actorUserId: actor.id } });
}

export async function getOrderTimeline(user: SessionUser, orderId: string): Promise<OrderTimelineEntry[]> {
  const order = await findOrderOrThrow(orderId);
  requireOrderView(user, order);
  return db.orderEvent.findMany({
    where: { orderId: order.id },
    orderBy: [{ at: 'asc' }, { id: 'asc' }],
    take: MAX_TIMELINE_ENTRIES,
    select: { kind: true, fromStatus: true, toStatus: true, reason: true, note: true, actorUserId: true, at: true },
  });
}
