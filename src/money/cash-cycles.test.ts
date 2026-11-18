import { beforeEach, describe, expect, it } from 'vitest';
import type { SessionUser } from '@/accounts';
import { makeMerchant, makeSessionUser } from '@/merchants/merchants-test-fixtures';
import { seedPricingDefaults } from '@/pricing/pricing-test-fixtures';
import { cairoDateString } from '@/shared/cairo-time';
import { db } from '@/shared/db';
import { resetTestDatabase } from '@/shared/test-db';
import { closeCashCycles, listCashCycles } from './cash-cycles';
import { deliverTestOrder } from './money-test-fixtures';

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

describe('cash cycles', () => {
  it('closes today’s delivered orders into one cycle per merchant with cash, fees and net', async () => {
    await deliverTestOrder(owner, staff, merchantId, 150000);
    await deliverTestOrder(owner, staff, merchantId, 0);
    const today = cairoDateString(new Date());
    expect(await closeCashCycles(today)).toEqual({ closed: 1 });
    const [cycle] = await listCashCycles(owner, merchantId, { page: 1 }).then((result) => result.cycles);
    expect(cycle).toMatchObject({ cashCollectedPiasters: 150000, feesPiasters: 7752 * 2, netPiasters: 150000 - 7752 * 2, orderCount: 2 });
  });

  it('is safe to run twice, and even at the same moment', async () => {
    await deliverTestOrder(owner, staff, merchantId, 150000);
    const today = cairoDateString(new Date());
    await Promise.all([closeCashCycles(today), closeCashCycles(today)]);
    await closeCashCycles(today);
    expect(await db.cashCycle.count()).toBe(1);
    expect(await db.cashCycleEntry.count()).toBe(1);
  });

  it('only takes entries from that Cairo day and keeps merchants apart', async () => {
    const other = (await makeMerchant('Other', 'آخر')).id;
    const otherOwner = await makeSessionUser({ merchantId: other, access: 'full' });
    await deliverTestOrder(owner, staff, merchantId, 100000);
    await deliverTestOrder(otherOwner, staff, other, 200000);
    const yesterday = cairoDateString(new Date(Date.now() - 24 * 60 * 60 * 1000));
    expect(await closeCashCycles(yesterday)).toEqual({ closed: 0 });
    expect(await closeCashCycles(cairoDateString(new Date()))).toEqual({ closed: 2 });
    const mine = await listCashCycles(owner, merchantId, { page: 1 });
    expect(mine.cycles.map((cycle) => cycle.cashCollectedPiasters)).toEqual([100000]);
  });

  it('refuses a malformed date and shows cycles only to finance or full access', async () => {
    await expect(closeCashCycles('18-11-2026')).rejects.toMatchObject({ code: 'invalid_input' });
    const ops = await makeSessionUser({ merchantId, access: 'orders_pickups' });
    await expect(listCashCycles(ops, merchantId, { page: 1 })).rejects.toMatchObject({ code: 'forbidden' });
  });
});
