import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/shared/db';
import { resetTestDatabase } from '@/shared/test-db';
import { accountBalance, LEDGER_ACCOUNTS, postEntry, walletAccount } from './ledger';

const MERCHANT = '11111111-1111-1111-1111-111111111111';

describe('ledger', () => {
  beforeEach(resetTestDatabase);

  it('posts a balanced entry and sums balances from its lines', async () => {
    await db.$transaction((tx) =>
      postEntry(tx, {
        key: 'test:1',
        reason: 'order_delivered',
        merchantId: MERCHANT,
        lines: [
          { account: LEDGER_ACCOUNTS.cashInTransit, amountPiasters: 150000 },
          { account: walletAccount(MERCHANT), amountPiasters: -150000 },
        ],
      }),
    );
    expect(await accountBalance(LEDGER_ACCOUNTS.cashInTransit)).toBe(150000);
    expect(await accountBalance(walletAccount(MERCHANT))).toBe(-150000);
  });

  it('refuses an entry whose lines do not add up to zero, before writing anything', async () => {
    await expect(
      db.$transaction((tx) =>
        postEntry(tx, {
          key: 'test:2',
          reason: 'bad',
          lines: [
            { account: LEDGER_ACCOUNTS.bank, amountPiasters: 100 },
            { account: LEDGER_ACCOUNTS.revenueShipping, amountPiasters: -99 },
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: 'unbalanced_entry' });
    expect(await db.ledgerEntry.count()).toBe(0);
  });

  it('is protected by the database too: an unbalanced entry written by hand fails at commit', async () => {
    await db.ledgerAccount.createMany({ data: [{ code: 'bank', kind: 'asset' }, { code: 'revenue_shipping', kind: 'revenue' }] });
    await expect(
      db.$transaction(async (tx) => {
        const entry = await tx.ledgerEntry.create({ data: { idempotencyKey: 'raw:1', reason: 'raw' } });
        await tx.ledgerLine.createMany({
          data: [
            { entryId: entry.id, accountCode: 'bank', amountPiasters: 100 },
            { entryId: entry.id, accountCode: 'revenue_shipping', amountPiasters: -50 },
          ],
        });
      }),
    ).rejects.toThrow(/unbalanced_entry/);
    expect(await db.ledgerEntry.count()).toBe(0);
  });

  it('cannot be changed or deleted once posted', async () => {
    await db.$transaction((tx) =>
      postEntry(tx, {
        key: 'test:3',
        reason: 'r',
        lines: [
          { account: LEDGER_ACCOUNTS.bank, amountPiasters: 10 },
          { account: LEDGER_ACCOUNTS.revenueFees, amountPiasters: -10 },
        ],
      }),
    );
    await expect(db.$executeRaw`UPDATE "LedgerLine" SET "amountPiasters" = 0`).rejects.toThrow(/append_only/);
    await expect(db.$executeRaw`DELETE FROM "LedgerEntry"`).rejects.toThrow(/append_only/);
  });

  it('posts the same key once, even when sent twice at the same moment', async () => {
    const post = () =>
      db.$transaction((tx) =>
        postEntry(tx, {
          key: 'order:x:delivered',
          reason: 'order_delivered',
          lines: [
            { account: LEDGER_ACCOUNTS.cashInTransit, amountPiasters: 500 },
            { account: walletAccount(MERCHANT), amountPiasters: -500 },
          ],
        }),
      );
    const [first, second] = await Promise.allSettled([post(), post()]);
    const ids = [first, second].filter((result) => result.status === 'fulfilled').map((result) => (result as PromiseFulfilledResult<{ id: string }>).value.id);
    expect(new Set(ids).size).toBe(1);
    expect(await db.ledgerEntry.count()).toBe(1);
    expect(await accountBalance(walletAccount(MERCHANT))).toBe(-500);
  });

  it('refuses lines that are not whole piastres or an entry with fewer than two lines', async () => {
    for (const lines of [
      [{ account: LEDGER_ACCOUNTS.bank, amountPiasters: 0.5 }, { account: LEDGER_ACCOUNTS.revenueFees, amountPiasters: -0.5 }],
      [{ account: LEDGER_ACCOUNTS.bank, amountPiasters: 0 }],
      [{ account: LEDGER_ACCOUNTS.bank, amountPiasters: 0 }, { account: LEDGER_ACCOUNTS.revenueFees, amountPiasters: 0 }],
    ]) {
      await expect(db.$transaction((tx) => postEntry(tx, { key: `bad:${JSON.stringify(lines)}`, reason: 'r', lines }))).rejects.toMatchObject({ code: 'invalid_input' });
    }
  });
});
