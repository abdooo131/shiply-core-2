'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/accounts';
import { routing, type Locale } from '@/i18n/routing';
import { saveProduct, setProductActive } from '@/orders';
import { AppError } from '@/shared/app-error';
import { parseEgpToPiasters } from '@/shared/money';

export type ProductActionState = { status: 'idle' | 'ok' | 'error'; errorKey?: string; savedId?: string };

const KNOWN_ERRORS = new Set(['invalid_input', 'invalid_amount', 'not_found', 'forbidden']);

function toLocale(locale: string): Locale {
  return routing.locales.find((known) => known === locale) ?? routing.defaultLocale;
}

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
}

// Acts for the signed-in user's own merchant; the domain functions check 'orders' access again.
async function context(locale: string) {
  const user = await requireUser(toLocale(locale));
  const merchantId = user.memberships[0]?.merchantId;
  if (!merchantId) throw new AppError('forbidden', 403);
  return { user, merchantId };
}

function failure(error: unknown): ProductActionState {
  if (error instanceof AppError && KNOWN_ERRORS.has(error.code)) return { status: 'error', errorKey: error.code };
  console.error('Products action failed:', error instanceof Error ? error.name : 'unknown error');
  return { status: 'error', errorKey: 'unexpected' };
}

export async function saveProductAction(locale: string, _previous: ProductActionState, formData: FormData): Promise<ProductActionState> {
  try {
    const { user, merchantId } = await context(locale);
    const id = field(formData, 'id');
    const product = await saveProduct(user, merchantId, {
      id: id || undefined,
      nameEn: field(formData, 'nameEn'),
      nameAr: field(formData, 'nameAr'),
      pricePiasters: parseEgpToPiasters(field(formData, 'price')),
    });
    revalidatePath(`/${toLocale(locale)}/products`);
    return { status: 'ok', savedId: product.id };
  } catch (error) {
    return failure(error);
  }
}

export async function setProductActiveAction(locale: string, productId: string, isActive: boolean): Promise<ProductActionState> {
  try {
    const { user, merchantId } = await context(locale);
    await setProductActive(user, merchantId, productId, isActive);
    revalidatePath(`/${toLocale(locale)}/products`);
    return { status: 'ok' };
  } catch (error) {
    return failure(error);
  }
}
