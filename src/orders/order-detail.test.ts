import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SessionUser } from '@/accounts';
import { makeMerchant, makeSessionUser } from '@/merchants/merchants-test-fixtures';
import { seedPricingDefaults } from '@/pricing/pricing-test-fixtures';
import { db } from '@/shared/db';
import { resetTestDatabase } from '@/shared/test-db';
import { createOrder, type CreateOrderInput } from './create-order';
import { getOrderDetail } from './order-detail';

let nasrCityId = '';
let merchantId = '';
let owner: SessionUser;
let keyCounter = 0;
const nextKey = () => `detail-key-${(keyCounter += 1)}`;

beforeAll(async () => {
  nasrCityId = (await db.area.findFirstOrThrow({ where: { nameEn: 'Nasr City' } })).id;
});

beforeEach(async () => {
  await resetTestDatabase();
  await seedPricingDefaults();
  merchantId = (await makeMerchant()).id;
  owner = await makeSessionUser({ merchantId, access: 'full' });
});

function base(): Omit<CreateOrderInput, 'type'> {
  return {
    customerName: 'منى علي',
    customerMobile: '01001234567',
    addressText: '١٢ شارع عباس العقاد',
    areaId: nasrCityId,
    size: 'small',
    codAmountPiasters: 150000,
    allowOpenPackage: false,
    depositRequired: false,
    insuredValuePiasters: 0,
  };
}

describe('getOrderDetail', () => {
  it('returns the full view of the merchant’s own order', async () => {
    const { id, number } = await createOrder(owner, merchantId, { ...base(), type: 'deliver', merchantReference: 'REF-1' }, nextKey());
    await db.orderItem.create({ data: { orderId: id, nameEn: 'Dress', nameAr: 'فستان', quantity: 2, pricePiasters: 50000 } });
    const stored = await db.order.findUniqueOrThrow({ where: { id } });

    const detail = await getOrderDetail(owner, merchantId, number);

    expect(detail).toMatchObject({
      id,
      number,
      type: 'deliver',
      status: 'new',
      customerName: 'منى علي',
      customerMobile: '+201001234567',
      codAmountPiasters: 150000,
      merchantReference: 'REF-1',
      area: { nameEn: 'Nasr City', governorate: { nameEn: 'Cairo', nameAr: 'القاهرة' } },
      isPrinted: false,
      linkedOrders: [],
      allowedActions: { cancel: true, answerAwaiting: false, createExchange: false, createReturn: false },
    });
    expect(detail.area.nameAr).toBeTruthy();
    expect(detail.fees).toEqual({
      shippingPiasters: stored.shippingPiasters,
      openPackagePiasters: stored.openPackagePiasters,
      codFeePiasters: stored.codFeePiasters,
      insurancePiasters: stored.insurancePiasters,
      vatPiasters: stored.vatPiasters,
      totalFeePiasters: stored.totalFeePiasters,
    });
    expect(detail.items).toEqual([expect.objectContaining({ nameEn: 'Dress', nameAr: 'فستان', quantity: 2, pricePiasters: 50000 })]);
    expect(detail.timeline.map((entry) => entry.kind)).toEqual(['created']);
  });

  it('marks a printed label and lists linked orders in both directions', async () => {
    const original = await createOrder(owner, merchantId, { ...base(), type: 'deliver' }, nextKey());
    const followUp = await createOrder(
      owner,
      merchantId,
      { ...base(), type: 'return', codAmountPiasters: 0, linkedOrderNumber: original.number },
      nextKey(),
    );
    await db.labelPrint.create({ data: { orderId: original.id, format: 'a6', printedBy: owner.id } });

    const originalDetail = await getOrderDetail(owner, merchantId, original.number);
    expect(originalDetail.isPrinted).toBe(true);
    expect(originalDetail.linkedOrders).toEqual([{ number: followUp.number, type: 'return', direction: 'follow_up' }]);

    const followUpDetail = await getOrderDetail(owner, merchantId, followUp.number);
    expect(followUpDetail.isPrinted).toBe(false);
    expect(followUpDetail.linkedOrders).toEqual([{ number: original.number, type: 'deliver', direction: 'original' }]);
  });

  it('allows the merchant actions that fit each status', async () => {
    const { id, number } = await createOrder(owner, merchantId, { ...base(), type: 'deliver' }, nextKey());
    const expectations = [
      ['pickup_requested', { cancel: true, answerAwaiting: false, createExchange: false, createReturn: false }],
      ['out_for_delivery', { cancel: false, answerAwaiting: false, createExchange: false, createReturn: false }],
      ['awaiting_merchant_action', { cancel: false, answerAwaiting: true, createExchange: false, createReturn: false }],
      ['delivered', { cancel: false, answerAwaiting: false, createExchange: true, createReturn: true }],
      ['canceled', { cancel: false, answerAwaiting: false, createExchange: false, createReturn: false }],
    ] as const;
    for (const [status, allowed] of expectations) {
      await db.order.update({ where: { id }, data: { status } });
      expect((await getOrderDetail(owner, merchantId, number)).allowedActions).toEqual(allowed);
    }
  });

  it('answers not found for another merchant’s order number or a malformed number', async () => {
    const otherId = (await makeMerchant('Other', 'آخر')).id;
    const otherOwner = await makeSessionUser({ merchantId: otherId, access: 'full' });
    const theirs = await createOrder(otherOwner, otherId, { ...base(), type: 'deliver' }, nextKey());

    await expect(getOrderDetail(owner, merchantId, theirs.number)).rejects.toMatchObject({ code: 'not_found', status: 404 });
    await expect(getOrderDetail(owner, merchantId, '12345')).rejects.toMatchObject({ code: 'not_found', status: 404 });
    await expect(getOrderDetail(owner, merchantId, "1' OR '1'='1")).rejects.toMatchObject({ code: 'not_found', status: 404 });
  });

  it('refuses a member without order access', async () => {
    const { number } = await createOrder(owner, merchantId, { ...base(), type: 'deliver' }, nextKey());
    const finance = await makeSessionUser({ merchantId, access: 'finance' });
    await expect(getOrderDetail(finance, merchantId, number)).rejects.toMatchObject({ code: 'forbidden' });
  });
});
