import { beforeEach, describe, expect, it } from 'vitest';
import type { SessionUser } from '@/accounts';
import { makeMerchant, makeSessionUser } from '@/merchants/merchants-test-fixtures';
import { db } from '@/shared/db';
import { resetTestDatabase } from '@/shared/test-db';
import { answerAwaitingAction, cancelOrders } from './merchant-order-actions';
import { getOrderTimeline } from './order-status';
import { insertTestOrder } from './orders-test-fixtures';

let merchantId = '';
let owner: SessionUser;

beforeEach(async () => {
  await resetTestDatabase();
  merchantId = (await makeMerchant()).id;
  owner = await makeSessionUser({ merchantId, access: 'full' });
});

describe('cancelOrders', () => {
  it('cancels the orders a merchant may cancel and reports the rest with a reason', async () => {
    const fresh = await insertTestOrder(merchantId);
    const pickupRequested = await insertTestOrder(merchantId);
    await db.order.update({ where: { id: pickupRequested.id }, data: { status: 'pickup_requested' } });
    const onTheRoad = await insertTestOrder(merchantId);
    await db.order.update({ where: { id: onTheRoad.id }, data: { status: 'out_for_delivery' } });
    const otherMerchantId = (await makeMerchant('Other', 'آخر')).id;
    const theirs = await insertTestOrder(otherMerchantId);

    const result = await cancelOrders(owner, merchantId, [fresh.id, pickupRequested.id, onTheRoad.id, theirs.id]);

    expect(result.canceled.sort()).toEqual([fresh.number, pickupRequested.number].sort());
    expect(result.refused).toEqual(
      expect.arrayContaining([
        { number: onTheRoad.number, reason: 'not_cancellable' },
        { number: theirs.id, reason: 'not_found' },
      ]),
    );
    expect(result.refused).toHaveLength(2);
    const statuses = await db.order.findMany({ select: { id: true, status: true } });
    const statusOf = (id: string) => statuses.find((order) => order.id === id)?.status;
    expect(statusOf(fresh.id)).toBe('canceled');
    expect(statusOf(pickupRequested.id)).toBe('canceled');
    expect(statusOf(onTheRoad.id)).toBe('out_for_delivery');
    expect(statusOf(theirs.id)).toBe('new');
    const cancelEvent = await db.orderEvent.findFirstOrThrow({ where: { orderId: fresh.id, toStatus: 'canceled' } });
    expect(cancelEvent.reason).toBe('merchant_canceled');
    expect(await db.orderEvent.count({ where: { orderId: theirs.id } })).toBe(0);
  });

  it('is safe to run twice: an already canceled order is reported, not canceled again', async () => {
    const fresh = await insertTestOrder(merchantId);
    await cancelOrders(owner, merchantId, [fresh.id]);
    const second = await cancelOrders(owner, merchantId, [fresh.id]);
    expect(second).toEqual({ canceled: [], refused: [{ number: fresh.number, reason: 'not_cancellable' }] });
    expect(await db.orderEvent.count({ where: { orderId: fresh.id, toStatus: 'canceled' } })).toBe(1);
  });

  it('treats a malformed id as not found and ignores duplicates', async () => {
    const fresh = await insertTestOrder(merchantId);
    const result = await cancelOrders(owner, merchantId, [fresh.id, fresh.id, 'not-a-uuid']);
    expect(result).toEqual({ canceled: [fresh.number], refused: [{ number: 'not-a-uuid', reason: 'not_found' }] });
  });

  it('refuses more than 200 orders at once and an empty list', async () => {
    const ids = Array.from({ length: 201 }, () => crypto.randomUUID());
    await expect(cancelOrders(owner, merchantId, ids)).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(cancelOrders(owner, merchantId, [])).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('refuses a member without order access', async () => {
    const fresh = await insertTestOrder(merchantId);
    const finance = await makeSessionUser({ merchantId, access: 'finance' });
    await expect(cancelOrders(finance, merchantId, [fresh.id])).rejects.toMatchObject({ code: 'forbidden' });
    expect((await db.order.findUniqueOrThrow({ where: { id: fresh.id } })).status).toBe('new');
  });
});

describe('answerAwaitingAction', () => {
  async function awaitingOrder() {
    const order = await insertTestOrder(merchantId);
    await db.order.update({ where: { id: order.id }, data: { status: 'awaiting_merchant_action' } });
    return order;
  }

  it('deliver again moves the order to in progress with the note in the timeline', async () => {
    const order = await awaitingOrder();
    await answerAwaitingAction(owner, merchantId, order.id, 'deliver_again', 'Customer is home after 5 pm');
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('in_progress');
    const timeline = await getOrderTimeline(owner, order.id);
    expect(timeline.at(-1)).toMatchObject({ toStatus: 'in_progress', note: 'Customer is home after 5 pm' });
  });

  it('return moves the order to returning with an Arabic note', async () => {
    const order = await awaitingOrder();
    await answerAwaitingAction(owner, merchantId, order.id, 'return', 'رجّع الشحنة');
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('returning');
    expect((await getOrderTimeline(owner, order.id)).at(-1)).toMatchObject({ toStatus: 'returning', note: 'رجّع الشحنة' });
  });

  it('requires a note of 1 to 500 characters and a known choice', async () => {
    const order = await awaitingOrder();
    await expect(answerAwaitingAction(owner, merchantId, order.id, 'return', '   ')).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(answerAwaitingAction(owner, merchantId, order.id, 'return', 'x'.repeat(501))).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(
      answerAwaitingAction(owner, merchantId, order.id, 'deliver_now' as 'return', 'note'),
    ).rejects.toMatchObject({ code: 'invalid_input' });
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('awaiting_merchant_action');
  });

  it('refuses an order that is not awaiting an answer', async () => {
    const order = await insertTestOrder(merchantId);
    await expect(answerAwaitingAction(owner, merchantId, order.id, 'deliver_again', 'note')).rejects.toMatchObject({
      code: 'invalid_transition',
    });
  });

  it('answers not found for another merchant’s order', async () => {
    const otherMerchantId = (await makeMerchant('Other', 'آخر')).id;
    const theirs = await insertTestOrder(otherMerchantId);
    await db.order.update({ where: { id: theirs.id }, data: { status: 'awaiting_merchant_action' } });
    await expect(answerAwaitingAction(owner, merchantId, theirs.id, 'return', 'note')).rejects.toMatchObject({ code: 'not_found' });
    expect((await db.order.findUniqueOrThrow({ where: { id: theirs.id } })).status).toBe('awaiting_merchant_action');
  });
});
