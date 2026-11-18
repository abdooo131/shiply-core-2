import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { makeMerchant } from '@/merchants/merchants-test-fixtures';
import { db } from '@/shared/db';
import { resetTestDatabase } from '@/shared/test-db';
import { quoteOrderFees, returnFeePiasters } from './fee-quote';
import { seedPricingDefaults } from './pricing-test-fixtures';

const UNSERVED_AREA_NAME = 'Test Unserved Village';

let nasrCityId = '';
let unservedAreaId = '';

beforeAll(async () => {
  nasrCityId = (await db.area.findFirstOrThrow({ where: { nameEn: 'Nasr City' } })).id;
  const unserved = await db.area.create({
    data: { governorateCode: 'C', zoneCode: 'cairo_giza', nameEn: UNSERVED_AREA_NAME, nameAr: 'قرية تجريبية', searchKey: 'test', isServed: false },
  });
  unservedAreaId = unserved.id;
});

afterAll(async () => {
  await db.area.deleteMany({ where: { nameEn: UNSERVED_AREA_NAME } });
});

describe('quoteOrderFees', () => {
  let merchantId = '';
  const base = () => ({
    merchantId,
    areaId: nasrCityId,
    size: 'small' as const,
    orderType: 'deliver' as const,
    codAmountPiasters: 0,
    allowOpenPackage: false,
    insuredValuePiasters: 0,
  });

  beforeEach(async () => {
    await resetTestDatabase();
    await seedPricingDefaults();
    merchantId = (await makeMerchant()).id;
  });

  it('prices a small delivery in Nasr City with 14% VAT', async () => {
    expect(await quoteOrderFees(base())).toEqual({
      zoneCode: 'cairo_giza',
      shippingPiasters: 6800,
      openPackagePiasters: 0,
      codFeePiasters: 0,
      insurancePiasters: 0,
      netPiasters: 6800,
      vatPiasters: 952,
      totalPiasters: 7752,
    });
  });

  it('charges 1% only on the cash above EGP 3,000 (owner decision 4)', async () => {
    expect((await quoteOrderFees({ ...base(), codAmountPiasters: 500000 })).codFeePiasters).toBe(2000);
    expect((await quoteOrderFees({ ...base(), codAmountPiasters: 300000 })).codFeePiasters).toBe(0);
    expect((await quoteOrderFees({ ...base(), codAmountPiasters: 300001 })).codFeePiasters).toBe(0);
    expect((await quoteOrderFees({ ...base(), codAmountPiasters: 300050 })).codFeePiasters).toBe(1);
  });

  it('adds the open-package fee and charges VAT on the total of fees', async () => {
    const quote = await quoteOrderFees({ ...base(), allowOpenPackage: true });
    expect(quote.openPackagePiasters).toBe(700);
    expect(quote.netPiasters).toBe(7500);
    expect(quote.vatPiasters).toBe(1050);
    expect(quote.totalPiasters).toBe(8550);
  });

  it('charges insurance at the configured rate (0% until set)', async () => {
    expect((await quoteOrderFees({ ...base(), insuredValuePiasters: 1000000 })).insurancePiasters).toBe(0);
    await db.setting.update({ where: { scope_key: { scope: 'global', key: 'insurance_basis_points' } }, data: { valueJson: { value: 100 } } });
    expect((await quoteOrderFees({ ...base(), insuredValuePiasters: 1000000 })).insurancePiasters).toBe(10000);
  });

  it('uses the zone of the area and the order type', async () => {
    const alexandria = await db.area.findFirstOrThrow({ where: { nameEn: 'Alexandria' } });
    const quote = await quoteOrderFees({ ...base(), areaId: alexandria.id, size: 'medium', orderType: 'return' });
    expect(quote.zoneCode).toBe('alexandria');
    expect(quote.shippingPiasters).toBe(7900);
  });

  it('refuses an area outside service or unknown, and negative amounts', async () => {
    await expect(quoteOrderFees({ ...base(), areaId: unservedAreaId })).rejects.toMatchObject({ code: 'area_not_served' });
    await expect(quoteOrderFees({ ...base(), areaId: '00000000-0000-0000-0000-000000000000' })).rejects.toMatchObject({ code: 'area_not_found' });
    await expect(quoteOrderFees({ ...base(), codAmountPiasters: -1 })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(quoteOrderFees({ ...base(), insuredValuePiasters: 1.5 })).rejects.toMatchObject({ code: 'invalid_input' });
  });
});

describe('returnFeePiasters', () => {
  it('is half the shipping, rounded half up', () => {
    expect(returnFeePiasters(6800, 5000)).toBe(3400);
    expect(returnFeePiasters(6801, 5000)).toBe(3401);
  });
});
