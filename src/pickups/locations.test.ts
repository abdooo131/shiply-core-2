import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SessionUser } from '@/accounts';
import { makeMerchant, makeSessionUser } from '@/merchants/merchants-test-fixtures';
import { db } from '@/shared/db';
import { resetTestDatabase } from '@/shared/test-db';
import {
  archivePickupLocation,
  listPickupLocations,
  savePickupLocation,
  setDefaultPickupLocation,
  type PickupLocationInput,
} from './locations';

const UNSERVED_AREA_NAME = 'Pickups Test Unserved Area';

let nasrCityId = '';
let unservedAreaId = '';
let merchantId = '';
let owner: SessionUser;

beforeAll(async () => {
  const nasrCity = await db.area.findFirstOrThrow({ where: { nameEn: 'Nasr City' } });
  nasrCityId = nasrCity.id;
  const unserved = await db.area.upsert({
    where: { governorateCode_nameEn: { governorateCode: nasrCity.governorateCode, nameEn: UNSERVED_AREA_NAME } },
    create: {
      governorateCode: nasrCity.governorateCode,
      zoneCode: nasrCity.zoneCode,
      nameEn: UNSERVED_AREA_NAME,
      nameAr: 'منطقة غير مخدومة',
      searchKey: 'pickups test unserved area',
      isServed: false,
    },
    update: { isServed: false },
  });
  unservedAreaId = unserved.id;
});

afterAll(async () => {
  await resetTestDatabase();
  await db.area.deleteMany({ where: { id: unservedAreaId } });
});

beforeEach(async () => {
  await resetTestDatabase();
  merchantId = (await makeMerchant()).id;
  owner = await makeSessionUser({ merchantId, access: 'full' });
});

function input(overrides: Partial<PickupLocationInput> = {}): PickupLocationInput {
  return {
    label: 'Main warehouse',
    addressText: '12 Abbas El Akkad St, Nasr City',
    areaId: nasrCityId,
    contactName: 'Ahmed Samir',
    contactMobile: '0100 123 4567',
    ...overrides,
  };
}

describe('savePickupLocation', () => {
  it('creates a location with a normalized mobile; the first one becomes the default', async () => {
    const { id } = await savePickupLocation(owner, merchantId, input());
    const row = await db.pickupLocation.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ label: 'Main warehouse', contactMobile: '+201001234567', isDefault: true, isActive: true });
    const second = await savePickupLocation(owner, merchantId, input({ label: 'Shop' }));
    expect((await db.pickupLocation.findUniqueOrThrow({ where: { id: second.id } })).isDefault).toBe(false);
  });

  it('updates an existing location and writes an audit entry with ids only', async () => {
    const { id } = await savePickupLocation(owner, merchantId, input());
    await savePickupLocation(owner, merchantId, input({ id, label: 'Warehouse 2' }));
    expect((await db.pickupLocation.findUniqueOrThrow({ where: { id } })).label).toBe('Warehouse 2');
    const audits = await db.auditLog.findMany({ where: { entityType: 'PickupLocation', entityId: id } });
    expect(audits.map((audit) => audit.action).sort()).toEqual(['pickup_location.created', 'pickup_location.updated']);
    expect(JSON.stringify(audits)).not.toContain('Ahmed');
    expect(JSON.stringify(audits)).not.toContain('201001234567');
  });

  it('refuses an invalid mobile, a missing area, an unserved area and bad lengths', async () => {
    await expect(savePickupLocation(owner, merchantId, input({ contactMobile: '0123' }))).rejects.toMatchObject({ code: 'invalid_mobile' });
    await expect(
      savePickupLocation(owner, merchantId, input({ areaId: '00000000-0000-4000-8000-000000000000' })),
    ).rejects.toMatchObject({ code: 'area_not_found' });
    await expect(savePickupLocation(owner, merchantId, input({ areaId: unservedAreaId }))).rejects.toMatchObject({ code: 'area_not_served' });
    await expect(savePickupLocation(owner, merchantId, input({ label: '' }))).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(savePickupLocation(owner, merchantId, input({ label: 'x'.repeat(61) }))).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(savePickupLocation(owner, merchantId, input({ addressText: 'ab' }))).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(savePickupLocation(owner, merchantId, input({ contactName: 'x'.repeat(81) }))).rejects.toMatchObject({ code: 'invalid_input' });
    expect(await db.pickupLocation.count()).toBe(0);
  });

  it('needs orders access, and another merchant’s location is not found', async () => {
    const financeOnly = await makeSessionUser({ merchantId, access: 'finance' });
    await expect(savePickupLocation(financeOnly, merchantId, input())).rejects.toMatchObject({ code: 'forbidden' });

    const otherMerchantId = (await makeMerchant('Other', 'آخر')).id;
    const otherOwner = await makeSessionUser({ merchantId: otherMerchantId, access: 'full' });
    const theirs = await savePickupLocation(otherOwner, otherMerchantId, input());
    await expect(savePickupLocation(owner, merchantId, input({ id: theirs.id, label: 'Taken' }))).rejects.toMatchObject({ code: 'not_found' });
    await expect(setDefaultPickupLocation(owner, merchantId, theirs.id)).rejects.toMatchObject({ code: 'not_found' });
    await expect(archivePickupLocation(owner, merchantId, theirs.id)).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('listPickupLocations', () => {
  it('lists active locations, default first', async () => {
    const first = await savePickupLocation(owner, merchantId, input({ label: 'A' }));
    const second = await savePickupLocation(owner, merchantId, input({ label: 'B' }));
    const third = await savePickupLocation(owner, merchantId, input({ label: 'C' }));
    await setDefaultPickupLocation(owner, merchantId, second.id);
    await archivePickupLocation(owner, merchantId, third.id);
    const list = await listPickupLocations(owner, merchantId);
    expect(list.map((location) => location.id)).toEqual([second.id, first.id]);
    expect(list[0]).toMatchObject({ isDefault: true, areaNameEn: 'Nasr City' });
  });
});

describe('setDefaultPickupLocation', () => {
  it('leaves exactly one default per merchant', async () => {
    const first = await savePickupLocation(owner, merchantId, input({ label: 'A' }));
    const second = await savePickupLocation(owner, merchantId, input({ label: 'B' }));
    await setDefaultPickupLocation(owner, merchantId, second.id);
    await setDefaultPickupLocation(owner, merchantId, second.id);
    const defaults = await db.pickupLocation.findMany({ where: { merchantId, isDefault: true } });
    expect(defaults.map((location) => location.id)).toEqual([second.id]);
    expect((await db.pickupLocation.findUniqueOrThrow({ where: { id: first.id } })).isDefault).toBe(false);
  });

  it('keeps one default when two requests race', async () => {
    const first = await savePickupLocation(owner, merchantId, input({ label: 'A' }));
    const second = await savePickupLocation(owner, merchantId, input({ label: 'B' }));
    await Promise.all([setDefaultPickupLocation(owner, merchantId, first.id), setDefaultPickupLocation(owner, merchantId, second.id)]);
    expect(await db.pickupLocation.count({ where: { merchantId, isDefault: true } })).toBe(1);
  });
});

describe('archivePickupLocation', () => {
  it('hides a location but refuses to archive the default', async () => {
    const main = await savePickupLocation(owner, merchantId, input({ label: 'Main' }));
    const shop = await savePickupLocation(owner, merchantId, input({ label: 'Shop' }));
    await expect(archivePickupLocation(owner, merchantId, main.id)).rejects.toMatchObject({ code: 'cannot_archive_default' });
    await archivePickupLocation(owner, merchantId, shop.id);
    expect((await db.pickupLocation.findUniqueOrThrow({ where: { id: shop.id } })).isActive).toBe(false);
  });

  it('keeps the address snapshot on a scheduled pickup when the location is renamed or archived', async () => {
    await savePickupLocation(owner, merchantId, input({ label: 'Main' }));
    const shop = await savePickupLocation(owner, merchantId, input({ label: 'Shop', addressText: '5 Tahrir Square' }));
    const pickup = await db.pickup.create({
      data: {
        number: '12345678',
        merchantId,
        locationId: shop.id,
        addressText: '5 Tahrir Square',
        areaId: nasrCityId,
        contactName: 'Ahmed Samir',
        contactMobile: '+201001234567',
        pickupDate: new Date('2030-01-01T00:00:00Z'),
        expectedCount: 3,
        createdBy: owner.id,
      },
    });
    await savePickupLocation(owner, merchantId, input({ id: shop.id, label: 'Shop 2', addressText: '9 Other Street', contactName: 'Mona' }));
    await archivePickupLocation(owner, merchantId, shop.id);
    expect(await db.pickup.findUniqueOrThrow({ where: { id: pickup.id } })).toMatchObject({
      addressText: '5 Tahrir Square',
      contactName: 'Ahmed Samir',
      status: 'scheduled',
    });
  });
});
