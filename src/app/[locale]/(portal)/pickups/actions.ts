'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/accounts';
import { routing, type Locale } from '@/i18n/routing';
import {
  archivePickupLocation,
  savePickupLocation,
  setDefaultPickupLocation,
  type PickupLocationInput,
} from '@/pickups/locations';
import { cancelPickup, ratePickup, requestPickup, stopRepeating, type RequestPickupInput } from '@/pickups/pickups';
import { AppError } from '@/shared/app-error';

const KNOWN_ERRORS = new Set([
  'area_not_found', 'area_not_served', 'cannot_archive_default', 'invalid_pickup_date', 'no_scheduled_pickup',
  'pickup_not_cancellable', 'pickup_not_rateable', 'invalid_input', 'invalid_mobile', 'forbidden', 'not_found',
]);

export type PickupActionResult = { status: 'ok' } | { status: 'error'; errorKey: string };
export type RequestPickupResult = { status: 'ok'; number: string; attachedOrderCount: number } | { status: 'error'; errorKey: string };

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
  console.error('Pickups action failed:', error instanceof Error ? error.name : 'unknown error');
  return 'unexpected';
}

function refreshPickups(locale: string): void {
  revalidatePath(`/${toLocale(locale)}/pickups`);
}

async function runAction(locale: string, work: (user: Awaited<ReturnType<typeof context>>) => Promise<void>): Promise<PickupActionResult> {
  try {
    await work(await context(locale));
    refreshPickups(locale);
    return { status: 'ok' };
  } catch (error) {
    return { status: 'error', errorKey: errorKeyOf(error) };
  }
}

export async function requestPickupAction(locale: string, input: RequestPickupInput, idempotencyKey: string): Promise<RequestPickupResult> {
  try {
    const { user, merchantId } = await context(locale);
    if (typeof idempotencyKey !== 'string' || idempotencyKey.length === 0) throw new AppError('invalid_input');
    const result = await requestPickup(user, merchantId, input, idempotencyKey);
    refreshPickups(locale);
    return { status: 'ok', number: result.number, attachedOrderCount: result.attachedOrderCount };
  } catch (error) {
    return { status: 'error', errorKey: errorKeyOf(error) };
  }
}

export async function cancelPickupAction(locale: string, pickupId: string): Promise<PickupActionResult> {
  return runAction(locale, ({ user, merchantId }) => cancelPickup(user, merchantId, String(pickupId)));
}

export async function stopRepeatingAction(locale: string, pickupId: string): Promise<PickupActionResult> {
  return runAction(locale, ({ user, merchantId }) => stopRepeating(user, merchantId, String(pickupId)));
}

export async function ratePickupAction(locale: string, pickupId: string, input: { rating: number; comment?: string }): Promise<PickupActionResult> {
  return runAction(locale, ({ user, merchantId }) => ratePickup(user, merchantId, String(pickupId), input));
}

export async function savePickupLocationAction(locale: string, input: PickupLocationInput): Promise<PickupActionResult> {
  return runAction(locale, async ({ user, merchantId }) => {
    await savePickupLocation(user, merchantId, input);
  });
}

export async function setDefaultLocationAction(locale: string, locationId: string): Promise<PickupActionResult> {
  return runAction(locale, ({ user, merchantId }) => setDefaultPickupLocation(user, merchantId, String(locationId)));
}

export async function archiveLocationAction(locale: string, locationId: string): Promise<PickupActionResult> {
  return runAction(locale, ({ user, merchantId }) => archivePickupLocation(user, merchantId, String(locationId)));
}
