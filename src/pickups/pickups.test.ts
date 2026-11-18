import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SessionUser } from '@/accounts';
import { makeMerchant, makeSessionUser } from '@/merchants/merchants-test-fixtures';
import { insertTestOrder } from '@/orders/orders-test-fixtures';
import { db } from '@/shared/db';
import { resetTestDatabase } from '@/shared/test-db';
import { archivePickupLocation, savePickupLocation } from './locations';
import {
  addOrdersToPickup,
  cancelPickup,
  generatePickupNumber,
  listPickups,
  markPickupCollected,
  ratePickup,
  requestPickup,
  stopRepeating,
  type RequestPickupInput,
} from './pickups';

// 10:00 in Cairo on Wednesday 18 Nov 2026 (UTC+2).
const NOW = new Date('2026-11-18T08:00:00Z');
const TOMORROW = '2026-11-19';
const IN_14_DAYS = '2026-12-02';

let nasrCityId = '';
let merchantId = '';
let owner: SessionUser;
let operations: SessionUser;
let mainLocationId = '';
let keyCounter = 0;
const nextKey = () => `pickup-key-${(keyCounter += 1)}`;

beforeAll(async () => {
  nasrCityId = (await db.area.findFirstOrThrow({ where: { nameEn: 'Nasr City' } })).id;
});

beforeEach(async () => {
  await resetTestDatabase();
  merchantId = (await makeMerchant()).id;
  owner = await makeSessionUser({ merchantId, access: 'orders_pickups' });
  operations = await makeSessionUser({ staffRole: 'operations' });
  mainLocationId = (await saveLocation('Main warehouse')).id;
});

function saveLocation(label: string, addressText = '12 Abbas El Akkad St') {
  return savePickupLocation(owner, merchantId, {
    label,
    addressText,
    areaId: nasrCityId,
    contactName: 'Ahmed Samir',
    contactMobile: '01001234567',
  });
}

function request(overrides: Partial<RequestPickupInput> = {}, key = nextKey()) {
  return requestPickup(
    owner,
    merchantId,
    { locationId: mainLocationId, pickupDate: TOMORROW, expectedCount: 5, repeatWeekly: false, ...overrides },
    key,
    NOW,
  );
}

async function statusOf(orderId: string) {
  return (await db.order.findUniqueOrThrow({ where: { id: orderId } })).status;
}

async function attachedOrderIds(pickupId: string) {
  return (await db.pickupOrder.findMany({ where: { pickupId } })).map((row) => row.orderId).sort();
}

describe('generatePickupNumber', () => {
  it('is 8 digits and never starts with 0', () => {
    for (let index = 0; index < 200; index += 1) expect(generatePickupNumber()).toMatch(/^[1-9]\d{7}$/);
  });
});

describe('requestPickup', () => {
  it('books a pickup with an address snapshot and attaches the merchant’s new orders', async () => {
    const orderA = await insertTestOrder(merchantId);
    const orderB = await insertTestOrder(merchantId);
    const otherMerchantId = (await makeMerchant('Other', 'آخر')).id;
    const otherOrder = await insertTestOrder(otherMerchantId);

    const result = await request();
    expect(result.number).toMatch(/^[1-9]\d{7}$/);
    expect(result.attachedOrderCount).toBe(2);
    const pickup = await db.pickup.findUniqueOrThrow({ where: { id: result.id } });
    expect(pickup).toMatchObject({
      merchantId,
      locationId: mainLocationId,
      addressText: '12 Abbas El Akkad St',
      contactName: 'Ahmed Samir',
      contactMobile: '+201001234567',
      expectedCount: 5,
      status: 'scheduled',
      repeatWeekly: false,
      seriesId: null,
      createdBy: owner.id,
    });
    expect(pickup.pickupDate.toISOString().slice(0, 10)).toBe(TOMORROW);
    expect(await attachedOrderIds(result.id)).toEqual([orderA.id, orderB.id].sort());
    expect(await statusOf(orderA.id)).toBe('pickup_requested');
    expect(await statusOf(orderB.id)).toBe('pickup_requested');
    expect(await statusOf(otherOrder.id)).toBe('new');
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: 'pickup.requested', entityId: result.id } });
    expect(JSON.stringify(audit.afterJson)).not.toContain('Ahmed');
  });

  it('a double click (same key) books one pickup', async () => {
    const [first, second] = await Promise.all([request({}, 'double-click'), request({}, 'double-click')]);
    expect(second.id).toBe(first.id);
    expect(await db.pickup.count()).toBe(1);
  });

  it('two simultaneous requests for the same place and day book one pickup', async () => {
    await insertTestOrder(merchantId);
    const [first, second] = await Promise.all([request(), request()]);
    expect(second.id).toBe(first.id);
    expect(await db.pickup.count()).toBe(1);
    expect(await db.pickupOrder.count()).toBe(1);
  });

  it('a later request for the same place and day returns the existing pickup', async () => {
    const first = await request();
    const second = await request({ expectedCount: 9 });
    expect(second.id).toBe(first.id);
    expect(await db.pickup.count()).toBe(1);
  });

  it('accepts tomorrow up to 14 days ahead and refuses today, the past and later days', async () => {
    await expect(request({ pickupDate: TOMORROW })).resolves.toBeTruthy();
    await expect(request({ pickupDate: IN_14_DAYS })).resolves.toBeTruthy();
    for (const pickupDate of ['2026-11-18', '2026-11-01', '2026-12-03', '2026-02-30', 'tomorrow']) {
      await expect(request({ pickupDate })).rejects.toMatchObject({ code: 'invalid_pickup_date' });
    }
  });

  it('uses the Cairo calendar day, not the UTC one', async () => {
    // 23:30 UTC on 18 Nov is already 19 Nov in Cairo, so 19 Nov is "today" and refused.
    const lateEvening = new Date('2026-11-18T23:30:00Z');
    const call = (pickupDate: string) =>
      requestPickup(owner, merchantId, { locationId: mainLocationId, pickupDate, expectedCount: 1, repeatWeekly: false }, nextKey(), lateEvening);
    await expect(call('2026-11-19')).rejects.toMatchObject({ code: 'invalid_pickup_date' });
    await expect(call('2026-11-20')).resolves.toBeTruthy();
  });

  it('validates the expected count and the location', async () => {
    await expect(request({ expectedCount: 0 })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(request({ expectedCount: 1001 })).rejects.toMatchObject({ code: 'invalid_input' });
    const shop = await saveLocation('Shop');
    await archivePickupLocation(owner, merchantId, shop.id);
    await expect(request({ locationId: shop.id })).rejects.toMatchObject({ code: 'not_found' });

    const otherMerchantId = (await makeMerchant('Other', 'آخر')).id;
    const otherOwner = await makeSessionUser({ merchantId: otherMerchantId, access: 'full' });
    await expect(
      requestPickup(otherOwner, otherMerchantId, { locationId: mainLocationId, pickupDate: TOMORROW, expectedCount: 1, repeatWeekly: false }, nextKey(), NOW),
    ).rejects.toMatchObject({ code: 'not_found' });
    const financeOnly = await makeSessionUser({ merchantId, access: 'finance' });
    await expect(
      requestPickup(financeOnly, merchantId, { locationId: mainLocationId, pickupDate: TOMORROW, expectedCount: 1, repeatWeekly: false }, nextKey(), NOW),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('starts a weekly series when asked', async () => {
    const { id } = await request({ repeatWeekly: true });
    const pickup = await db.pickup.findUniqueOrThrow({ where: { id } });
    expect(pickup.repeatWeekly).toBe(true);
    expect(pickup.seriesId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('never attaches an order to two pickups', async () => {
    const order = await insertTestOrder(merchantId);
    const shop = await saveLocation('Shop');
    const first = await request();
    const second = await request({ locationId: shop.id, pickupDate: '2026-11-20' });
    expect(second.attachedOrderCount).toBe(0);
    expect(await attachedOrderIds(first.id)).toEqual([order.id]);
    await expect(db.pickupOrder.create({ data: { pickupId: second.id, orderId: order.id } })).rejects.toThrow();
  });
});

describe('addOrdersToPickup', () => {
  it('refuses when no pickup is scheduled for the location', async () => {
    const order = await insertTestOrder(merchantId);
    await expect(addOrdersToPickup(owner, merchantId, [order.id], undefined, NOW)).rejects.toMatchObject({ code: 'no_scheduled_pickup' });
  });

  it('adds new orders to the next scheduled pickup at the default location and skips the rest', async () => {
    const later = await request({ pickupDate: '2026-11-25' });
    const next = await request({ pickupDate: '2026-11-20' });
    const fresh = await insertTestOrder(merchantId);
    const delivered = await insertTestOrder(merchantId);
    await db.order.update({ where: { id: delivered.id }, data: { status: 'delivered' } });
    const otherMerchantId = (await makeMerchant('Other', 'آخر')).id;
    const foreign = await insertTestOrder(otherMerchantId);

    const result = await addOrdersToPickup(owner, merchantId, [fresh.id, delivered.id, foreign.id], undefined, NOW);
    expect(result).toMatchObject({ pickupId: next.id, addedCount: 1 });
    expect(await attachedOrderIds(next.id)).toEqual([fresh.id]);
    expect(await attachedOrderIds(later.id)).toEqual([]);
    expect(await statusOf(fresh.id)).toBe('pickup_requested');
    expect(await statusOf(delivered.id)).toBe('delivered');
    expect(await statusOf(foreign.id)).toBe('new');

    const again = await addOrdersToPickup(owner, merchantId, [fresh.id], undefined, NOW);
    expect(again.addedCount).toBe(0);
    expect(await db.pickupOrder.count()).toBe(1);
  });

  it('uses the given location', async () => {
    const shop = await saveLocation('Shop');
    await request();
    const shopPickup = await request({ locationId: shop.id });
    const order = await insertTestOrder(merchantId);
    const result = await addOrdersToPickup(owner, merchantId, [order.id], shop.id, NOW);
    expect(result.pickupId).toBe(shopPickup.id);
  });
});

describe('cancelPickup', () => {
  it('cancels a scheduled pickup and sends its orders back to new', async () => {
    const order = await insertTestOrder(merchantId);
    const { id } = await request();
    await cancelPickup(owner, merchantId, id, NOW);
    expect((await db.pickup.findUniqueOrThrow({ where: { id } })).status).toBe('canceled');
    expect(await statusOf(order.id)).toBe('new');
    expect(await db.pickupOrder.count()).toBe(0);
    await cancelPickup(owner, merchantId, id, NOW);
    expect(await db.auditLog.count({ where: { action: 'pickup.canceled', entityId: id } })).toBe(1);
  });

  it('refuses after the courier collected', async () => {
    const { id } = await request();
    await markPickupCollected(operations, id, [], NOW);
    await expect(cancelPickup(owner, merchantId, id, NOW)).rejects.toMatchObject({ code: 'pickup_not_cancellable' });
  });

  it('books next week’s pickup in the same series when a weekly pickup is canceled', async () => {
    const { id } = await request({ repeatWeekly: true });
    await cancelPickup(owner, merchantId, id, NOW);
    const canceled = await db.pickup.findUniqueOrThrow({ where: { id } });
    const next = await db.pickup.findFirstOrThrow({ where: { status: 'scheduled' } });
    expect(next).toMatchObject({ seriesId: canceled.seriesId, repeatWeekly: true, locationId: mainLocationId, expectedCount: 5 });
    expect(next.pickupDate.toISOString().slice(0, 10)).toBe('2026-11-26');
    expect(next.number).not.toBe(canceled.number);
  });

  it('is not found for another merchant', async () => {
    const { id } = await request();
    const otherMerchantId = (await makeMerchant('Other', 'آخر')).id;
    const otherOwner = await makeSessionUser({ merchantId: otherMerchantId, access: 'full' });
    await expect(cancelPickup(otherOwner, otherMerchantId, id, NOW)).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('stopRepeating', () => {
  it('ends the series so canceling books nothing new', async () => {
    const { id } = await request({ repeatWeekly: true });
    await stopRepeating(owner, merchantId, id);
    expect((await db.pickup.findUniqueOrThrow({ where: { id } })).repeatWeekly).toBe(false);
    await cancelPickup(owner, merchantId, id, NOW);
    expect(await db.pickup.count()).toBe(1);
  });
});

describe('ratePickup', () => {
  it('rates a collected pickup only, 1 to 5 stars with a short comment', async () => {
    const { id } = await request();
    await expect(ratePickup(owner, merchantId, id, { rating: 5 })).rejects.toMatchObject({ code: 'pickup_not_rateable' });
    await markPickupCollected(operations, id, [], NOW);
    await expect(ratePickup(owner, merchantId, id, { rating: 0 })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(ratePickup(owner, merchantId, id, { rating: 6 })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(ratePickup(owner, merchantId, id, { rating: 4, comment: 'x'.repeat(301) })).rejects.toMatchObject({ code: 'invalid_input' });
    await ratePickup(owner, merchantId, id, { rating: 4, comment: 'On time' });
    expect(await db.pickup.findUniqueOrThrow({ where: { id } })).toMatchObject({ rating: 4, ratingComment: 'On time' });
  });
});

describe('listPickups', () => {
  it('shows upcoming by date ascending and history by date descending', async () => {
    const later = await request({ pickupDate: '2026-11-25' });
    const sooner = await request({ pickupDate: '2026-11-20' });
    const canceled = await request({ pickupDate: '2026-11-21' });
    const collected = await request({ pickupDate: '2026-11-22' });
    await cancelPickup(owner, merchantId, canceled.id, NOW);
    await markPickupCollected(operations, collected.id, [], NOW);

    const upcoming = await listPickups(owner, merchantId, { tab: 'upcoming', page: 1 });
    expect(upcoming.rows.map((row) => row.id)).toEqual([sooner.id, later.id]);
    expect(upcoming.rows[0]).toMatchObject({ pickupDate: '2026-11-20', status: 'scheduled', attachedOrderCount: 0 });
    const history = await listPickups(owner, merchantId, { tab: 'history', page: 1 });
    expect(history.rows.map((row) => row.id)).toEqual([collected.id, canceled.id]);
  });

  it('pages history 25 at a time', async () => {
    const location = await db.pickupLocation.findUniqueOrThrow({ where: { id: mainLocationId } });
    await db.pickup.createMany({
      data: Array.from({ length: 27 }, (_, index) => ({
        number: String(10_000_000 + index),
        merchantId,
        locationId: location.id,
        addressText: location.addressText,
        contactName: location.contactName,
        contactMobile: location.contactMobile,
        pickupDate: new Date(Date.UTC(2026, 9, 1 + index)),
        expectedCount: 1,
        status: 'collected' as const,
        createdBy: owner.id,
      })),
    });
    const first = await listPickups(owner, merchantId, { tab: 'history', page: 1 });
    const second = await listPickups(owner, merchantId, { tab: 'history', page: 2 });
    expect(first).toMatchObject({ total: 27, pageCount: 2, page: 1 });
    expect(first.rows).toHaveLength(25);
    expect(second.rows).toHaveLength(2);
    expect(first.rows[0]?.pickupDate).toBe('2026-10-27');
  });
});

describe('markPickupCollected', () => {
  it('only admin or operations staff may mark a pickup collected', async () => {
    const { id } = await request();
    const finance = await makeSessionUser({ staffRole: 'finance' });
    await expect(markPickupCollected(owner, id, [], NOW)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(markPickupCollected(finance, id, [], NOW)).rejects.toMatchObject({ code: 'forbidden' });
    const admin = await makeSessionUser({ staffRole: 'admin' });
    await markPickupCollected(admin, id, [], NOW);
    expect((await db.pickup.findUniqueOrThrow({ where: { id } })).status).toBe('collected');
  });

  it('moves collected orders to picked up and the rest back to new', async () => {
    const taken = await insertTestOrder(merchantId);
    const left = await insertTestOrder(merchantId);
    const { id } = await request();
    await markPickupCollected(operations, id, [taken.id], NOW);
    expect(await db.pickup.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: 'collected', collectedCount: 1 });
    expect(await statusOf(taken.id)).toBe('picked_up');
    expect(await statusOf(left.id)).toBe('new');
    expect(await attachedOrderIds(id)).toEqual([taken.id]);
    // A repeat of the same call changes nothing.
    await markPickupCollected(operations, id, [taken.id], NOW);
    expect(await db.auditLog.count({ where: { action: 'pickup.collected', entityId: id } })).toBe(1);
  });

  it('refuses an order that is not in the pickup and a canceled pickup', async () => {
    const { id } = await request();
    const outsider = await insertTestOrder(merchantId);
    await expect(markPickupCollected(operations, id, [outsider.id], NOW)).rejects.toMatchObject({ code: 'order_not_in_pickup' });
    await cancelPickup(owner, merchantId, id, NOW);
    await expect(markPickupCollected(operations, id, [], NOW)).rejects.toMatchObject({ code: 'pickup_not_collectable' });
  });

  it('books next week’s pickup for a weekly series', async () => {
    const { id } = await request({ repeatWeekly: true });
    await markPickupCollected(operations, id, [], NOW);
    const next = await db.pickup.findFirstOrThrow({ where: { status: 'scheduled' } });
    expect(next.pickupDate.toISOString().slice(0, 10)).toBe('2026-11-26');
    expect(next.repeatWeekly).toBe(true);
  });
});
