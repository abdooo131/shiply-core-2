import type { OrderStatus } from '@prisma/client';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SessionUser } from '@/accounts';
import { makeMerchant, makeSessionUser } from '@/merchants/merchants-test-fixtures';
import { LEDGER_ACCOUNTS, walletAccount } from '@/money';
import { addActiveBankAccount, deliverTestOrder } from '@/money/money-test-fixtures';
import { changeOrderStatus, createOrder } from '@/orders';
import { seedPricingDefaults } from '@/pricing/pricing-test-fixtures';
import { cairoDateString } from '@/shared/cairo-time';
import { db } from '@/shared/db';
import { resetTestDatabase } from '@/shared/test-db';
import { getMerchantAnalytics } from './merchant-analytics';

const MS_PER_DAY = 86_400_000;
const TO_OUT_FOR_DELIVERY: OrderStatus[] = ['picked_up', 'in_progress', 'out_for_delivery'];

let merchantId = '';
let owner: SessionUser;
let staff: SessionUser;
let nasrCityId = '';
let cairoGovernorate = '';
let keyCounter = 0;

beforeAll(async () => {
  const area = await db.area.findFirstOrThrow({ where: { nameEn: 'Nasr City' } });
  nasrCityId = area.id;
  cairoGovernorate = area.governorateCode;
});

beforeEach(async () => {
  await resetTestDatabase();
  await seedPricingDefaults();
  merchantId = (await makeMerchant()).id;
  owner = await makeSessionUser({ merchantId, access: 'full' });
  staff = await makeSessionUser({ staffRole: 'operations' });
});

async function newOrder(forMerchant = merchantId, by = owner, codAmountPiasters = 0) {
  const { id } = await createOrder(
    by,
    forMerchant,
    {
      type: 'deliver',
      customerName: 'Mona',
      customerMobile: '01001234567',
      addressText: '12 Abbas El Akkad St',
      areaId: nasrCityId,
      size: 'small',
      codAmountPiasters,
      allowOpenPackage: false,
      depositRequired: false,
      insuredValuePiasters: 0,
    },
    `analytics-${(keyCounter += 1)}`,
  );
  return id;
}

async function move(orderId: string, path: OrderStatus[], reason?: string) {
  for (const status of path) await changeOrderStatus(staff, orderId, status, status === 'attempt_failed' && reason ? { reason } : {});
}

// One failed attempt with a reason, then returned to the merchant.
async function returnAfterFailedAttempt(reason: string | undefined) {
  const id = await newOrder();
  await move(id, [...TO_OUT_FOR_DELIVERY, 'attempt_failed'], reason);
  await move(id, ['returning', 'returned']);
  return id;
}

// Delivered on the second try, after one failed attempt.
async function deliverOnSecondTry(reason: string) {
  const id = await newOrder(merchantId, owner, 50000);
  await move(id, [...TO_OUT_FOR_DELIVERY, 'attempt_failed'], reason);
  await move(id, ['out_for_delivery', 'delivered']);
  return id;
}

describe('merchant analytics', () => {
  it('shows calm zeros and nulls for a merchant with no completed orders', async () => {
    await newOrder();
    const result = await getMerchantAnalytics(owner, merchantId, { days: 30 });
    expect(result).toMatchObject({
      completedOrders: 0,
      deliveredCount: 0,
      notDeliveredCount: 0,
      successRate: null,
      averageDeliveryHours: null,
      attempts: { first: 0, second: 0, third: 0 },
      notDeliveredReasons: [],
      byGovernorate: [],
      cashOuts: [],
    });
    expect(result.moneyByDay).toHaveLength(30);
    expect(result.moneyByDay?.every((day) => day.cashCollectedPiasters === 0 && day.feesPiasters === 0 && day.netPiasters === 0)).toBe(true);
  });

  it('counts delivered and returned orders, the success rate, attempts, reasons and governorates', async () => {
    await deliverTestOrder(owner, staff, merchantId, 100000);
    await deliverTestOrder(owner, staff, merchantId, 0);
    await deliverOnSecondTry('customer_not_answering');
    await returnAfterFailedAttempt('customer_refused');
    await returnAfterFailedAttempt(undefined);
    await newOrder(); // not completed: left out

    const result = await getMerchantAnalytics(owner, merchantId, { days: 7 });
    expect(result.completedOrders).toBe(5);
    expect(result.deliveredCount).toBe(3);
    expect(result.notDeliveredCount).toBe(2);
    expect(result.successRate).toBeCloseTo(0.6);
    expect(result.averageDeliveryHours).not.toBeNull();
    expect(result.averageDeliveryHours).toBeGreaterThanOrEqual(0);
    expect(result.attempts.first).toBeCloseTo(2 / 3);
    expect(result.attempts.second).toBeCloseTo(1 / 3);
    expect(result.attempts.third).toBe(0);
    expect(result.notDeliveredReasons).toHaveLength(3);
    expect(result.notDeliveredReasons).toEqual(
      expect.arrayContaining([
        { reason: 'customer_not_answering', count: 1 },
        { reason: 'customer_refused', count: 1 },
        { reason: 'unspecified', count: 1 },
      ]),
    );
    expect(result.byGovernorate).toEqual([{ governorateCode: cairoGovernorate, orders: 5, delivered: 3 }]);
  });

  it('books cash collected, fees and net per Cairo day from the ledger', async () => {
    const deliveredId = await deliverTestOrder(owner, staff, merchantId, 100000);
    const returnedId = await returnAfterFailedAttempt('wrong_address');
    const orders = await db.order.findMany({ where: { id: { in: [deliveredId, returnedId] } } });
    const deliveredFee = orders.find((order) => order.id === deliveredId)?.totalFeePiasters ?? 0;

    const result = await getMerchantAnalytics(owner, merchantId, { days: 7 });
    const today = result.moneyByDay?.find((day) => day.date === cairoDateString(new Date()));
    expect(today?.cashCollectedPiasters).toBe(100000);
    // Wallet lines are the source of truth for net; fees are cash minus net.
    const walletLines = await db.ledgerLine.aggregate({ where: { accountCode: walletAccount(merchantId) }, _sum: { amountPiasters: true } });
    const netPiasters = -(walletLines._sum.amountPiasters ?? 0);
    expect(today?.netPiasters).toBe(netPiasters);
    expect(today?.feesPiasters).toBe(100000 - netPiasters);
    expect(today?.feesPiasters).toBeGreaterThan(deliveredFee);
    expect(result.moneyByDay).toHaveLength(7);
    expect(result.moneyByDay?.at(-1)?.date).toBe(cairoDateString(new Date()));
  });

  it('lists paid cash-outs in the period only', async () => {
    const bank = await addActiveBankAccount(merchantId, owner.id);
    const now = new Date();
    const base = { merchantId, bankAccountId: bank.id, scheduledDate: new Date(`${cairoDateString(now)}T00:00:00Z`), preparedBy: owner.id };
    await db.cashOut.createMany({
      data: [
        { ...base, number: 'CO-000001', amountPiasters: 50000, status: 'paid', paidAt: new Date(now.getTime() - MS_PER_DAY) },
        { ...base, number: 'CO-000002', amountPiasters: 70000, status: 'paid', paidAt: new Date(now.getTime() - 40 * MS_PER_DAY) },
        { ...base, number: 'CO-000003', amountPiasters: 90000, status: 'approved' },
      ],
    });
    const result = await getMerchantAnalytics(owner, merchantId, { days: 30 });
    expect(result.cashOuts?.map((cashOut) => [cashOut.number, cashOut.amountPiasters])).toEqual([['CO-000001', 50000]]);
  });

  it('uses Cairo day boundaries for the period', async () => {
    // 18 Nov 2026 is winter time in Cairo (UTC+2). A 7-day period starts 12 Nov 00:00 Cairo = 11 Nov 22:00 UTC.
    const now = new Date('2026-11-18T10:00:00Z');
    const periodStart = new Date('2026-11-11T22:00:00Z');
    const justBefore = new Date(periodStart.getTime() - 1);
    const inside = await newOrder();
    const outside = await newOrder();
    await db.orderEvent.createMany({
      data: [
        { orderId: inside, kind: 'status_changed', fromStatus: 'out_for_delivery', toStatus: 'delivered', at: periodStart },
        { orderId: outside, kind: 'status_changed', fromStatus: 'out_for_delivery', toStatus: 'delivered', at: justBefore },
      ],
    });
    const lines = [
      { accountCode: LEDGER_ACCOUNTS.cashInTransit, amountPiasters: 10000 },
      { accountCode: walletAccount(merchantId), amountPiasters: -9000 },
      { accountCode: LEDGER_ACCOUNTS.revenueShipping, amountPiasters: -1000 },
    ];
    await db.ledgerAccount.createMany({
      data: [
        { code: LEDGER_ACCOUNTS.cashInTransit, kind: 'asset' },
        { code: walletAccount(merchantId), kind: 'liability' },
        { code: LEDGER_ACCOUNTS.revenueShipping, kind: 'revenue' },
      ],
      skipDuplicates: true,
    });
    // 22:30 UTC on 11 Nov is 00:30 on 12 Nov in Cairo: the first day of the period.
    await db.ledgerEntry.create({
      data: { idempotencyKey: 'boundary-entry', reason: 'order_delivered', orderId: inside, merchantId, postedAt: new Date('2026-11-11T22:30:00Z'), lines: { create: lines } },
    });

    const result = await getMerchantAnalytics(owner, merchantId, { days: 7 }, now);
    expect(result.period.from).toEqual(periodStart);
    expect(result.deliveredCount).toBe(1);
    expect(result.moneyByDay?.[0]).toEqual({ date: '2026-11-12', cashCollectedPiasters: 10000, feesPiasters: 1000, netPiasters: 9000 });
    expect(result.moneyByDay?.at(-1)?.date).toBe('2026-11-18');
  });

  it("leaves out another merchant's orders and money", async () => {
    const otherId = (await makeMerchant('Other Shop', 'محل تاني')).id;
    const otherOwner = await makeSessionUser({ merchantId: otherId, access: 'full' });
    await deliverTestOrder(otherOwner, staff, otherId, 100000);
    const result = await getMerchantAnalytics(owner, merchantId, { days: 30 });
    expect(result.completedOrders).toBe(0);
    expect(result.moneyByDay?.some((day) => day.cashCollectedPiasters !== 0)).toBe(false);
  });

  it('needs orders access, and shows money only with finance access too', async () => {
    const ordersOnly = await makeSessionUser({ merchantId, access: 'orders_pickups' });
    const financeOnly = await makeSessionUser({ merchantId, access: 'finance' });
    const stranger = await makeSessionUser({});

    const limited = await getMerchantAnalytics(ordersOnly, merchantId, { days: 30 });
    expect(limited.moneyByDay).toBeNull();
    expect(limited.cashOuts).toBeNull();
    await expect(getMerchantAnalytics(financeOnly, merchantId, { days: 30 })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(getMerchantAnalytics(stranger, merchantId, { days: 30 })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('accepts only 7, 30 or 90 days', async () => {
    await expect(getMerchantAnalytics(owner, merchantId, { days: 14 as 7 })).rejects.toMatchObject({ code: 'invalid_input' });
  });
});
