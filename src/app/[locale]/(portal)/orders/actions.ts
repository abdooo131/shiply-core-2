'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/accounts';
import { routing, type Locale } from '@/i18n/routing';
import { cancelOrders } from '@/orders/merchant-order-actions';
import { parseOrderListQuery, toQueryString } from '@/orders/order-list';
import { deleteSavedView, saveView } from '@/orders/saved-views';
import { AppError } from '@/shared/app-error';

const KNOWN_ERRORS = new Set(['invalid_input', 'too_many_views', 'not_found', 'forbidden']);

export type ViewActionResult = { status: 'ok' } | { status: 'error'; errorKey: string };
export type CancelActionResult = { status: 'ok'; canceled: number; refused: number } | { status: 'error'; errorKey: string };

function toLocale(locale: string): Locale {
  return routing.locales.find((known) => known === locale) ?? routing.defaultLocale;
}

// Acts for the signed-in user's own merchant; the domain functions check 'orders' access again.
async function context(locale: string) {
  const user = await requireUser(toLocale(locale));
  const merchantId = user.memberships[0]?.merchantId;
  if (!merchantId) throw new AppError('forbidden', 403);
  return { user, merchantId };
}

function errorKeyOf(error: unknown): string {
  if (error instanceof AppError && KNOWN_ERRORS.has(error.code)) return error.code;
  console.error('Orders list action failed:', error instanceof Error ? error.name : 'unknown error');
  return 'unexpected';
}

// A view keeps the filters, tab, search and sort, never the page number; the text is stored canonical.
function canonicalViewQuery(queryString: string): string {
  const params = Object.fromEntries(new URLSearchParams(queryString));
  return toQueryString({ ...parseOrderListQuery(params), page: 1 });
}

export async function saveViewAction(locale: string, name: string, queryString: string): Promise<ViewActionResult> {
  try {
    const { user, merchantId } = await context(locale);
    if (typeof name !== 'string' || typeof queryString !== 'string') throw new AppError('invalid_input');
    await saveView(user, merchantId, name, canonicalViewQuery(queryString));
    revalidatePath(`/${toLocale(locale)}/orders`);
    return { status: 'ok' };
  } catch (error) {
    return { status: 'error', errorKey: errorKeyOf(error) };
  }
}

export async function deleteViewAction(locale: string, viewId: string): Promise<ViewActionResult> {
  try {
    const { user, merchantId } = await context(locale);
    if (typeof viewId !== 'string') throw new AppError('not_found', 404);
    await deleteSavedView(user, merchantId, viewId);
    revalidatePath(`/${toLocale(locale)}/orders`);
    return { status: 'ok' };
  } catch (error) {
    return { status: 'error', errorKey: errorKeyOf(error) };
  }
}

export async function cancelOrdersAction(locale: string, orderIds: string[]): Promise<CancelActionResult> {
  try {
    const { user, merchantId } = await context(locale);
    if (!Array.isArray(orderIds)) throw new AppError('invalid_input');
    const result = await cancelOrders(user, merchantId, orderIds);
    revalidatePath(`/${toLocale(locale)}/orders`);
    return { status: 'ok', canceled: result.canceled.length, refused: result.refused.length };
  } catch (error) {
    return { status: 'error', errorKey: errorKeyOf(error) };
  }
}
