import { beforeEach, describe, expect, it } from 'vitest';
import { makeMerchant, makeSessionUser } from '@/merchants/merchants-test-fixtures';
import { db } from '@/shared/db';
import { resetTestDatabase } from '@/shared/test-db';
import { approvePriceList, getActivePriceLines, getShippingPiasters, proposePriceList, type PriceLine } from './price-lists';
import { seedPricingDefaults } from './pricing-test-fixtures';
import { buildSamplePriceLines } from './sample-price-lines';

function price(lines: PriceLine[], zoneCode: string, size: string, orderType: string): number | undefined {
  return lines.find((line) => line.zoneCode === zoneCode && line.size === size && line.orderType === orderType)?.shippingPiasters;
}

// Every line raised by a fixed amount, to tell a merchant's own list from the default.
function linesPlus(extraPiasters: number): PriceLine[] {
  return buildSamplePriceLines().map((line) => ({ ...line, shippingPiasters: line.shippingPiasters + extraPiasters }));
}

describe('sample price lines (mockup prices)', () => {
  const lines = buildSamplePriceLines();

  it('covers every zone, size and order type once', () => {
    expect(lines).toHaveLength(180);
    expect(new Set(lines.map((line) => `${line.zoneCode}/${line.size}/${line.orderType}`)).size).toBe(180);
  });

  it('matches the mockup formula', () => {
    expect(price(lines, 'cairo_giza', 'small', 'deliver')).toBe(6800);
    expect(price(lines, 'red_sea_sinai', 'heavy_bulky', 'exchange')).toBe(38200);
    expect(price(lines, 'alexandria', 'medium', 'return')).toBe(7900);
    expect(price(lines, 'delta', 'small', 'cash_collection')).toBe(6500);
    expect(price(lines, 'delta', 'heavy_bulky', 'cash_collection')).toBe(6500);
  });

  it('prices Pick & Choose like Deliver and Sign & Return like Exchange (owner decision 5)', () => {
    expect(price(lines, 'upper_egypt', 'large', 'pick_and_choose')).toBe(price(lines, 'upper_egypt', 'large', 'deliver'));
    expect(price(lines, 'canal', 'small', 'sign_and_return')).toBe(price(lines, 'canal', 'small', 'exchange'));
  });
});

describe('price lists', () => {
  beforeEach(async () => {
    await resetTestDatabase();
    await seedPricingDefaults();
  });

  it('prices every merchant from the default list until they have their own', async () => {
    const merchant = await makeMerchant();
    expect(await getShippingPiasters(merchant.id, 'cairo_giza', 'small', 'deliver')).toBe(6800);
    expect(await getActivePriceLines(merchant.id)).toHaveLength(180);
  });

  it('uses a merchant’s own approved list for that merchant only', async () => {
    const merchant = await makeMerchant();
    const other = await makeMerchant('Other', 'آخر');
    const requester = await makeSessionUser({ staffRole: 'finance' });
    const approver = await makeSessionUser({ staffRole: 'finance' });
    const proposal = await proposePriceList(requester, { merchantId: merchant.id, lines: linesPlus(500) }, 'p-1');
    expect(proposal.status).toBe('pending');
    expect(await getShippingPiasters(merchant.id, 'cairo_giza', 'small', 'deliver')).toBe(6800);

    await approvePriceList(approver, proposal.id);
    expect(await getShippingPiasters(merchant.id, 'cairo_giza', 'small', 'deliver')).toBe(7300);
    expect(await getShippingPiasters(other.id, 'cairo_giza', 'small', 'deliver')).toBe(6800);
    expect(await db.auditLog.count({ where: { action: 'price_list.approved' } })).toBe(1);
  });

  it('retires the previous list when a new default is approved', async () => {
    const merchant = await makeMerchant();
    const requester = await makeSessionUser({ staffRole: 'admin' });
    const approver = await makeSessionUser({ staffRole: 'finance' });
    const proposal = await proposePriceList(requester, { merchantId: null, lines: linesPlus(100) }, 'p-1');
    await approvePriceList(approver, proposal.id);
    expect(await getShippingPiasters(merchant.id, 'cairo_giza', 'small', 'deliver')).toBe(6900);
    const statuses = await db.priceList.findMany({ where: { merchantId: null }, orderBy: { version: 'asc' }, select: { status: true, version: true } });
    expect(statuses).toEqual([{ status: 'retired', version: 1 }, { status: 'active', version: 2 }]);
  });

  it('needs a second person, from Shiply admin or finance', async () => {
    const requester = await makeSessionUser({ staffRole: 'finance' });
    const operations = await makeSessionUser({ staffRole: 'operations' });
    const proposal = await proposePriceList(requester, { merchantId: null, lines: linesPlus(100) }, 'p-1');
    await expect(approvePriceList(requester, proposal.id)).rejects.toMatchObject({ code: 'second_person_required' });
    await expect(approvePriceList(operations, proposal.id)).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('refuses a proposal from anyone outside Shiply admin or finance', async () => {
    const merchant = await makeMerchant();
    const owner = await makeSessionUser({ merchantId: merchant.id, access: 'full' });
    await expect(proposePriceList(owner, { merchantId: merchant.id, lines: linesPlus(0) }, 'p-1')).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('refuses an incomplete, duplicated or zero-priced list', async () => {
    const finance = await makeSessionUser({ staffRole: 'finance' });
    const full = buildSamplePriceLines();
    const missingOne = full.slice(1);
    const duplicated = [...full.slice(1), full[2] as PriceLine];
    const zeroPriced = full.map((line, index) => (index === 0 ? { ...line, shippingPiasters: 0 } : line));
    const unknownZone = full.map((line, index) => (index === 0 ? { ...line, zoneCode: 'moon' } : line));
    for (const [key, lines] of [['a', missingOne], ['b', duplicated], ['c', zeroPriced], ['d', unknownZone]] as const) {
      await expect(proposePriceList(finance, { merchantId: null, lines }, key)).rejects.toMatchObject({ code: 'invalid_input' });
    }
  });

  it('replaces an older proposal still waiting, so it can never be approved', async () => {
    const requester = await makeSessionUser({ staffRole: 'finance' });
    const approver = await makeSessionUser({ staffRole: 'finance' });
    const older = await proposePriceList(requester, { merchantId: null, lines: linesPlus(100) }, 'p-1');
    await proposePriceList(requester, { merchantId: null, lines: linesPlus(200) }, 'p-2');
    await expect(approvePriceList(approver, older.id)).rejects.toMatchObject({ code: 'not_pending' });
  });

  it('creates one proposal when the same request is sent twice', async () => {
    const finance = await makeSessionUser({ staffRole: 'finance' });
    const first = await proposePriceList(finance, { merchantId: null, lines: linesPlus(100) }, 'p-1');
    const second = await proposePriceList(finance, { merchantId: null, lines: linesPlus(100) }, 'p-1');
    expect(second.id).toBe(first.id);
    expect(await db.priceList.count({ where: { status: 'pending' } })).toBe(1);
  });

  it('activates a list once when two people approve it at the same moment', async () => {
    const requester = await makeSessionUser({ staffRole: 'finance' });
    const approverA = await makeSessionUser({ staffRole: 'finance' });
    const approverB = await makeSessionUser({ staffRole: 'admin' });
    const proposal = await proposePriceList(requester, { merchantId: null, lines: linesPlus(100) }, 'p-1');
    const results = await Promise.allSettled([approvePriceList(approverA, proposal.id), approvePriceList(approverB, proposal.id)]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(await db.priceList.count({ where: { merchantId: null, status: 'active' } })).toBe(1);
    expect(await db.auditLog.count({ where: { action: 'price_list.approved' } })).toBe(1);
  });

  it('says clearly when no price exists instead of guessing', async () => {
    const merchant = await makeMerchant();
    await db.activePriceList.deleteMany();
    await expect(getShippingPiasters(merchant.id, 'cairo_giza', 'small', 'deliver')).rejects.toMatchObject({ code: 'price_missing' });
  });
});
