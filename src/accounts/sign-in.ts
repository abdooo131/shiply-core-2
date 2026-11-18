import type { User } from '@prisma/client';
import { writeAudit } from '@/platform/audit-log';
import { AppError } from '@/shared/app-error';
import { db } from '@/shared/db';
import { normalizeEgyptianMobile } from '@/shared/egyptian-mobile';
import { hashPassword, verifyPassword } from './password';
import { createSession, getSessionUser, type SessionUser } from './sessions';

const MAX_FAILED_SIGN_INS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

// Verifying against a throwaway hash keeps a wrong account as slow as a wrong
// password, so response time does not reveal which accounts exist.
const unknownAccountHash = hashPassword('unknown-account-placeholder');

type Identifier = { method: 'email'; email: string } | { method: 'mobile'; mobile: string } | null;

function parseIdentifier(raw: string): Identifier {
  const trimmed = raw.trim();
  if (trimmed.includes('@')) return { method: 'email', email: trimmed.toLowerCase() };
  try {
    return { method: 'mobile', mobile: normalizeEgyptianMobile(trimmed) };
  } catch {
    return null;
  }
}

async function findUser(identifier: Identifier): Promise<User | null> {
  if (!identifier) return null;
  return identifier.method === 'email'
    ? db.user.findUnique({ where: { email: identifier.email } })
    : db.user.findUnique({ where: { mobile: identifier.mobile } });
}

async function recordFailure(user: User | null, method: string): Promise<void> {
  await db.$transaction(async (tx) => {
    if (user) {
      const failedSignIns = user.failedSignIns + 1;
      const shouldLock = failedSignIns >= MAX_FAILED_SIGN_INS;
      await tx.user.update({
        where: { id: user.id },
        data: shouldLock
          ? { failedSignIns: 0, lockedUntil: new Date(Date.now() + LOCKOUT_MS) }
          : { failedSignIns },
      });
    }
    await writeAudit(tx, {
      actorUserId: user?.id ?? null,
      action: 'auth.sign_in_failed',
      entityType: 'User',
      entityId: user?.id ?? 'unknown',
      before: null,
      after: { method },
    });
  });
}

export async function signIn(
  identifierInput: string,
  password: string,
  userAgent: string,
): Promise<{ sessionToken: string; user: SessionUser }> {
  const identifier = parseIdentifier(identifierInput);
  const method = identifier?.method ?? 'unrecognised';
  const user = await findUser(identifier);

  if (user?.lockedUntil && user.lockedUntil > new Date()) {
    throw new AppError('account_locked', 423);
  }

  const passwordMatches = await verifyPassword(user?.passwordHash ?? (await unknownAccountHash), password);
  if (!user || !passwordMatches || user.status !== 'active') {
    await recordFailure(user, method);
    throw new AppError('invalid_credentials', 401);
  }

  const sessionToken = await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { failedSignIns: 0, lockedUntil: null } });
    await writeAudit(tx, {
      actorUserId: user.id,
      action: 'auth.sign_in',
      entityType: 'User',
      entityId: user.id,
      before: null,
      after: { method },
    });
    return createSession(tx, user.id, userAgent);
  });

  const sessionUser = await getSessionUser(sessionToken);
  if (!sessionUser) throw new Error('Session was created but could not be read back.');
  return { sessionToken, user: sessionUser };
}
