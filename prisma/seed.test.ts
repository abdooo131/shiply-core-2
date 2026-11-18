import { execFileSync } from 'node:child_process';
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '@/shared/db';
import { resetTestDatabase } from '@/shared/test-db';

function runSeed(extraEnv: Record<string, string> = {}): void {
  execFileSync('pnpm', ['db:seed'], { stdio: 'pipe', env: { ...process.env, ...extraEnv } });
}

describe('seed', () => {
  beforeAll(resetTestDatabase);

  it('can run twice without creating duplicates', async () => {
    runSeed();
    runSeed();
    expect(await db.governorate.count()).toBe(27);
    expect(await db.merchant.count({ where: { nameEn: 'Eve Chantelle' } })).toBe(1);
    expect(await db.merchantMember.count({ where: { access: 'full' } })).toBe(1);
    expect(await db.staffRole.count({ where: { role: 'admin' } })).toBe(1);
    expect(await db.user.count()).toBe(2);
  });

  it('writes the global business values once, without overwriting a changed one', async () => {
    await db.setting.update({ where: { scope_key: { scope: 'global', key: 'open_package_fee_piasters' } }, data: { valueJson: { value: 900 } } });
    runSeed();
    expect(await db.setting.count({ where: { scope: 'global' } })).toBe(6);
    const vat = await db.setting.findUniqueOrThrow({ where: { scope_key: { scope: 'global', key: 'vat_basis_points' } } });
    expect(vat.valueJson).toEqual({ value: 1400 });
    const openPackage = await db.setting.findUniqueOrThrow({ where: { scope_key: { scope: 'global', key: 'open_package_fee_piasters' } } });
    expect(openPackage.valueJson).toEqual({ value: 900 });
  });

  it('loads six pricing zones and at least one area in every governorate, once', async () => {
    const areasBefore = await db.area.count();
    runSeed();
    expect(await db.area.count()).toBe(areasBefore);
    expect(await db.pricingZone.count()).toBe(6);
    const governoratesWithAreas = await db.area.groupBy({ by: ['governorateCode'] });
    expect(governoratesWithAreas).toHaveLength(27);
    expect(await db.area.count({ where: { governorateCode: 'C' } })).toBeGreaterThan(40);
    expect(await db.area.count({ where: { governorateCode: 'GZ' } })).toBeGreaterThan(25);
  });

  it('refuses to run in production', () => {
    expect(() => runSeed({ NODE_ENV: 'production' })).toThrow();
  });
});
