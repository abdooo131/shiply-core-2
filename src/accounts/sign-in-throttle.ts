import { createHmac } from 'node:crypto';
import { AppError } from '@/shared/app-error';
import { db } from '@/shared/db';

// Failed sign-ins allowed from one network address within the window, across all accounts.
export const MAX_FAILED_ATTEMPTS_PER_ADDRESS = 20;
export const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;

// Keyed hash: an address cannot be recovered by hashing every possible IP.
function hashAddress(clientAddress: string): string {
  const key = process.env.SESSION_SECRET;
  if (!key) throw new Error('SESSION_SECRET is missing from .env.');
  return createHmac('sha256', key).update(clientAddress).digest('hex');
}

// Records the attempt before any password work, then counts. Rows from requests
// that arrive together are all counted, so a burst cannot slip past the limit.
// Returns the attempt id; the caller forgets it when the sign-in succeeds.
export async function recordAttempt(clientAddress: string): Promise<string> {
  const addressHash = hashAddress(clientAddress);
  const windowStart = new Date(Date.now() - ATTEMPT_WINDOW_MS);

  await db.signInAttempt.deleteMany({ where: { addressHash, at: { lt: windowStart } } });
  const attempt = await db.signInAttempt.create({ data: { addressHash }, select: { id: true } });
  const recent = await db.signInAttempt.count({ where: { addressHash, at: { gte: windowStart } } });
  if (recent > MAX_FAILED_ATTEMPTS_PER_ADDRESS) throw new AppError('too_many_attempts', 429);
  return attempt.id;
}

export async function forgetAttempt(attemptId: string): Promise<void> {
  await db.signInAttempt.deleteMany({ where: { id: attemptId } });
}
