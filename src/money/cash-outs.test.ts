import { beforeEach, describe, expect, it } from 'vitest';
import type { SessionUser } from '@/accounts';
import { makeMerchant, makeSessionUser } from '@/merchants/merchants-test-fixtures';
import { seedPricingDefaults } from '@/pricing/pricing-test-fixtures';
import { cairoDateString } from '@/shared/cairo-time';
import { db } from '@/shared/db';
import { resetTestDatabase } from '@/shared/test-db';
import { closeCashCycles } from './cash-cycles';
import {
  approveCashOut,
  cancelCashOut,
  getTransferProof,
  isCashOutDay,
  listCashOuts,
  markCashOutPaid,
  prepareCashOuts,
} from './cash-outs';
import { accountBalance, LEDGER_ACCOUNTS, walletAccount } from './ledger';
import { addActiveBankAccount, deliverTestOrder } from './money-test-fixtures';

// 2026-11-23 is a Monday; 2026-11-25 a Wednesday; 2026-11-27 a Friday.
const MONDAY = '2026-11-23';

let merchantId = '';
let owner: SessionUser;
let staff: SessionUser;
let preparer: SessionUser;
let approver: SessionUser;

async function earnCycle(codAmountPiasters: number) {
  await deliverTestOrder(owner, staff, merchantId, codAmountPiasters);
  await closeCashCycles(cairoDateString(new Date()));
}

beforeEach(async () => {
  await resetTestDatabase();
  await seedPricingDefaults();
  merchantId = (await makeMerchant()).id;
  owner = await makeSessionUser({ merchantId, access: 'full' });
  staff = await makeSessionUser({ staffRole: 'operations' });
  preparer = await makeSessionUser({ staffRole: 'finance' });
  approver = await makeSessionUser({ staffRole: 'finance' });
  await addActiveBankAccount(merchantId, owner.id);
});

describe('cash-out days', () => {
  it('follows the merchant schedule', () => {
    expect(isCashOutDay('weekly', MONDAY)).toBe(true);
    expect(isCashOutDay('weekly', '2026-11-25')).toBe(false);
    expect(isCashOutDay('twice_weekly', '2026-11-25')).toBe(true);
    expect(isCashOutDay('twice_weekly', '2026-11-24')).toBe(false);
    expect(isCashOutDay('daily', '2026-11-24')).toBe(true);
    expect(isCashOutDay('daily', '2026-11-27')).toBe(false);
  });
});

describe('cash-outs', () => {
  it('prepares, approves by a second person, pays once with a reference, and books it', async () => {
    await earnCycle(150000);
    const prepared = await prepareCashOuts(preparer, MONDAY);
    expect(prepared.created).toHaveLength(1);
    const cashOut = prepared.created[0];
    expect(cashOut?.amountPiasters).toBe(150000 - 7752);

    await expect(approveCashOut(preparer, cashOut?.id ?? '')).rejects.toMatchObject({ code: 'second_person_required' });
    await approveCashOut(approver, cashOut?.id ?? '');
    const results = await Promise.allSettled([
      markCashOutPaid(preparer, cashOut?.id ?? '', { bankReference: 'NBE-778812' }),
      markCashOutPaid(approver, cashOut?.id ?? '', { bankReference: 'NBE-778812' }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);

    expect(await accountBalance(walletAccount(merchantId))).toBe(0);
    expect(await accountBalance(LEDGER_ACCOUNTS.bank)).toBe(-(150000 - 7752));
    const proof = await getTransferProof(owner, merchantId, cashOut?.id ?? '');
    expect(proof).toMatchObject({ amountPiasters: 150000 - 7752, bankReference: 'NBE-778812', maskedIban: 'EG•• •••• ••0002', cycleCount: 1 });
  });

  it('does not prepare twice for the same day, and skips merchants with nothing to pay or no bank account', async () => {
    await earnCycle(150000);
    await prepareCashOuts(preparer, MONDAY);
    expect((await prepareCashOuts(preparer, MONDAY)).created).toHaveLength(0);

    const noBank = (await makeMerchant('No Bank', 'بدون بنك')).id;
    const noBankOwner = await makeSessionUser({ merchantId: noBank, access: 'full' });
    await deliverTestOrder(noBankOwner, staff, noBank, 100000);
    await closeCashCycles(cairoDateString(new Date()));
    const result = await prepareCashOuts(preparer, MONDAY);
    expect(result.skipped).toContainEqual({ merchantId: noBank, reason: 'no_bank_account' });
  });

  it('pays nothing when fees are more than the cash, and shows the balance owed', async () => {
    await earnCycle(0);
    const result = await prepareCashOuts(preparer, MONDAY);
    expect(result.created).toHaveLength(0);
    expect(result.skipped).toContainEqual({ merchantId, reason: 'nothing_to_pay' });
  });

  it('can be canceled before payment, releasing its cycles for the next cash-out', async () => {
    await earnCycle(150000);
    const [cashOut] = (await prepareCashOuts(preparer, MONDAY)).created;
    await cancelCashOut(preparer, cashOut?.id ?? '');
    expect(await db.cashCycle.count({ where: { cashOutId: { not: null } } })).toBe(0);
    expect((await prepareCashOuts(preparer, '2026-11-30')).created).toHaveLength(1);
    await expect(markCashOutPaid(approver, cashOut?.id ?? '', { bankReference: 'X-1' })).rejects.toMatchObject({ code: 'not_approved' });
  });

  it('is limited to Shiply finance and shows each merchant only its own cash-outs', async () => {
    await expect(prepareCashOuts(staff, MONDAY)).rejects.toMatchObject({ code: 'forbidden' });
    await earnCycle(150000);
    const [cashOut] = (await prepareCashOuts(preparer, MONDAY)).created;
    expect(await listCashOuts(owner, merchantId)).toHaveLength(1);
    const other = (await makeMerchant('Other', 'آخر')).id;
    const otherOwner = await makeSessionUser({ merchantId: other, access: 'full' });
    await expect(getTransferProof(otherOwner, other, cashOut?.id ?? '')).rejects.toMatchObject({ code: 'not_found' });
  });

  it('refuses a missing or too short bank reference', async () => {
    await earnCycle(150000);
    const [cashOut] = (await prepareCashOuts(preparer, MONDAY)).created;
    await approveCashOut(approver, cashOut?.id ?? '');
    await expect(markCashOutPaid(preparer, cashOut?.id ?? '', { bankReference: ' ' })).rejects.toMatchObject({ code: 'invalid_input' });
  });
});
