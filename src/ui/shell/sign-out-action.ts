'use server';

import { redirect } from 'next/navigation';
import { clearSessionCookie, readSessionToken, revokeSession } from '@/accounts';
import { routing } from '@/i18n/routing';

export async function signOutAction(locale: string): Promise<void> {
  const sessionToken = await readSessionToken();
  if (sessionToken) await revokeSession(sessionToken);
  await clearSessionCookie();
  const safeLocale = routing.locales.find((known) => known === locale) ?? routing.defaultLocale;
  redirect(`/${safeLocale}/login`);
}
