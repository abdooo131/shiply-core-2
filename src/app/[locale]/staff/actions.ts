'use server';

import { OrderStatus } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/accounts';
import { routing, type Locale } from '@/i18n/routing';
import { approveBankAccountChange } from '@/merchants/bank-account';
import { approveCashOut, cancelCashOut, closeCashCycles, markCashOutPaid, prepareCashOuts } from '@/money';
import { changeOrderStatus } from '@/orders';
import { markPickupCollected } from '@/pickups/pickups';
import { approvePriceList } from '@/pricing/price-lists';
import { AppError } from '@/shared/app-error';
import { requireSection, type StaffSection } from '@/staff/staff-queues';
import { replyAsStaff } from '@/support/tickets';

const KNOWN_ERRORS = new Set([
  'forbidden', 'not_found', 'invalid_input', 'invalid_transition', 'second_person_required', 'not_pending', 'not_prepared',
  'not_approved', 'not_cancellable', 'pickup_not_collectable', 'order_not_in_pickup', 'ticket_closed',
]);
const CairoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Id = z.string().uuid();

export type StaffActionResult = { status: 'ok' } | { status: 'error'; errorKey: string };
export type CloseCyclesResult = { status: 'ok'; closed: number } | { status: 'error'; errorKey: string };
export type PrepareResult = { status: 'ok'; created: number; skipped: number } | { status: 'error'; errorKey: string };

function toLocale(locale: string): Locale {
  return routing.locales.find((known) => known === locale) ?? routing.defaultLocale;
}

async function staffFor(locale: string, section: StaffSection) {
  const user = await requireUser(toLocale(locale));
  requireSection(user, section);
  return user;
}

function errorKeyOf(error: unknown): string {
  if (error instanceof AppError && KNOWN_ERRORS.has(error.code)) return error.code;
  if (error instanceof z.ZodError) return 'invalid_input';
  console.error('Staff action failed:', error instanceof Error ? error.name : 'unknown error');
  return 'unexpected';
}

function refresh(locale: string): void {
  revalidatePath(`/${toLocale(locale)}/staff`, 'layout');
}

async function run(locale: string, section: StaffSection, work: (user: Awaited<ReturnType<typeof requireUser>>) => Promise<void>): Promise<StaffActionResult> {
  try {
    const user = await staffFor(locale, section);
    await work(user);
    refresh(locale);
    return { status: 'ok' };
  } catch (error) {
    return { status: 'error', errorKey: errorKeyOf(error) };
  }
}

export async function moveOrderAction(locale: string, orderId: string, to: string, details: { reason?: string; note?: string }): Promise<StaffActionResult> {
  return run(locale, 'orders', async (user) => {
    const status = z.nativeEnum(OrderStatus).parse(to);
    await changeOrderStatus(user, Id.parse(orderId), status, { reason: details.reason || undefined, note: details.note || undefined });
  });
}

export async function markPickupCollectedAction(locale: string, pickupId: string, collectedOrderIds: string[]): Promise<StaffActionResult> {
  return run(locale, 'pickups', async (user) => {
    await markPickupCollected(user, Id.parse(pickupId), z.array(Id).parse(collectedOrderIds));
  });
}

export async function approveBankAccountAction(locale: string, bankAccountId: string): Promise<StaffActionResult> {
  return run(locale, 'approvals', (user) => approveBankAccountChange(user, Id.parse(bankAccountId)));
}

export async function approvePriceListAction(locale: string, priceListId: string): Promise<StaffActionResult> {
  return run(locale, 'approvals', (user) => approvePriceList(user, Id.parse(priceListId)));
}

export async function closeCashCyclesAction(locale: string, cairoDate: string): Promise<CloseCyclesResult> {
  try {
    await staffFor(locale, 'money');
    const result = await closeCashCycles(CairoDate.parse(cairoDate));
    refresh(locale);
    return { status: 'ok', closed: result.closed };
  } catch (error) {
    return { status: 'error', errorKey: errorKeyOf(error) };
  }
}

export async function prepareCashOutsAction(locale: string, cairoDate: string): Promise<PrepareResult> {
  try {
    const user = await staffFor(locale, 'money');
    const result = await prepareCashOuts(user, CairoDate.parse(cairoDate));
    refresh(locale);
    return { status: 'ok', created: result.created.length, skipped: result.skipped.length };
  } catch (error) {
    return { status: 'error', errorKey: errorKeyOf(error) };
  }
}

export async function approveCashOutAction(locale: string, cashOutId: string): Promise<StaffActionResult> {
  return run(locale, 'money', (user) => approveCashOut(user, Id.parse(cashOutId)));
}

export async function markCashOutPaidAction(locale: string, cashOutId: string, bankReference: string): Promise<StaffActionResult> {
  return run(locale, 'money', (user) => markCashOutPaid(user, Id.parse(cashOutId), { bankReference: String(bankReference) }));
}

export async function cancelCashOutAction(locale: string, cashOutId: string): Promise<StaffActionResult> {
  return run(locale, 'money', (user) => cancelCashOut(user, Id.parse(cashOutId)));
}

export async function replyToTicketAction(locale: string, ticketId: string, body: string, idempotencyKey: string): Promise<StaffActionResult> {
  return run(locale, 'support', (user) => replyAsStaff(user, Id.parse(ticketId), String(body), z.string().min(1).max(100).parse(idempotencyKey)));
}
