import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getSessionUser, SESSION_LIFETIME_MS, type SessionUser } from './sessions';

export const SESSION_COOKIE_NAME = 'shiply_session';

export async function setSessionCookie(sessionToken: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV !== 'development' && process.env.NODE_ENV !== 'test',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_LIFETIME_MS / 1000,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE_NAME);
}

export async function readSessionToken(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(SESSION_COOKIE_NAME)?.value ?? null;
}

// For pages and server actions: the signed-in user, or a redirect to sign-in.
export async function requireUser(locale: 'en' | 'ar'): Promise<SessionUser> {
  const sessionToken = await readSessionToken();
  const user = sessionToken ? await getSessionUser(sessionToken) : null;
  if (!user) redirect(`/${locale}/login`);
  return user;
}
