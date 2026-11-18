import { beforeEach, describe, expect, it } from 'vitest';
import { makeMerchant, makeSessionUser } from '@/merchants/merchants-test-fixtures';
import { resetTestDatabase } from '@/shared/test-db';
import { listProducts, saveProduct, setProductActive } from './products';

describe('products', () => {
  beforeEach(resetTestDatabase);

  it('adds, edits, hides and lists a merchant’s products', async () => {
    const merchant = await makeMerchant();
    const owner = await makeSessionUser({ merchantId: merchant.id, access: 'orders_pickups' });
    const dress = await saveProduct(owner, merchant.id, { nameEn: 'Satin dress', nameAr: 'فستان ساتان', pricePiasters: 120000 });
    await saveProduct(owner, merchant.id, { id: dress.id, nameEn: 'Satin dress', nameAr: 'فستان ساتان أحمر', pricePiasters: 125000 });
    await saveProduct(owner, merchant.id, { nameEn: 'Scarf', nameAr: 'إيشارب', pricePiasters: 35000 });
    await setProductActive(owner, merchant.id, dress.id, false);

    expect((await listProducts(owner, merchant.id)).map((product) => product.nameAr)).toEqual(['إيشارب']);
    const all = await listProducts(owner, merchant.id, { includeInactive: true });
    expect(all.find((product) => product.id === dress.id)).toMatchObject({ nameAr: 'فستان ساتان أحمر', pricePiasters: 125000, isActive: false });
  });

  it('keeps merchants apart and checks input', async () => {
    const merchant = await makeMerchant();
    const other = await makeMerchant('Other', 'آخر');
    const owner = await makeSessionUser({ merchantId: merchant.id, access: 'full' });
    const otherOwner = await makeSessionUser({ merchantId: other.id, access: 'full' });
    const theirs = await saveProduct(otherOwner, other.id, { nameEn: 'Bag', nameAr: 'شنطة', pricePiasters: 1000 });
    await expect(setProductActive(owner, merchant.id, theirs.id, false)).rejects.toMatchObject({ code: 'not_found' });
    await expect(saveProduct(owner, merchant.id, { id: theirs.id, nameEn: 'X', nameAr: 'س', pricePiasters: 1 })).rejects.toMatchObject({ code: 'not_found' });
    await expect(saveProduct(owner, merchant.id, { nameEn: ' ', nameAr: 'س', pricePiasters: 1 })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(saveProduct(owner, merchant.id, { nameEn: 'A', nameAr: 'س', pricePiasters: -1 })).rejects.toMatchObject({ code: 'invalid_input' });
    const finance = await makeSessionUser({ merchantId: merchant.id, access: 'finance' });
    await expect(listProducts(finance, merchant.id)).rejects.toMatchObject({ code: 'forbidden' });
  });
});
