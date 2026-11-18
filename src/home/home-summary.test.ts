import type { OrderStatus } from '@prisma/client';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SessionUser } from '@/accounts';
import { makeMerchant, makeSessionUser } from '@/merchants/merchants-test-fixtures';
import { changeOrderStatus, createOrder } from '@/orders';
import { seedPricingDefaults } from '@/pricing/pricing-test-fixtures';
import { db } from '@/shared/db';
import { resetTestDatabase } from '@/shared/test-db';
import { getHomeSummary } from './home-summary';

// 10:00 in Cairo (UTC+2 in November) on 18 Nov 2026.
const NOW = new Date('2026-11-18T08:00:00Z');
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

let nasrCityId = '';
let merchantId = '';
let owner: SessionUser;
let staff: SessionUser;
let keyCounter = 0;

beforeAll(async () => {
  nasrCityId = (await db.area.findFirstOrThrow({ where: { nameEn: 'Nasr City' } })).id;
});

beforeEach(async () => {
  await resetTestDatabase();
  await seedPricingDefaults();
  merchantId = (await makeMerchant()).id;
  owner = await makeSessionUser({ merchantId, access: 'full' });
  staff = await makeSessionUser({ staffRole: 'operations' });
});

async function makeOrder(forMerchantId = merchantId, by = owner, codAmountPiasters = 100000, customerName = 'منى علي') {
  const { id } = await createOrder(
    by,
    forMerchantId,
    {
      type: 'deliver',
      customerName,
      customerMobile: '01001234567',
      addressText: '12 Abbas El Akkad St',
      areaId: nasrCityId,
      size: 'small',
      codAmountPiasters,
      allowOpenPackage: false,
      depositRequired: false,
      insuredValuePiasters: 0,
    },
    `home-${(keyCounter += 1)}`,
  );
  return id;
}

async function moveThrough(orderId: string, statuses: OrderStatus[]) {
  for (const status of statuses) await changeOrderStatus(staff, orderId, status);
}

// Past days cannot be reached through the real status path, so the timeline row is written as the hub would have.
async function addPastEvent(orderId: string, toStatus: OrderStatus, at: Date) {
  await db.orderEvent.create({ data: { orderId, kind: 'status_changed', toStatus, at } });
}

describe('getHomeSummary', () => {
  it('gives an empty merchant zeros and 14 empty days, oldest first, ending today in Cairo', async () => {
    const summary = await getHomeSummary(owner, merchantId, NOW);
    expect(summary).toMatchObject({
      todayCreated: 0,
      todayPickedUp: 0,
      todayDelivered: 0,
      needsAction: [],
      needsActionCount: 0,
      expectedFromActivePiasters: 0,
      openCounts: { inProgress: 0, new: 0, comingBack: 0 },
    });
    expect(summary.deliveriesLast14Days).toHaveLength(14);
    expect(summary.deliveriesLast14Days[0]).toEqual({ date: '2026-11-05', delivered: 0, returned: 0 });
    expect(summary.deliveriesLast14Days[13]).toEqual({ date: '2026-11-18', delivered: 0, returned: 0 });
  });

  it('counts today’s created, picked up and delivered orders using the Cairo day', async () => {
    const now = new Date();
    const delivered = await makeOrder();
    await moveThrough(delivered, ['picked_up', 'in_progress', 'out_for_delivery', 'delivered']);
    const pickedUp = await makeOrder();
    await moveThrough(pickedUp, ['picked_up']);
    const createdYesterday = await makeOrder();
    await db.order.update({ where: { id: createdYesterday }, data: { createdAt: new Date(now.getTime() - DAY_MS - HOUR_MS) } });

    const summary = await getHomeSummary(owner, merchantId, now);
    expect(summary.todayCreated).toBe(2);
    expect(summary.todayPickedUp).toBe(2);
    expect(summary.todayDelivered).toBe(1);
    expect(summary.deliveriesLast14Days.at(-1)).toMatchObject({ delivered: 1, returned: 0 });
  });

  it('puts delivered and returned orders on their Cairo day, and leaves out days older than 14', async () => {
    const first = await makeOrder();
    const second = await makeOrder();
    const third = await makeOrder();
    const old = await makeOrder();
    // 23:30 Cairo on 16 Nov is 21:30 UTC: still the 16th in Cairo.
    await addPastEvent(first, 'delivered', new Date('2026-11-16T21:30:00Z'));
    // 00:30 Cairo on 17 Nov is 22:30 UTC on the 16th: already the 17th in Cairo.
    await addPastEvent(second, 'delivered', new Date('2026-11-16T22:30:00Z'));
    await addPastEvent(third, 'returned', new Date('2026-11-05T10:00:00Z'));
    await addPastEvent(old, 'delivered', new Date('2026-11-04T10:00:00Z'));

    const days = (await getHomeSummary(owner, merchantId, NOW)).deliveriesLast14Days;
    expect(days.find((day) => day.date === '2026-11-16')).toEqual({ date: '2026-11-16', delivered: 1, returned: 0 });
    expect(days.find((day) => day.date === '2026-11-17')).toEqual({ date: '2026-11-17', delivered: 1, returned: 0 });
    expect(days[0]).toEqual({ date: '2026-11-05', delivered: 0, returned: 1 });
    expect(days.reduce((sum, day) => sum + day.delivered, 0)).toBe(2);
  });

  it('lists up to 5 orders awaiting the merchant with the reason the courier gave', async () => {
    const ids: string[] = [];
    for (let index = 0; index < 6; index += 1) {
      const id = await makeOrder(merchantId, owner, 100000, `Customer ${index}`);
      await moveThrough(id, ['picked_up', 'in_progress', 'out_for_delivery']);
      await changeOrderStatus(staff, id, 'attempt_failed');
      await changeOrderStatus(staff, id, 'awaiting_merchant_action', { reason: `Customer refused ${index}` });
      ids.push(id);
    }

    const summary = await getHomeSummary(owner, merchantId, NOW);
    expect(summary.needsActionCount).toBe(6);
    expect(summary.needsAction).toHaveLength(5);
    const [latest] = summary.needsAction;
    expect(latest).toMatchObject({ id: ids[5], customerName: 'Customer 5', areaNameEn: 'Nasr City', reason: 'Customer refused 5', attempts: 1 });
    expect(latest?.number).toMatch(/^\d{10}$/);
  });

  it('sums cash to collect from orders that are not final, and counts open orders by tab', async () => {
    await makeOrder(merchantId, owner, 150000);
    const moving = await makeOrder(merchantId, owner, 50000);
    await moveThrough(moving, ['picked_up', 'in_progress']);
    const delivered = await makeOrder(merchantId, owner, 70000);
    await moveThrough(delivered, ['picked_up', 'in_progress', 'out_for_delivery', 'delivered']);
    const canceled = await makeOrder(merchantId, owner, 90000);
    await changeOrderStatus(owner, canceled, 'canceled');

    const summary = await getHomeSummary(owner, merchantId, NOW);
    expect(summary.expectedFromActivePiasters).toBe(200000);
    expect(summary.openCounts).toEqual({ inProgress: 1, new: 1, comingBack: 0 });
  });

  it('leaves out another merchant’s orders', async () => {
    const otherMerchantId = (await makeMerchant('Other Shop', 'محل تاني')).id;
    const otherOwner = await makeSessionUser({ merchantId: otherMerchantId, access: 'full' });
    const theirs = await makeOrder(otherMerchantId, otherOwner, 500000);
    await addPastEvent(theirs, 'delivered', new Date('2026-11-17T10:00:00Z'));
    const waiting = await makeOrder(otherMerchantId, otherOwner, 10000);
    await db.order.update({ where: { id: waiting }, data: { status: 'awaiting_merchant_action' } });

    const summary = await getHomeSummary(owner, merchantId, NOW);
    expect(summary.expectedFromActivePiasters).toBe(0);
    expect(summary.needsAction).toEqual([]);
    expect(summary.deliveriesLast14Days.every((day) => day.delivered === 0 && day.returned === 0)).toBe(true);
    await expect(getHomeSummary(owner, otherMerchantId, NOW)).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('refuses a member without orders access', async () => {
    const financeOnly = await makeSessionUser({ merchantId, access: 'finance' });
    await expect(getHomeSummary(financeOnly, merchantId, NOW)).rejects.toMatchObject({ code: 'forbidden' });
  });
});
