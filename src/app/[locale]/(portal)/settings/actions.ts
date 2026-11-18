'use server';

import { revalidatePath } from 'next/cache';
import { changePassword, readSessionToken, requireUser, type MerchantAccess } from '@/accounts';
import { routing, type Locale } from '@/i18n/routing';
import {
  changeMemberAccess,
  deactivateMember,
  inviteMember,
  requestBankAccountChange,
  updateMerchantProfile,
} from '@/merchants';
import { AppError } from '@/shared/app-error';

export type ActionState = { status: 'idle' | 'ok' | 'error'; errorKey?: string; oneTimePassword?: string; invitedName?: string };

const KNOWN_ERRORS = new Set([
  'invalid_input', 'invalid_iban', 'invalid_mobile', 'account_exists', 'cannot_change_self',
  'forbidden', 'invalid_credentials', 'weak_password', 'not_found',
]);

function toLocale(locale: string): Locale {
  return routing.locales.find((known) => known === locale) ?? routing.defaultLocale;
}

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
}

// Every settings action acts for the signed-in user's own merchant; the domain
// functions check access again, so a forged form cannot reach another merchant.
async function context(locale: string) {
  const user = await requireUser(toLocale(locale));
  const merchantId = user.memberships[0]?.merchantId;
  if (!merchantId) throw new AppError('forbidden', 403);
  return { user, merchantId };
}

function failure(error: unknown): ActionState {
  if (error instanceof AppError && KNOWN_ERRORS.has(error.code)) return { status: 'error', errorKey: error.code };
  console.error('Settings action failed:', error instanceof Error ? error.name : 'unknown error');
  return { status: 'error', errorKey: 'unexpected' };
}

export async function updateBusinessAction(locale: string, _previous: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { user, merchantId } = await context(locale);
    await updateMerchantProfile(user, merchantId, {
      nameEn: field(formData, 'nameEn'),
      nameAr: field(formData, 'nameAr'),
      industry: field(formData, 'industry') || null,
      website: field(formData, 'website') || null,
    });
    revalidatePath(`/${toLocale(locale)}`, 'layout');
    return { status: 'ok' };
  } catch (error) {
    return failure(error);
  }
}

export async function inviteMemberAction(locale: string, _previous: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { user, merchantId } = await context(locale);
    const name = field(formData, 'name');
    const invite = await inviteMember(
      user,
      merchantId,
      {
        name,
        email: field(formData, 'email') || null,
        mobile: field(formData, 'mobile') || null,
        access: field(formData, 'access') as MerchantAccess,
      },
      field(formData, 'idempotencyKey'),
    );
    revalidatePath(`/${toLocale(locale)}/settings/team`);
    return { status: 'ok', oneTimePassword: invite.oneTimePassword ?? undefined, invitedName: name };
  } catch (error) {
    return failure(error);
  }
}

export async function changeAccessAction(locale: string, _previous: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { user, merchantId } = await context(locale);
    await changeMemberAccess(user, merchantId, field(formData, 'memberUserId'), field(formData, 'access') as MerchantAccess);
    revalidatePath(`/${toLocale(locale)}/settings/team`);
    return { status: 'ok' };
  } catch (error) {
    return failure(error);
  }
}

export async function removeMemberAction(locale: string, _previous: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { user, merchantId } = await context(locale);
    await deactivateMember(user, merchantId, field(formData, 'memberUserId'));
    revalidatePath(`/${toLocale(locale)}/settings/team`);
    return { status: 'ok' };
  } catch (error) {
    return failure(error);
  }
}

export async function requestBankChangeAction(locale: string, _previous: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { user, merchantId } = await context(locale);
    await requestBankAccountChange(
      user,
      merchantId,
      { bankName: field(formData, 'bankName'), holderName: field(formData, 'holderName'), iban: field(formData, 'iban') },
      field(formData, 'idempotencyKey'),
    );
    revalidatePath(`/${toLocale(locale)}/settings/payouts`);
    return { status: 'ok' };
  } catch (error) {
    return failure(error);
  }
}

export async function changePasswordAction(locale: string, _previous: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await requireUser(toLocale(locale));
    const sessionToken = (await readSessionToken()) ?? '';
    await changePassword(user.id, field(formData, 'currentPassword'), field(formData, 'newPassword'), sessionToken);
    return { status: 'ok' };
  } catch (error) {
    return failure(error);
  }
}
