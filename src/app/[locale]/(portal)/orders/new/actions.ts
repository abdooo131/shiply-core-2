'use server';

import { requireMerchantAccess, requireUser } from '@/accounts';
import { routing, type Locale } from '@/i18n/routing';
import { createOrder, findCustomerByMobile, pricingFor, type CreateOrderInput } from '@/orders';
import { quoteOrderFees, type FeeQuote } from '@/pricing';
import { AppError } from '@/shared/app-error';
import { db } from '@/shared/db';

const KNOWN_ERRORS = new Set([
  'invalid_input', 'invalid_mobile', 'area_not_found', 'area_not_served', 'price_missing', 'not_found', 'forbidden',
]);

function toLocale(locale: string): Locale {
  return routing.locales.find((known) => known === locale) ?? routing.defaultLocale;
}

async function context(locale: string) {
  const user = await requireUser(toLocale(locale));
  const merchantId = user.memberships[0]?.merchantId;
  if (!merchantId) throw new AppError('forbidden', 403);
  return { user, merchantId };
}

function errorKeyOf(error: unknown): string {
  if (error instanceof AppError && KNOWN_ERRORS.has(error.code)) return error.code;
  console.error('Create order action failed:', error instanceof Error ? error.name : 'unknown error');
  return 'unexpected';
}

export type QuoteResult = { quote: FeeQuote } | { errorKey: string };

export async function quoteAction(locale: string, input: CreateOrderInput): Promise<QuoteResult> {
  try {
    const { user, merchantId } = await context(locale);
    requireMerchantAccess(user, merchantId, 'orders');
    const pricing = pricingFor(input);
    const quote = await quoteOrderFees({
      merchantId,
      areaId: input.areaId,
      size: pricing.size,
      orderType: input.type,
      codAmountPiasters: pricing.money.codAmountPiasters,
      allowOpenPackage: pricing.allowOpenPackage,
      insuredValuePiasters: pricing.insuredValuePiasters,
    });
    return { quote };
  } catch (error) {
    return { errorKey: errorKeyOf(error) };
  }
}

export type CreateResult = { order: { id: string; number: string } } | { errorKey: string };

export async function createOrderAction(locale: string, input: CreateOrderInput, idempotencyKey: string): Promise<CreateResult> {
  try {
    const { user, merchantId } = await context(locale);
    return { order: await createOrder(user, merchantId, input, idempotencyKey) };
  } catch (error) {
    return { errorKey: errorKeyOf(error) };
  }
}

export type CustomerLookup = { name: string; addressText: string; areaId: string | null; areaLabel: string | null; orderCount: number } | null;

export async function lookupCustomerAction(locale: string, mobile: string): Promise<CustomerLookup> {
  const { user, merchantId } = await context(locale);
  const customer = await findCustomerByMobile(user, merchantId, mobile);
  if (!customer) return null;
  const area = customer.areaId
    ? await db.area.findUnique({ where: { id: customer.areaId }, select: { nameEn: true, nameAr: true } })
    : null;
  return { ...customer, areaLabel: area ? (toLocale(locale) === 'ar' ? area.nameAr : area.nameEn) : null };
}
