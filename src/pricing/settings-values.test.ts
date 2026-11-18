import { beforeEach, describe, expect, it } from 'vitest';
import { makeMerchant, makeSessionUser } from '@/merchants/merchants-test-fixtures';
import { db } from '@/shared/db';
import { resetTestDatabase } from '@/shared/test-db';
import { getSettingValue, setSettingValue, type SettingKey } from './settings-values';

// Global values are written by the seed; resetTestDatabase empties Setting, so restore them per test.
async function seedGlobals() {
  const globals: Record<SettingKey, number> = {
    vat_basis_points: 1400,
    return_fee_basis_points: 5000,
    cod_fee_basis_points: 100,
    cod_fee_threshold_piasters: 300000,
    open_package_fee_piasters: 700,
    insurance_basis_points: 0,
  };
  for (const [key, value] of Object.entries(globals)) {
    await db.setting.create({ data: { scope: 'global', key, valueJson: { value } } });
  }
}

describe('settings values', () => {
  beforeEach(async () => {
    await resetTestDatabase();
    await seedGlobals();
  });

  it('reads the global value', async () => {
    expect(await getSettingValue('vat_basis_points')).toBe(1400);
    expect(await getSettingValue('open_package_fee_piasters')).toBe(700);
  });

  it('lets a merchant value win for that merchant only', async () => {
    const merchant = await makeMerchant();
    const other = await makeMerchant('Other', 'آخر');
    const finance = await makeSessionUser({ staffRole: 'finance' });
    await setSettingValue(finance, 'open_package_fee_piasters', 500, merchant.id);
    expect(await getSettingValue('open_package_fee_piasters', merchant.id)).toBe(500);
    expect(await getSettingValue('open_package_fee_piasters', other.id)).toBe(700);
    expect(await getSettingValue('open_package_fee_piasters')).toBe(700);
  });

  it('changes a global value and records who did it', async () => {
    const admin = await makeSessionUser({ staffRole: 'admin' });
    await setSettingValue(admin, 'insurance_basis_points', 100);
    expect(await getSettingValue('insurance_basis_points')).toBe(100);
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: 'setting.changed' } });
    expect(audit.beforeJson).toEqual({ value: 0 });
    expect(audit.afterJson).toEqual({ value: 100 });
    expect(audit.actorUserId).toBe(admin.id);
  });

  it('only lets Shiply admin or finance staff change values', async () => {
    const merchant = await makeMerchant();
    const owner = await makeSessionUser({ merchantId: merchant.id, access: 'full' });
    const operations = await makeSessionUser({ staffRole: 'operations' });
    await expect(setSettingValue(owner, 'vat_basis_points', 0)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(setSettingValue(operations, 'vat_basis_points', 0)).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('accepts only whole numbers of zero or more and known keys', async () => {
    const finance = await makeSessionUser({ staffRole: 'finance' });
    for (const bad of [-1, 1.5, Number.NaN]) {
      await expect(setSettingValue(finance, 'vat_basis_points', bad)).rejects.toMatchObject({ code: 'invalid_input' });
    }
    await expect(setSettingValue(finance, 'made_up' as SettingKey, 1)).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('says which value is missing instead of guessing', async () => {
    await db.setting.deleteMany({ where: { key: 'vat_basis_points' } });
    await expect(getSettingValue('vat_basis_points')).rejects.toThrow(/vat_basis_points/);
  });
});
