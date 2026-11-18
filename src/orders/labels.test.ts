import { beforeEach, describe, expect, it } from 'vitest';
import { makeMerchant, makeSessionUser } from '@/merchants/merchants-test-fixtures';
import { db } from '@/shared/db';
import { resetTestDatabase } from '@/shared/test-db';
import { getLabelData, recordLabelPrint } from './labels';
import { insertTestOrder } from './orders-test-fixtures';

describe('getLabelData', () => {
  beforeEach(resetTestDatabase);

  it('returns everything the label needs for the merchant’s own orders', async () => {
    const merchant = await makeMerchant();
    const member = await makeSessionUser({ merchantId: merchant.id, access: 'orders_pickups' });
    const order = await insertTestOrder(merchant.id);
    await db.order.update({ where: { id: order.id }, data: { codAmountPiasters: 45000, courierNote: 'Call first' } });

    const [label] = await getLabelData(member, [order.id]);
    expect(label).toMatchObject({
      orderId: order.id,
      orderNumber: order.number,
      merchantNameEn: 'Nile Threads',
      merchantNameAr: 'نايل ثريدز',
      customerName: 'Mona Ali',
      customerMobile: '+201001234567',
      addressText: '12 Abbas El Akkad St',
      addressExtra: null,
      areaNameEn: 'Nasr City',
      cashToCollectPiasters: 45000,
      size: 'small',
      type: 'deliver',
      courierNote: 'Call first',
    });
    expect(label?.governorateNameAr).toBeTruthy();
    expect(label?.createdAt).toBeInstanceOf(Date);
  });

  it('keeps Arabic names and addresses exactly as entered', async () => {
    const merchant = await makeMerchant();
    const owner = await makeSessionUser({ merchantId: merchant.id, access: 'full' });
    const order = await insertTestOrder(merchant.id, { customerName: 'منى علي', customerMobile: '+201002223333' });
    await db.order.update({
      where: { id: order.id },
      data: { customerName: 'منى علي', addressText: '١٢ شارع عباس العقاد', addressExtra: 'الدور التالت' },
    });

    const [label] = await getLabelData(owner, [order.id]);
    expect(label).toMatchObject({ customerName: 'منى علي', addressText: '١٢ شارع عباس العقاد', addressExtra: 'الدور التالت' });
  });

  it('returns the labels in the order the ids were given', async () => {
    const merchant = await makeMerchant();
    const owner = await makeSessionUser({ merchantId: merchant.id, access: 'full' });
    const first = await insertTestOrder(merchant.id);
    const second = await insertTestOrder(merchant.id, { customerMobile: '+201112223344' });
    const labels = await getLabelData(owner, [second.id, first.id]);
    expect(labels.map((label) => label.orderId)).toEqual([second.id, first.id]);
  });

  it('treats another merchant’s order as not found, even mixed with own orders', async () => {
    const merchant = await makeMerchant();
    const other = await makeMerchant('Other', 'آخر');
    const owner = await makeSessionUser({ merchantId: merchant.id, access: 'full' });
    const own = await insertTestOrder(merchant.id);
    const theirs = await insertTestOrder(other.id);
    await expect(getLabelData(owner, [theirs.id])).rejects.toMatchObject({ code: 'not_found', status: 404 });
    await expect(getLabelData(owner, [own.id, theirs.id])).rejects.toMatchObject({ code: 'not_found' });
    await expect(getLabelData(owner, ['00000000-0000-4000-8000-000000000001'])).rejects.toMatchObject({ code: 'not_found' });
  });

  it('refuses finance-only access, malformed ids, an empty list and more than 100 ids', async () => {
    const merchant = await makeMerchant();
    const finance = await makeSessionUser({ merchantId: merchant.id, access: 'finance' });
    const owner = await makeSessionUser({ merchantId: merchant.id, access: 'full' });
    const order = await insertTestOrder(merchant.id);
    await expect(getLabelData(finance, [order.id])).rejects.toMatchObject({ code: 'forbidden' });
    await expect(getLabelData(owner, ['not-a-uuid'])).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(getLabelData(owner, [])).rejects.toMatchObject({ code: 'invalid_input' });
    const tooMany = Array.from({ length: 101 }, () => order.id);
    await expect(getLabelData(owner, tooMany)).rejects.toMatchObject({ code: 'invalid_input' });
  });
});

describe('recordLabelPrint', () => {
  beforeEach(resetTestDatabase);

  it('records one print per order with who printed it and the format', async () => {
    const merchant = await makeMerchant();
    const owner = await makeSessionUser({ merchantId: merchant.id, access: 'full' });
    const first = await insertTestOrder(merchant.id);
    const second = await insertTestOrder(merchant.id, { customerMobile: '+201112223344' });

    await recordLabelPrint(owner, [first.id, second.id], 'a4');

    const prints = await db.labelPrint.findMany();
    expect(prints).toHaveLength(2);
    expect(prints.map((print) => print.orderId).sort()).toEqual([first.id, second.id].sort());
    expect(prints.every((print) => print.printedBy === owner.id && print.format === 'a4')).toBe(true);
  });

  it('records nothing for another merchant’s order', async () => {
    const merchant = await makeMerchant();
    const other = await makeMerchant('Other', 'آخر');
    const owner = await makeSessionUser({ merchantId: merchant.id, access: 'full' });
    const theirs = await insertTestOrder(other.id);
    await expect(recordLabelPrint(owner, [theirs.id], 'a6')).rejects.toMatchObject({ code: 'not_found' });
    expect(await db.labelPrint.count()).toBe(0);
  });
});
