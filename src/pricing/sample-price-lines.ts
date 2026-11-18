// The mockup's sample prices (owner decisions 2 and 5, 18 Nov 2026), used until
// Shiply's real price list is approved. Kept free of runtime imports: the
// plain-Node seed script loads this file directly.
import type { OrderType, PackageSize } from '@prisma/client';

export type PriceLine = { zoneCode: string; size: PackageSize; orderType: OrderType; shippingPiasters: number };

const PIASTERS_PER_POUND = 100;

export const ZONE_CODES = ['cairo_giza', 'alexandria', 'delta', 'canal', 'upper_egypt', 'red_sea_sinai'] as const;
export const PACKAGE_SIZES: readonly PackageSize[] = ['small', 'medium', 'large', 'light_bulky', 'heavy_bulky'];
export const ORDER_TYPES: readonly OrderType[] = ['deliver', 'pick_and_choose', 'exchange', 'return', 'sign_and_return', 'cash_collection'];

// EGP, from the mockup's BASE and ZONE_ADD.
const BASE_POUNDS: Record<PackageSize, number> = { small: 68, medium: 76, large: 88, light_bulky: 150, heavy_bulky: 330 };
const ZONE_EXTRA_POUNDS: Record<(typeof ZONE_CODES)[number], number> = {
  cairo_giza: 0, alexandria: 7, delta: 10, canal: 12, upper_egypt: 26, red_sea_sinai: 40,
};
const EXCHANGE_EXTRA_POUNDS = 12;
const RETURN_DISCOUNT_POUNDS = 4;
const CASH_COLLECTION_BASE_POUNDS = 55;

function samplePounds(zone: (typeof ZONE_CODES)[number], size: PackageSize, orderType: OrderType): number {
  const deliver = BASE_POUNDS[size] + ZONE_EXTRA_POUNDS[zone];
  switch (orderType) {
    case 'deliver':
    case 'pick_and_choose':
      return deliver;
    case 'exchange':
    case 'sign_and_return':
      return deliver + EXCHANGE_EXTRA_POUNDS;
    case 'return':
      return deliver - RETURN_DISCOUNT_POUNDS;
    case 'cash_collection':
      return CASH_COLLECTION_BASE_POUNDS + ZONE_EXTRA_POUNDS[zone];
  }
}

export function buildSamplePriceLines(): PriceLine[] {
  return ZONE_CODES.flatMap((zoneCode) =>
    PACKAGE_SIZES.flatMap((size) =>
      ORDER_TYPES.map((orderType) => ({
        zoneCode,
        size,
        orderType,
        shippingPiasters: samplePounds(zoneCode, size, orderType) * PIASTERS_PER_POUND,
      })),
    ),
  );
}
