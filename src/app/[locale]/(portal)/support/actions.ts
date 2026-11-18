'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/accounts';
import { routing, type Locale } from '@/i18n/routing';
import { AppError } from '@/shared/app-error';
import { closeTicket, openTicket, replyAsMerchant, type OpenTicketInput } from '@/support/tickets';

const KNOWN_ERRORS = new Set(['invalid_input', 'not_found', 'ticket_closed', 'forbidden']);

export type SupportActionResult = { status: 'ok' } | { status: 'error'; errorKey: string };
export type OpenTicketResult = { status: 'ok'; number: string } | { status: 'error'; errorKey: string };

function toLocale(locale: string): Locale {
  return routing.locales.find((known) => known === locale) ?? routing.defaultLocale;
}

// Acts for the signed-in user's own merchant; the domain functions check membership again.
async function context(locale: string) {
  const user = await requireUser(toLocale(locale));
  const merchantId = user.memberships[0]?.merchantId;
  if (!merchantId) throw new AppError('forbidden', 403);
  return { user, merchantId };
}

function errorKeyOf(error: unknown): string {
  if (error instanceof AppError && KNOWN_ERRORS.has(error.code)) return error.code;
  console.error('Support action failed:', error instanceof Error ? error.name : 'unknown error');
  return 'unexpected';
}

function requireKey(idempotencyKey: unknown): string {
  if (typeof idempotencyKey !== 'string' || idempotencyKey.length === 0) throw new AppError('invalid_input');
  return idempotencyKey;
}

function refreshSupport(locale: string): void {
  revalidatePath(`/${toLocale(locale)}/support`, 'layout');
}

export async function openTicketAction(locale: string, input: OpenTicketInput, idempotencyKey: string): Promise<OpenTicketResult> {
  try {
    const { user, merchantId } = await context(locale);
    const result = await openTicket(user, merchantId, input, requireKey(idempotencyKey));
    refreshSupport(locale);
    return { status: 'ok', number: result.number };
  } catch (error) {
    return { status: 'error', errorKey: errorKeyOf(error) };
  }
}

export async function replyToTicketAction(locale: string, ticketId: string, body: string, idempotencyKey: string): Promise<SupportActionResult> {
  try {
    const { user, merchantId } = await context(locale);
    await replyAsMerchant(user, merchantId, String(ticketId), String(body), requireKey(idempotencyKey));
    refreshSupport(locale);
    return { status: 'ok' };
  } catch (error) {
    return { status: 'error', errorKey: errorKeyOf(error) };
  }
}

export async function closeTicketAction(locale: string, ticketId: string): Promise<SupportActionResult> {
  try {
    const { user, merchantId } = await context(locale);
    await closeTicket(user, merchantId, String(ticketId));
    refreshSupport(locale);
    return { status: 'ok' };
  } catch (error) {
    return { status: 'error', errorKey: errorKeyOf(error) };
  }
}
