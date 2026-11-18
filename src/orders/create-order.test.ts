import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SessionUser } from '@/accounts';
import { makeMerchant, makeSessionUser } from '@/merchants/merchants-test-fixtures';
import { seedPricingDefaults } from '@/pricing/pricing-test-fixtures';
import { db } from '@/shared/db';
import { resetTestDatabase } from '@/shared/test-db';
import { createOrder, type CreateOrderInput } from './create-order';

let nasrCityId = '';
let merchantId = '';
let owner: SessionUser;
let keyCounter = 0;
const nextKey = () => `key-${(keyCounter += 1)}`;

beforeAll(async () => {
  nasrCityId = (await db.area.findFirstOrThrow({ where: { nameEn: 'Nasr City' } })).id;
});

beforeEach(async () => {
  await resetTestDatabase();
  await seedPricingDefaults();
  const merchant = await makeMerchant();
  merchantId = merchant.id;
  owner = await makeSessionUser({ merchantId, access: 'full' });
});

function base(): Omit<CreateOrderInput, 'type'> {
  return {
    customerName: 'منى علي',
    customerMobile: '01001234567',
    addressText: '١٢ شارع عباس العقاد، عمارة ٤',
    areaId: nasrCityId,
    size: 'small',
    codAmountPiasters: 0,
    allowOpenPackage: false,
    depositRequired: false,
    insuredValuePiasters: 0,
  };
}

async function makeProducts(count: number) {
  const products = [];
  for (let index = 0; index < count; index += 1) {
    products.push(await db.product.create({ data: { merchantId, nameEn: `Dress ${index}`, nameAr: `فستان ${index}`, pricePiasters: 50000 } }));
  }
  return products.map((product) => product.id);
}

describe('createOrder', () => {
  it('creates a delivery with frozen fees, a 10-digit number, a customer and a timeline entry', async () => {
    const { id, number } = await createOrder(owner, merchantId, { ...base(), type: 'deliver', codAmountPiasters: 150000 }, nextKey());
    expect(number).toMatch(/^[1-9]\d{9}$/);
    const order = await db.order.findUniqueOrThrow({ where: { id }, include: { events: true, customer: true } });
    expect(order).toMatchObject({
      status: 'new',
      customerName: 'منى علي',
      customerMobile: '+201001234567',
      addressText: '١٢ شارع عباس العقاد، عمارة ٤',
      codAmountPiasters: 150000,
      shippingPiasters: 6800,
      vatPiasters: 952,
      totalFeePiasters: 7752,
    });
    expect(order.customer.mobile).toBe('+201001234567');
    expect(order.events.map((event) => event.kind)).toEqual(['created']);
    expect(order.returnLocationId).toBeNull();
  });

  it('creates one order when the same request is sent twice', async () => {
    const first = await createOrder(owner, merchantId, { ...base(), type: 'deliver' }, 'same-key');
    const second = await createOrder(owner, merchantId, { ...base(), type: 'deliver' }, 'same-key');
    expect(second.id).toBe(first.id);
    expect(await db.order.count()).toBe(1);
  });

  it('Pick & Choose takes 1 to 3 products and always lets the customer open the package', async () => {
    const productIds = await makeProducts(4);
    const { id } = await createOrder(owner, merchantId, { ...base(), type: 'pick_and_choose', productIds: productIds.slice(0, 2) }, nextKey());
    const order = await db.order.findUniqueOrThrow({ where: { id }, include: { items: true } });
    expect(order.allowOpenPackage).toBe(true);
    expect(order.openPackagePiasters).toBe(700);
    expect(order.items.map((item) => item.nameAr).sort()).toEqual(['فستان 0', 'فستان 1']);
    await expect(createOrder(owner, merchantId, { ...base(), type: 'pick_and_choose', productIds: [] }, nextKey())).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(createOrder(owner, merchantId, { ...base(), type: 'pick_and_choose', productIds }, nextKey())).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('Cash collection needs an amount and a direction; giving cash is never collected', async () => {
    await expect(createOrder(owner, merchantId, { ...base(), type: 'cash_collection', cashDirection: 'collect', codAmountPiasters: 0 }, nextKey())).rejects.toMatchObject({ code: 'invalid_input' });
    const collect = await createOrder(owner, merchantId, { ...base(), type: 'cash_collection', cashDirection: 'collect', codAmountPiasters: 50000 }, nextKey());
    const give = await createOrder(owner, merchantId, { ...base(), type: 'cash_collection', cashDirection: 'give', codAmountPiasters: 50000 }, nextKey());
    expect(await db.order.findUniqueOrThrow({ where: { id: collect.id } })).toMatchObject({ codAmountPiasters: 50000, refundPiasters: 0, cashDirection: 'collect', shippingPiasters: 5500 });
    expect(await db.order.findUniqueOrThrow({ where: { id: give.id } })).toMatchObject({ codAmountPiasters: 0, refundPiasters: 50000, cashDirection: 'give' });
  });

  it('Return pays a refund and collects nothing, and can link the original order', async () => {
    const original = await createOrder(owner, merchantId, { ...base(), type: 'deliver' }, nextKey());
    const { id } = await createOrder(owner, merchantId, { ...base(), type: 'return', codAmountPiasters: 30000, linkedOrderNumber: original.number }, nextKey());
    const order = await db.order.findUniqueOrThrow({ where: { id }, include: { linksFrom: true } });
    expect(order).toMatchObject({ codAmountPiasters: 0, refundPiasters: 30000, allowOpenPackage: false, shippingPiasters: 6400 });
    expect(order.linksFrom).toEqual([expect.objectContaining({ toOrderId: original.id, kind: 'return' })]);
  });

  it('refuses to link another merchant’s order', async () => {
    const other = await makeMerchant('Other', 'آخر');
    const otherOwner = await makeSessionUser({ merchantId: other.id, access: 'full' });
    const theirs = await createOrder(otherOwner, other.id, { ...base(), type: 'deliver' }, nextKey());
    await expect(createOrder(owner, merchantId, { ...base(), type: 'exchange', linkedOrderNumber: theirs.number }, nextKey())).rejects.toMatchObject({ code: 'not_found' });
  });

  it('prices Exchange and Sign & Return per the price list', async () => {
    const exchange = await createOrder(owner, merchantId, { ...base(), type: 'exchange' }, nextKey());
    const sign = await createOrder(owner, merchantId, { ...base(), type: 'sign_and_return', size: 'large', description: 'Contract' }, nextKey());
    expect((await db.order.findUniqueOrThrow({ where: { id: exchange.id } })).shippingPiasters).toBe(8000);
    // Sign & Return is documents only: always priced as small (plan decision 3).
    expect(await db.order.findUniqueOrThrow({ where: { id: sign.id } })).toMatchObject({ size: 'small', shippingPiasters: 8000 });
  });

  it('refuses bad input before creating anything', async () => {
    await expect(createOrder(owner, merchantId, { ...base(), type: 'deliver', customerMobile: '0100' }, nextKey())).rejects.toMatchObject({ code: 'invalid_mobile' });
    await expect(createOrder(owner, merchantId, { ...base(), type: 'deliver', customerName: ' ' }, nextKey())).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(createOrder(owner, merchantId, { ...base(), type: 'deliver', areaId: '00000000-0000-0000-0000-000000000000' }, nextKey())).rejects.toMatchObject({ code: 'area_not_found' });
    await expect(createOrder(owner, merchantId, { ...base(), type: 'deliver', codAmountPiasters: -5 }, nextKey())).rejects.toMatchObject({ code: 'invalid_input' });
    expect(await db.order.count()).toBe(0);
  });

  it('remembers the customer for next time', async () => {
    await createOrder(owner, merchantId, { ...base(), type: 'deliver' }, nextKey());
    await createOrder(owner, merchantId, { ...base(), type: 'deliver', customerName: 'Mona Ali', addressText: '5 Makram Ebeid St' }, nextKey());
    const customers = await db.customer.findMany();
    expect(customers).toHaveLength(1);
    expect(customers[0]).toMatchObject({ name: 'Mona Ali', lastAddressText: '5 Makram Ebeid St' });
  });

  it('is refused for finance-only members', async () => {
    const finance = await makeSessionUser({ merchantId, access: 'finance' });
    await expect(createOrder(finance, merchantId, { ...base(), type: 'deliver' }, nextKey())).rejects.toMatchObject({ code: 'forbidden' });
  });
});
