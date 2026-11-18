import { beforeEach, describe, expect, it } from 'vitest';
import { makeMerchant, makeSessionUser } from '@/merchants/merchants-test-fixtures';
import { db } from '@/shared/db';
import { resetTestDatabase } from '@/shared/test-db';
import { findCustomerByMobile } from './customers';
import { insertTestOrder } from './orders-test-fixtures';

describe('findCustomerByMobile', () => {
  beforeEach(resetTestDatabase);

  it('finds a past customer however the mobile is written, with their order count', async () => {
    const merchant = await makeMerchant();
    const owner = await makeSessionUser({ merchantId: merchant.id, access: 'full' });
    await insertTestOrder(merchant.id, { customerName: 'منى علي' });
    await insertTestOrder(merchant.id);
    for (const mobile of ['01001234567', '+20 100 123 4567']) {
      expect(await findCustomerByMobile(owner, merchant.id, mobile)).toMatchObject({ name: 'منى علي', orderCount: 2 });
    }
  });

  it('only sees the merchant’s own customers', async () => {
    const merchant = await makeMerchant();
    const other = await makeMerchant('Other', 'آخر');
    const owner = await makeSessionUser({ merchantId: merchant.id, access: 'full' });
    await insertTestOrder(other.id);
    expect(await findCustomerByMobile(owner, merchant.id, '01001234567')).toBeNull();
  });

  it('returns null for an unknown or malformed mobile, and refuses finance-only access', async () => {
    const merchant = await makeMerchant();
    const owner = await makeSessionUser({ merchantId: merchant.id, access: 'full' });
    const finance = await makeSessionUser({ merchantId: merchant.id, access: 'finance' });
    expect(await findCustomerByMobile(owner, merchant.id, '01119998888')).toBeNull();
    expect(await findCustomerByMobile(owner, merchant.id, '123')).toBeNull();
    await expect(findCustomerByMobile(finance, merchant.id, '01001234567')).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('order timeline storage', () => {
  beforeEach(resetTestDatabase);

  it('cannot be changed or deleted once written', async () => {
    const merchant = await makeMerchant();
    const order = await insertTestOrder(merchant.id);
    await db.orderEvent.create({ data: { orderId: order.id, kind: 'created', toStatus: 'new' } });
    await expect(db.$executeRaw`UPDATE "OrderEvent" SET "kind" = 'tampered'`).rejects.toThrow(/append_only/);
    await expect(db.$executeRaw`DELETE FROM "OrderEvent"`).rejects.toThrow(/append_only/);
  });
});
