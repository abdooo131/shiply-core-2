import { db } from '@/shared/db';
import { buildSamplePriceLines } from './sample-price-lines';
import type { SettingKey } from './settings-values';

export const DEFAULT_SETTING_VALUES: Record<SettingKey, number> = {
  vat_basis_points: 1400,
  return_fee_basis_points: 5000,
  cod_fee_basis_points: 100,
  cod_fee_threshold_piasters: 300000,
  open_package_fee_piasters: 700,
  insurance_basis_points: 0,
};

// resetTestDatabase empties settings and price lists; tests that price things restore the defaults.
export async function seedPricingDefaults(): Promise<void> {
  for (const [key, value] of Object.entries(DEFAULT_SETTING_VALUES)) {
    await db.setting.create({ data: { scope: 'global', key, valueJson: { value } } });
  }
  const list = await db.priceList.create({
    data: {
      merchantId: null,
      version: 1,
      status: 'active',
      requestedBy: '00000000-0000-0000-0000-000000000000',
      activatedAt: new Date(),
      lines: { create: buildSamplePriceLines() },
    },
  });
  await db.activePriceList.create({ data: { scope: 'default', priceListId: list.id } });
}
