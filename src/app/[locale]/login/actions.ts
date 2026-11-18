'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { setSessionCookie, signIn } from '@/accounts';
import { routing } from '@/i18n/routing';
import { AppError } from '@/shared/app-error';

export type SignInState = { errorKey: string | null; identifier: string };

const SignInInput = z.object({
  identifier: z.string().trim().min(1).max(200),
  password: z.string().min(1).max(200),
});

const KNOWN_ERRORS = new Set(['invalid_credentials', 'account_locked']);

export async function signInAction(locale: string, _previous: SignInState, formData: FormData): Promise<SignInState> {
  const parsed = SignInInput.safeParse({
    identifier: formData.get('identifier'),
    password: formData.get('password'),
  });
  const identifier = String(formData.get('identifier') ?? '');
  if (!parsed.success) return { errorKey: 'missing_fields', identifier };

  const userAgent = (await headers()).get('user-agent') ?? '';
  try {
    const { sessionToken } = await signIn(parsed.data.identifier, parsed.data.password, userAgent);
    await setSessionCookie(sessionToken);
  } catch (error) {
    if (error instanceof AppError && KNOWN_ERRORS.has(error.code)) return { errorKey: error.code, identifier };
    // Logged without the identifier or password: only what failed.
    console.error('Sign-in failed unexpectedly:', error instanceof Error ? error.name : 'unknown error');
    return { errorKey: 'unexpected', identifier };
  }

  const safeLocale = routing.locales.find((known) => known === locale) ?? routing.defaultLocale;
  redirect(`/${safeLocale}`);
}
