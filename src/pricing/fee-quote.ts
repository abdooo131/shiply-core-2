import type { OrderType, PackageSize } from '@prisma/client';
import { getArea } from '@/location';
import { AppError } from '@/shared/app-error';
import { addVatPiasters, basisPointsOfPiasters } from '@/shared/money';
import { getShippingPiasters } from './price-lists';
import { getSettingValues } from './settings-values';

export type FeeQuote = {
  zoneCode: string;
  shippingPiasters: number;
  openPackagePiasters: number;
  codFeePiasters: number;
  insurancePiasters: number;
  netPiasters: number;
  vatPiasters: number;
  totalPiasters: number;
};

export type FeeQuoteInput = {
  merchantId: string;
  areaId: string;
  size: PackageSize;
  orderType: OrderType;
  codAmountPiasters: number;
  allowOpenPackage: boolean;
  insuredValuePiasters: number;
};

const FEE_SETTING_KEYS = [
  'vat_basis_points',
  'cod_fee_basis_points',
  'cod_fee_threshold_piasters',
  'open_package_fee_piasters',
  'insurance_basis_points',
] as const;

function isNonNegativeWholeNumber(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

// Everything Shiply charges for one order. Each fee line is rounded once; VAT is on their sum.
export async function quoteOrderFees(input: FeeQuoteInput): Promise<FeeQuote> {
  if (!isNonNegativeWholeNumber(input.codAmountPiasters) || !isNonNegativeWholeNumber(input.insuredValuePiasters)) {
    throw new AppError('invalid_input');
  }
  const area = await getArea(input.areaId);
  if (!area) throw new AppError('area_not_found', 404);
  if (!area.isServed) throw new AppError('area_not_served');

  const [shippingPiasters, settings] = await Promise.all([
    getShippingPiasters(input.merchantId, area.zoneCode, input.size, input.orderType),
    getSettingValues(FEE_SETTING_KEYS, input.merchantId),
  ]);

  const openPackagePiasters = input.allowOpenPackage ? settings.open_package_fee_piasters : 0;
  // Owner decision 4: the COD fee applies only to the cash above the threshold.
  const cashAboveThreshold = Math.max(0, input.codAmountPiasters - settings.cod_fee_threshold_piasters);
  const codFeePiasters = basisPointsOfPiasters(cashAboveThreshold, settings.cod_fee_basis_points);
  const insurancePiasters = basisPointsOfPiasters(input.insuredValuePiasters, settings.insurance_basis_points);

  const net = shippingPiasters + openPackagePiasters + codFeePiasters + insurancePiasters;
  const { netPiasters, vatPiasters, grossPiasters } = addVatPiasters(net, settings.vat_basis_points);
  return {
    zoneCode: area.zoneCode,
    shippingPiasters,
    openPackagePiasters,
    codFeePiasters,
    insurancePiasters,
    netPiasters,
    vatPiasters,
    totalPiasters: grossPiasters,
  };
}

// Charged when an order comes back undelivered (owner decision: 50% of shipping).
export function returnFeePiasters(shippingPiasters: number, returnFeeBasisPoints: number): number {
  return basisPointsOfPiasters(shippingPiasters, returnFeeBasisPoints);
}
