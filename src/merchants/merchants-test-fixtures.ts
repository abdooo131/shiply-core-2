import { getSessionUser, type SessionUser } from '@/accounts/sessions';
import { createSession } from '@/accounts/sessions';
import { hashPassword } from '@/accounts/password';
import { db } from '@/shared/db';

let userCounter = 0;

// A signed-in user as the app sees it, built straight in the database.
export async function makeSessionUser(options: {
  merchantId?: string;
  access?: 'full' | 'orders_pickups' | 'finance';
  staffRole?: 'admin' | 'operations' | 'finance';
}): Promise<SessionUser> {
  userCounter += 1;
  const user = await db.user.create({
    data: { email: `person${userCounter}@example.test`, name: `Person ${userCounter}`, passwordHash: await hashPassword('x-password-1') },
  });
  if (options.merchantId && options.access) {
    await db.merchantMember.create({ data: { merchantId: options.merchantId, userId: user.id, access: options.access } });
  }
  if (options.staffRole) await db.staffRole.create({ data: { userId: user.id, role: options.staffRole } });
  const token = await db.$transaction((tx) => createSession(tx, user.id, 'vitest'));
  const sessionUser = await getSessionUser(token);
  if (!sessionUser) throw new Error('fixture user has no session');
  return sessionUser;
}

export async function makeMerchant(nameEn = 'Nile Threads', nameAr = 'نايل ثريدز') {
  return db.merchant.create({ data: { nameEn, nameAr } });
}

// A real, valid Egyptian IBAN (published example) and one with wrong check digits.
export const VALID_IBAN = 'EG380019000500000000263180002';
export const BAD_CHECK_DIGITS_IBAN = 'EG120019000500000000263180002';
