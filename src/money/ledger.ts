import type { Prisma } from '@prisma/client';
import { AppError } from '@/shared/app-error';
import { db } from '@/shared/db';

// Fixed accounts. Merchant wallets are per merchant (see walletAccount).
export const LEDGER_ACCOUNTS = {
  cashInTransit: 'cash_in_transit',
  bank: 'bank',
  revenueShipping: 'revenue_shipping',
  revenueFees: 'revenue_fees',
  revenueReturnFees: 'revenue_return_fees',
  vatPayable: 'vat_payable',
} as const;

const ACCOUNT_KIND: Record<string, string> = {
  cash_in_transit: 'asset',
  bank: 'asset',
  revenue_shipping: 'revenue',
  revenue_fees: 'revenue',
  revenue_return_fees: 'revenue',
  vat_payable: 'liability',
};
const WALLET_PREFIX = 'merchant_wallet:';
const MIN_LINES = 2;

// A merchant's wallet is a liability: a negative balance (credit) means Shiply owes the merchant.
export function walletAccount(merchantId: string): string {
  return `${WALLET_PREFIX}${merchantId}`;
}

function kindOf(account: string): string {
  if (account.startsWith(WALLET_PREFIX)) return 'liability';
  const kind = ACCOUNT_KIND[account];
  if (!kind) throw new Error(`Unknown ledger account "${account}".`);
  return kind;
}

export type LedgerLineInput = { account: string; amountPiasters: number };
export type PostEntryInput = {
  key: string;
  reason: string;
  orderId?: string;
  cashOutId?: string;
  merchantId?: string;
  lines: LedgerLineInput[];
};

// Posts a balanced entry once per key. Must run inside the caller's transaction so a
// booking and the change that caused it are saved together or not at all.
export async function postEntry(tx: Prisma.TransactionClient, input: PostEntryInput): Promise<{ id: string; isNew: boolean }> {
  const allWhole = input.lines.every((line) => Number.isSafeInteger(line.amountPiasters));
  const nonZeroLines = input.lines.filter((line) => line.amountPiasters !== 0);
  if (nonZeroLines.length < MIN_LINES || !allWhole) throw new AppError('invalid_input');
  const total = input.lines.reduce((sum, line) => sum + line.amountPiasters, 0);
  if (total !== 0) throw new AppError('unbalanced_entry', 500);

  await tx.ledgerAccount.createMany({
    data: [...new Set(input.lines.map((line) => line.account))].map((code) => ({ code, kind: kindOf(code) })),
    skipDuplicates: true,
  });

  // A concurrent post with the same key waits on the unique index, then finds this row.
  const inserted = await tx.$queryRaw<{ id: string }[]>`
    INSERT INTO "LedgerEntry" ("id", "idempotencyKey", "reason", "orderId", "cashOutId", "merchantId")
    VALUES (gen_random_uuid(), ${input.key}, ${input.reason}, ${input.orderId ?? null}::uuid, ${input.cashOutId ?? null}::uuid, ${input.merchantId ?? null}::uuid)
    ON CONFLICT ("idempotencyKey") DO NOTHING
    RETURNING "id"`;
  const created = inserted[0];
  if (!created) {
    const existing = await tx.ledgerEntry.findUniqueOrThrow({ where: { idempotencyKey: input.key }, select: { id: true } });
    return { id: existing.id, isNew: false };
  }
  await tx.ledgerLine.createMany({
    data: nonZeroLines.map((line) => ({ entryId: created.id, accountCode: line.account, amountPiasters: line.amountPiasters })),
  });
  return { id: created.id, isNew: true };
}

export async function accountBalance(account: string): Promise<number> {
  const result = await db.ledgerLine.aggregate({ where: { accountCode: account }, _sum: { amountPiasters: true } });
  return result._sum.amountPiasters ?? 0;
}
