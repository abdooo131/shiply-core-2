import type { Prisma } from '@prisma/client';
import { db } from '@/shared/db';

type StoredResult = { value: unknown };

// Runs `work` at most once per (scope, key). The key row is inserted in the same
// transaction as the work, so a concurrent second call blocks on the unique
// index until the first commits, then reads the stored result. If the first
// attempt fails, its transaction rolls back and the key is free to retry.
export async function runOnce<T>(
  key: string,
  scope: string,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return db.$transaction(async (tx) => {
    const inserted = await tx.$queryRaw<{ key: string }[]>`
      INSERT INTO "IdempotencyKey" ("scope", "key")
      VALUES (${scope}, ${key})
      ON CONFLICT DO NOTHING
      RETURNING "key"`;

    if (inserted.length === 0) {
      const existing = await tx.idempotencyKey.findUniqueOrThrow({
        where: { scope_key: { scope, key } },
      });
      return (existing.resultJson as StoredResult).value as T;
    }

    const value = await work(tx);
    const stored: StoredResult = { value: value ?? null };
    await tx.idempotencyKey.update({
      where: { scope_key: { scope, key } },
      data: { resultJson: stored as Prisma.InputJsonValue },
    });
    return value;
  });
}
