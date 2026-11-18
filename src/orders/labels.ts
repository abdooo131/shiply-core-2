import type { LabelFormat, OrderType, PackageSize } from '@prisma/client';
import { z } from 'zod';
import { requireMerchantAccess, type SessionUser } from '@/accounts';
import { AppError } from '@/shared/app-error';
import { db } from '@/shared/db';

export const MAX_LABELS_PER_PRINT = 100;

const orderIdsSchema = z.array(z.string().uuid()).min(1).max(MAX_LABELS_PER_PRINT);

export type LabelData = {
  orderId: string;
  orderNumber: string;
  merchantNameEn: string;
  merchantNameAr: string;
  customerName: string;
  customerMobile: string;
  addressText: string;
  addressExtra: string | null;
  areaNameEn: string;
  areaNameAr: string;
  governorateNameEn: string;
  governorateNameAr: string;
  cashToCollectPiasters: number;
  cashToGivePiasters: number;
  size: PackageSize;
  type: OrderType;
  courierNote: string | null;
  createdAt: Date;
};

function parseOrderIds(orderIds: string[]): string[] {
  const parsed = orderIdsSchema.safeParse(orderIds);
  if (!parsed.success) throw new AppError('invalid_input');
  return [...new Set(parsed.data)];
}

const labelOrderSelect = {
  id: true,
  number: true,
  merchantId: true,
  customerName: true,
  customerMobile: true,
  addressText: true,
  addressExtra: true,
  codAmountPiasters: true,
  refundPiasters: true,
  cashDirection: true,
  size: true,
  type: true,
  courierNote: true,
  createdAt: true,
  merchant: { select: { nameEn: true, nameAr: true } },
  area: { select: { nameEn: true, nameAr: true, governorate: { select: { nameEn: true, nameAr: true } } } },
} as const;

// Loads the orders and checks the caller may see every one of them. An order of a
// merchant the caller does not belong to is reported as missing, so ids cannot be probed.
async function loadPermittedOrders(user: SessionUser, orderIds: string[]) {
  const ids = parseOrderIds(orderIds);
  const memberMerchantIds = user.memberships.map((member) => member.merchantId);
  const orders = await db.order.findMany({
    where: { id: { in: ids }, merchantId: { in: memberMerchantIds } },
    select: labelOrderSelect,
  });
  if (orders.length !== ids.length) throw new AppError('not_found', 404);
  for (const merchantId of new Set(orders.map((order) => order.merchantId))) {
    requireMerchantAccess(user, merchantId, 'orders');
  }
  const byId = new Map(orders.map((order) => [order.id, order]));
  return ids.map((id) => byId.get(id)!);
}

export async function getLabelData(user: SessionUser, orderIds: string[]): Promise<LabelData[]> {
  const orders = await loadPermittedOrders(user, orderIds);
  return orders.map((order) => {
    const isGivingCash = order.cashDirection === 'give';
    return {
      orderId: order.id,
      orderNumber: order.number,
      merchantNameEn: order.merchant.nameEn,
      merchantNameAr: order.merchant.nameAr,
      customerName: order.customerName,
      customerMobile: order.customerMobile,
      addressText: order.addressText,
      addressExtra: order.addressExtra,
      areaNameEn: order.area.nameEn,
      areaNameAr: order.area.nameAr,
      governorateNameEn: order.area.governorate.nameEn,
      governorateNameAr: order.area.governorate.nameAr,
      cashToCollectPiasters: isGivingCash ? 0 : order.codAmountPiasters,
      cashToGivePiasters: order.refundPiasters + (isGivingCash ? order.codAmountPiasters : 0),
      size: order.size,
      type: order.type,
      courierNote: order.courierNote,
      createdAt: order.createdAt,
    };
  });
}

export async function recordLabelPrint(user: SessionUser, orderIds: string[], format: LabelFormat): Promise<void> {
  const orders = await loadPermittedOrders(user, orderIds);
  await db.labelPrint.createMany({
    data: orders.map((order) => ({ orderId: order.id, format, printedBy: user.id })),
  });
}
