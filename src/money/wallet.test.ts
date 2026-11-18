import { beforeEach, describe, expect, it } from 'vitest';
import type { SessionUser } from '@/accounts';
import { makeMerchant, makeSessionUser } from '@/merchants/merchants-test-fixtures';
import { seedPricingDefaults } from '@/pricing/pricing-test-fixtures';
import { cairoDateString } from '@/shared/cairo-time';
import { resetTestDatabase } from '@/shared/test-db';
import { closeCashCycles } from './cash-cycles';
import { approveCashOut, markCashOutPaid, prepareCashOuts } from './cash-outs';
import { addActiveBankAccount, deliverTestOrder } from './money-test-fixtures';
import { getWalletSummary, listWalletTransactions } from './wallet';

let merchantId = '';
let owner: SessionUser;
let staff: SessionUser;

beforeEach(async () => {
  await resetTestDatabase();
  await seedPricingDefaults();
  merchantId = (await makeMerchant()).id;
  owner = await makeSessionUser({ merchantId, access: 'full' });
  staff = await makeSessionUser({ staffRole: 'operations' });
});

describe('wallet', () => {
  it('shows today’s orders as processing until the cycle closes, then as in the next cash-out', async () => {
    await deliverTestOrder(owner, staff, merchantId, 150000);
    expect(await getWalletSummary(owner, merchantId)).toMatchObject({ balancePiasters: 142248, processingPiasters: 142248, inNextCashOutPiasters: 0 });
    await closeCashCycles(cairoDateString(new Date()));
    expect(await getWalletSummary(owner, merchantId)).toMatchObject({ balancePiasters: 142248, processingPiasters: 0, inNextCashOutPiasters: 142248 });
  });

  it('drops to zero after the cash-out is paid and lists every movement newest first', async () => {
    await addActiveBankAccount(merchantId, owner.id);
    await deliverTestOrder(owner, staff, merchantId, 150000);
    await closeCashCycles(cairoDateString(new Date()));
    const preparer = await makeSessionUser({ staffRole: 'finance' });
    const approver = await makeSessionUser({ staffRole: 'finance' });
    const [cashOut] = (await prepareCashOuts(preparer, '2026-11-23')).created;
    await approveCashOut(approver, cashOut?.id ?? '');
    await markCashOutPaid(preparer, cashOut?.id ?? '', { bankReference: 'NBE-1' });

    expect(await getWalletSummary(owner, merchantId)).toMatchObject({ balancePiasters: 0, inNextCashOutPiasters: 0 });
    const { transactions } = await listWalletTransactions(owner, merchantId, { page: 1 });
    expect(transactions.map((transaction) => [transaction.reason, transaction.amountPiasters])).toEqual([
      ['cash_out_paid', -142248],
      ['order_delivered', 142248],
    ]);
    expect(transactions[1]?.orderNumber).toMatch(/^\d{10}$/);
  });

  it('shows a negative balance when fees are more than cash', async () => {
    await deliverTestOrder(owner, staff, merchantId, 0);
    expect((await getWalletSummary(owner, merchantId)).balancePiasters).toBe(-7752);
  });

  it('is only for finance or full access', async () => {
    const ops = await makeSessionUser({ merchantId, access: 'orders_pickups' });
    await expect(getWalletSummary(ops, merchantId)).rejects.toMatchObject({ code: 'forbidden' });
  });
});
