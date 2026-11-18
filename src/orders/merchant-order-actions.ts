import type { OrderStatus } from '@prisma/client';
import { z } from 'zod';
import { requireMerchantAccess, type SessionUser } from '@/accounts';
import { AppError } from '@/shared/app-error';
import { db } from '@/shared/db';
import { changeOrderStatus } from './order-status';

const MAX_BULK_CANCEL = 200;
const MAX_ANSWER_NOTE_LENGTH = 500;
const MERCHANT_CANCEL_REASON = 'merchant_canceled';

const BulkOrderIds = z.array(z.string().max(100)).min(1).max(MAX_BULK_CANCEL);
const OrderId = z.string().uuid();
const AwaitingAnswer = z.object({
  orderId: z.string(),
  choice: z.enum(['deliver_again', 'return']),
  note: z.string().trim().min(1).max(MAX_ANSWER_NOTE_LENGTH),
});

const STATUS_FOR_CHOICE: Record<'deliver_again' | 'return', OrderStatus> = {
  deliver_again: 'in_progress',
  return: 'returning',
};

export type CancelRefusal = { number: string; reason: 'not_cancellable' | 'not_found' };
export type CancelOrdersResult = { canceled: string[]; refused: CancelRefusal[] };

// The status rules already refused this move; for the merchant it simply is not allowed now.
function isRefusedTransition(error: unknown): boolean {
  return error instanceof AppError && (error.code === 'invalid_transition' || error.code === 'forbidden');
}

export async function cancelOrders(user: SessionUser, merchantId: string, orderIds: string[]): Promise<CancelOrdersResult> {
  requireMerchantAccess(user, merchantId, 'orders');
  const parsed = BulkOrderIds.safeParse(orderIds);
  if (!parsed.success) throw new AppError('invalid_input');

  const uniqueIds = [...new Set(parsed.data)];
  const validIds = uniqueIds.filter((id) => OrderId.safeParse(id).success);
  const ownOrders = await db.order.findMany({ where: { id: { in: validIds }, merchantId }, select: { id: true, number: true } });
  const numberById = new Map(ownOrders.map((order) => [order.id, order.number]));

  const result: CancelOrdersResult = { canceled: [], refused: [] };
  for (const id of uniqueIds) {
    const number = numberById.get(id);
    // Another merchant's order is never touched, and its number is never revealed.
    if (!number) {
      result.refused.push({ number: id, reason: 'not_found' });
      continue;
    }
    try {
      // One status change per order on purpose: each goes through the same checked, audited path.
      await changeOrderStatus(user, id, 'canceled', { reason: MERCHANT_CANCEL_REASON });
      result.canceled.push(number);
    } catch (error) {
      if (!isRefusedTransition(error)) throw error;
      result.refused.push({ number, reason: 'not_cancellable' });
    }
  }
  return result;
}

export async function answerAwaitingAction(
  user: SessionUser,
  merchantId: string,
  orderId: string,
  choice: 'deliver_again' | 'return',
  note: string,
): Promise<void> {
  requireMerchantAccess(user, merchantId, 'orders');
  const parsed = AwaitingAnswer.safeParse({ orderId, choice, note });
  if (!parsed.success) throw new AppError('invalid_input');
  if (!OrderId.safeParse(orderId).success) throw new AppError('not_found', 404);

  const order = await db.order.findFirst({ where: { id: orderId, merchantId }, select: { id: true } });
  if (!order) throw new AppError('not_found', 404);

  try {
    await changeOrderStatus(user, order.id, STATUS_FOR_CHOICE[parsed.data.choice], { note: parsed.data.note });
  } catch (error) {
    if (isRefusedTransition(error)) throw new AppError('invalid_transition', 409);
    throw error;
  }
}
