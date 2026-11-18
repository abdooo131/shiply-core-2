import type { OrderStatus } from '@prisma/client';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeMerchant, makeSessionUser } from '@/merchants/merchants-test-fixtures';
import { seedPricingDefaults } from '@/pricing/pricing-test-fixtures';
import { db } from '@/shared/db';
import { resetTestDatabase } from '@/shared/test-db';
import { addOrderNote, changeOrderStatus, getOrderTimeline, MAX_DELIVERY_ATTEMPTS, ORDER_STATUS_TRANSITIONS } from './order-status';
import { insertTestOrder } from './orders-test-fixtures';

async function insertOrderWithStatus(merchantId: string, status: OrderStatus, attempts = 0) {
  const order = await insertTestOrder(merchantId);
  return db.order.update({ where: { id: order.id }, data: { status, attempts } });
}

describe('order status changes', () => {
  beforeEach(async () => {
    await resetTestDatabase();
    // Final outcomes book money, which reads VAT and return-fee settings.
    await seedPricingDefaults();
  });

  it('allows every listed change for staff and records who, when and why', async () => {
    const merchant = await makeMerchant();
    const staff = await makeSessionUser({ staffRole: 'operations' });
    for (const [from, targets] of Object.entries(ORDER_STATUS_TRANSITIONS) as [OrderStatus, readonly OrderStatus[]][]) {
      for (const to of targets) {
        const order = await insertOrderWithStatus(merchant.id, from);
        await changeOrderStatus(staff, order.id, to, { reason: 'test_reason', note: `${from} to ${to}` });
        expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe(to);
        const events = await db.orderEvent.findMany({ where: { orderId: order.id } });
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({
          kind: 'status_changed',
          fromStatus: from,
          toStatus: to,
          reason: 'test_reason',
          note: `${from} to ${to}`,
          actorUserId: staff.id,
        });
        expect(events[0]?.at).toBeInstanceOf(Date);
      }
    }
    const audits = await db.auditLog.findMany({ where: { action: 'order.status_changed' } });
    const transitionCount = Object.values(ORDER_STATUS_TRANSITIONS).flat().length;
    expect(audits).toHaveLength(transitionCount);
    expect(JSON.stringify(audits)).not.toContain('Mona Ali');
    expect(JSON.stringify(audits)).not.toContain('+20100');
  });

  it('treats delivered, returned and canceled as final', () => {
    expect(ORDER_STATUS_TRANSITIONS.delivered).toEqual([]);
    expect(ORDER_STATUS_TRANSITIONS.returned).toEqual([]);
    expect(ORDER_STATUS_TRANSITIONS.canceled).toEqual([]);
  });

  it('refuses a change that is not in the list', async () => {
    const merchant = await makeMerchant();
    const admin = await makeSessionUser({ staffRole: 'admin' });
    const order = await insertTestOrder(merchant.id);
    await expect(changeOrderStatus(admin, order.id, 'delivered')).rejects.toMatchObject({ code: 'invalid_transition', status: 409 });
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('new');
    expect(await db.orderEvent.count()).toBe(0);
  });

  it('returns not_found for an unknown order', async () => {
    const admin = await makeSessionUser({ staffRole: 'admin' });
    await expect(changeOrderStatus(admin, '00000000-0000-0000-0000-000000000001', 'canceled')).rejects.toMatchObject({ code: 'not_found' });
    await expect(changeOrderStatus(admin, 'not-a-uuid', 'canceled')).rejects.toMatchObject({ code: 'not_found' });
  });

  it('lets a merchant cancel only before pickup', async () => {
    const merchant = await makeMerchant();
    const member = await makeSessionUser({ merchantId: merchant.id, access: 'orders_pickups' });
    for (const status of ['new', 'pickup_requested'] as const) {
      const order = await insertOrderWithStatus(merchant.id, status);
      await changeOrderStatus(member, order.id, 'canceled', { reason: 'customer_changed_mind' });
      expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('canceled');
    }
    const pickedUp = await insertOrderWithStatus(merchant.id, 'picked_up');
    await expect(changeOrderStatus(member, pickedUp.id, 'canceled')).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('lets a merchant put a new order into a pickup and take it back out', async () => {
    const merchant = await makeMerchant();
    const member = await makeSessionUser({ merchantId: merchant.id, access: 'orders_pickups' });
    const order = await insertOrderWithStatus(merchant.id, 'new');
    await changeOrderStatus(member, order.id, 'pickup_requested', { reason: 'pickup_requested' });
    await changeOrderStatus(member, order.id, 'new', { reason: 'pickup_canceled' });
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('new');
    const pickedUp = await insertOrderWithStatus(merchant.id, 'picked_up');
    await expect(changeOrderStatus(member, pickedUp.id, 'new')).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('lets a merchant answer awaiting_merchant_action but not mark an order delivered', async () => {
    const merchant = await makeMerchant();
    const owner = await makeSessionUser({ merchantId: merchant.id, access: 'full' });
    const waiting = await insertOrderWithStatus(merchant.id, 'awaiting_merchant_action');
    await changeOrderStatus(owner, waiting.id, 'in_progress');
    expect((await db.order.findUniqueOrThrow({ where: { id: waiting.id } })).status).toBe('in_progress');

    const waitingToReturn = await insertOrderWithStatus(merchant.id, 'awaiting_merchant_action');
    await changeOrderStatus(owner, waitingToReturn.id, 'returning');

    const outForDelivery = await insertOrderWithStatus(merchant.id, 'out_for_delivery');
    await expect(changeOrderStatus(owner, outForDelivery.id, 'delivered')).rejects.toMatchObject({ code: 'forbidden', status: 403 });
    const fresh = await insertTestOrder(merchant.id);
    await expect(changeOrderStatus(owner, fresh.id, 'picked_up')).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('refuses a member of another merchant and finance-only access', async () => {
    const merchant = await makeMerchant();
    const other = await makeMerchant('Other', 'آخر');
    const outsider = await makeSessionUser({ merchantId: other.id, access: 'full' });
    const financeOnly = await makeSessionUser({ merchantId: merchant.id, access: 'finance' });
    const shiplyFinance = await makeSessionUser({ staffRole: 'finance' });
    const order = await insertTestOrder(merchant.id);
    for (const user of [outsider, financeOnly, shiplyFinance]) {
      await expect(changeOrderStatus(user, order.id, 'canceled')).rejects.toMatchObject({ code: 'forbidden' });
      await expect(addOrderNote(user, order.id, 'hello')).rejects.toMatchObject({ code: 'forbidden' });
      await expect(getOrderTimeline(user, order.id)).rejects.toMatchObject({ code: 'forbidden' });
    }
  });

  it('counts failed attempts and allows only returning or awaiting after the third', async () => {
    const merchant = await makeMerchant();
    const staff = await makeSessionUser({ staffRole: 'operations' });
    const order = await insertOrderWithStatus(merchant.id, 'out_for_delivery');
    for (let attempt = 1; attempt <= MAX_DELIVERY_ATTEMPTS; attempt += 1) {
      await changeOrderStatus(staff, order.id, 'attempt_failed', { reason: 'no_answer' });
      expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).attempts).toBe(attempt);
      if (attempt < MAX_DELIVERY_ATTEMPTS) await changeOrderStatus(staff, order.id, 'out_for_delivery');
    }
    await expect(changeOrderStatus(staff, order.id, 'out_for_delivery')).rejects.toMatchObject({ code: 'invalid_transition' });
    await expect(changeOrderStatus(staff, order.id, 'rescheduled')).rejects.toMatchObject({ code: 'invalid_transition' });
    await changeOrderStatus(staff, order.id, 'returning');
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('returning');
  });

  it('lets only one of two simultaneous changes win', async () => {
    const merchant = await makeMerchant();
    const first = await makeSessionUser({ staffRole: 'operations' });
    const second = await makeSessionUser({ staffRole: 'admin' });
    const order = await insertOrderWithStatus(merchant.id, 'out_for_delivery');
    const results = await Promise.allSettled([
      changeOrderStatus(first, order.id, 'delivered'),
      changeOrderStatus(second, order.id, 'attempt_failed'),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected?.status === 'rejected' && rejected.reason).toMatchObject({ code: 'invalid_transition' });
    expect(await db.orderEvent.count({ where: { orderId: order.id } })).toBe(1);
  });
});

describe('order notes and timeline', () => {
  beforeEach(async () => {
    await resetTestDatabase();
    // Final outcomes book money, which reads VAT and return-fee settings.
    await seedPricingDefaults();
  });

  it('shows status changes and notes oldest first', async () => {
    const merchant = await makeMerchant();
    const member = await makeSessionUser({ merchantId: merchant.id, access: 'orders_pickups' });
    const staff = await makeSessionUser({ staffRole: 'operations' });
    const order = await insertTestOrder(merchant.id);

    await addOrderNote(member, order.id, 'Call before arriving');
    await changeOrderStatus(staff, order.id, 'pickup_requested');
    await addOrderNote(staff, order.id, 'Courier assigned');

    const timeline = await getOrderTimeline(member, order.id);
    expect(timeline.map((entry) => entry.kind)).toEqual(['note', 'status_changed', 'note']);
    expect(timeline[0]).toMatchObject({ note: 'Call before arriving', actorUserId: member.id, fromStatus: null, toStatus: null });
    expect(timeline[1]).toMatchObject({ fromStatus: 'new', toStatus: 'pickup_requested', actorUserId: staff.id });
    expect(timeline[2]).toMatchObject({ note: 'Courier assigned' });
    expect(await getOrderTimeline(staff, order.id)).toHaveLength(3);
  });

  it('refuses an empty note', async () => {
    const merchant = await makeMerchant();
    const member = await makeSessionUser({ merchantId: merchant.id, access: 'full' });
    const order = await insertTestOrder(merchant.id);
    await expect(addOrderNote(member, order.id, '   ')).rejects.toMatchObject({ code: 'invalid_input' });
  });
});
