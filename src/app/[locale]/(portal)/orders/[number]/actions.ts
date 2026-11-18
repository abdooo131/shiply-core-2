'use server';

import { requireUser } from '@/accounts';
import { routing, type Locale } from '@/i18n/routing';
import { addOrderNote } from '@/orders';
import { answerAwaitingAction, cancelOrders } from '@/orders/merchant-order-actions';
import { AppError } from '@/shared/app-error';

const KNOWN_ERRORS = new Set(['invalid_input', 'invalid_transition', 'not_found', 'forbidden']);

export type OrderActionResult = { ok: true } | { errorKey: string };

function toLocale(locale: string): Locale {
  return routing.locales.find((known) => known === locale) ?? routing.defaultLocale;
}

async function context(locale: string) {
  const user = await requireUser(toLocale(locale));
  const merchantId = user.memberships[0]?.merchantId;
  if (!merchantId) throw new AppError('forbidden', 403);
  return { user, merchantId };
}

function errorResult(error: unknown): OrderActionResult {
  if (error instanceof AppError && KNOWN_ERRORS.has(error.code)) return { errorKey: error.code };
  console.error('Order page action failed:', error instanceof Error ? error.name : 'unknown error');
  return { errorKey: 'unexpected' };
}

export async function cancelOrderAction(locale: string, orderId: string): Promise<OrderActionResult> {
  try {
    const { user, merchantId } = await context(locale);
    const result = await cancelOrders(user, merchantId, [orderId]);
    const refusal = result.refused[0];
    if (refusal) return { errorKey: refusal.reason === 'not_found' ? 'not_found' : 'not_cancellable' };
    return { ok: true };
  } catch (error) {
    return errorResult(error);
  }
}

export async function answerAwaitingActionAction(
  locale: string,
  orderId: string,
  choice: 'deliver_again' | 'return',
  note: string,
): Promise<OrderActionResult> {
  try {
    const { user, merchantId } = await context(locale);
    await answerAwaitingAction(user, merchantId, orderId, choice, note);
    return { ok: true };
  } catch (error) {
    return errorResult(error);
  }
}

export async function addOrderNoteAction(locale: string, orderId: string, note: string): Promise<OrderActionResult> {
  try {
    const { user } = await context(locale);
    // addOrderNote checks that the caller may see this order's merchant.
    await addOrderNote(user, orderId, note);
    return { ok: true };
  } catch (error) {
    return errorResult(error);
  }
}
