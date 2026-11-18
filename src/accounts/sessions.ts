import { createHash, randomBytes } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { writeAudit } from '@/platform/audit-log';
import { AppError } from '@/shared/app-error';
import { db } from '@/shared/db';
import { hashPassword, MIN_PASSWORD_LENGTH, verifyPassword } from './password';

export const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
const SESSION_TOKEN_BYTES = 32;

export type MerchantAccess = 'full' | 'orders_pickups' | 'finance';

export type SessionUser = {
  id: string;
  name: string;
  language: 'en' | 'ar';
  staffRoles: string[];
  memberships: { merchantId: string; access: MerchantAccess }[];
};

export function hashSessionToken(sessionToken: string): string {
  return createHash('sha256').update(sessionToken).digest('hex');
}

// Only the hash is stored, so a leaked database copy cannot be used to sign in.
export async function createSession(
  tx: Prisma.TransactionClient,
  userId: string,
  userAgent: string,
): Promise<string> {
  const sessionToken = randomBytes(SESSION_TOKEN_BYTES).toString('base64url');
  await tx.session.create({
    data: {
      userId,
      tokenHash: hashSessionToken(sessionToken),
      expiresAt: new Date(Date.now() + SESSION_LIFETIME_MS),
      userAgent: userAgent.slice(0, 255),
    },
  });
  return sessionToken;
}

export async function getSessionUser(sessionToken: string): Promise<SessionUser | null> {
  const session = await db.session.findUnique({
    where: { tokenHash: hashSessionToken(sessionToken) },
    include: {
      user: {
        include: {
          staffRoles: true,
          memberships: { where: { status: 'active' } },
        },
      },
    },
  });
  if (!session || session.revokedAt || session.expiresAt <= new Date()) return null;

  const { user } = session;
  if (user.status !== 'active') return null;

  return {
    id: user.id,
    name: user.name,
    language: user.language,
    staffRoles: user.staffRoles.map((staffRole) => staffRole.role),
    memberships: user.memberships.map((member) => ({ merchantId: member.merchantId, access: member.access })),
  };
}

export async function revokeSession(sessionToken: string): Promise<void> {
  await db.session.updateMany({
    where: { tokenHash: hashSessionToken(sessionToken), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

// Signs out every other device, so a stolen session dies with the old password.
export async function changePassword(
  userId: string,
  currentPassword: string,
  nextPassword: string,
  keepSessionToken: string,
): Promise<void> {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  if (!(await verifyPassword(user.passwordHash, currentPassword))) {
    throw new AppError('invalid_credentials', 401);
  }
  if (nextPassword.length < MIN_PASSWORD_LENGTH) throw new AppError('weak_password');

  const passwordHash = await hashPassword(nextPassword);
  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { passwordHash } });
    await tx.session.updateMany({
      where: { userId, revokedAt: null, tokenHash: { not: hashSessionToken(keepSessionToken) } },
      data: { revokedAt: new Date() },
    });
    await writeAudit(tx, {
      actorUserId: userId,
      action: 'auth.password_changed',
      entityType: 'User',
      entityId: userId,
      before: null,
      after: null,
    });
  });
}
