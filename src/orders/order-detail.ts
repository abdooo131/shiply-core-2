import type { OrderStatus, OrderType } from '@prisma/client';
import { requireMerchantAccess, type SessionUser } from '@/accounts';
import { AppError } from '@/shared/app-error';
import { db } from '@/shared/db';
import { getOrderTimeline, type OrderTimelineEntry } from './order-status';

const ORDER_NUMBER_PATTERN = /^\d{10}$/;
const MERCHANT_CANCELLABLE: ReadonlySet<OrderStatus> = new Set(['new', 'pickup_requested']);
// An Exchange or Return is a follow-up to an order the customer already received.
const FOLLOW_UP_ALLOWED: ReadonlySet<OrderStatus> = new Set(['delivered']);
// An order has at most a handful of follow-ups; the cap keeps the page bounded.
const MAX_LINKED_ORDERS = 50;

export type LinkedOrder = { number: string; type: OrderType; direction: 'original' | 'follow_up' };

export type OrderFees = {
  shippingPiasters: number;
  openPackagePiasters: number;
  codFeePiasters: number;
  insurancePiasters: number;
  vatPiasters: number;
  totalFeePiasters: number;
};

export type MerchantOrderActions = { cancel: boolean; answerAwaiting: boolean; createExchange: boolean; createReturn: boolean };

export type OrderDetail = {
  id: string;
  number: string;
  type: OrderType;
  status: OrderStatus;
  customerName: string;
  customerMobile: string;
  addressText: string;
  addressExtra: string | null;
  size: string;
  description: string | null;
  codAmountPiasters: number;
  refundPiasters: number;
  allowOpenPackage: boolean;
  depositRequired: boolean;
  insuredValuePiasters: number;
  merchantReference: string | null;
  courierNote: string | null;
  attempts: number;
  expectedDeliveryDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
  fees: OrderFees;
  area: { nameEn: string; nameAr: string; governorate: { nameEn: string; nameAr: string } };
  items: { nameEn: string; nameAr: string; quantity: number; pricePiasters: number }[];
  linkedOrders: LinkedOrder[];
  timeline: OrderTimelineEntry[];
  isPrinted: boolean;
  allowedActions: MerchantOrderActions;
};

function allowedActionsFor(status: OrderStatus): MerchantOrderActions {
  return {
    cancel: MERCHANT_CANCELLABLE.has(status),
    answerAwaiting: status === 'awaiting_merchant_action',
    createExchange: FOLLOW_UP_ALLOWED.has(status),
    createReturn: FOLLOW_UP_ALLOWED.has(status),
  };
}

export async function getOrderDetail(user: SessionUser, merchantId: string, orderNumber: string): Promise<OrderDetail> {
  requireMerchantAccess(user, merchantId, 'orders');
  if (!ORDER_NUMBER_PATTERN.test(orderNumber)) throw new AppError('not_found', 404);

  const order = await db.order.findFirst({
    where: { number: orderNumber, merchantId },
    include: {
      area: { select: { nameEn: true, nameAr: true, governorate: { select: { nameEn: true, nameAr: true } } } },
      items: { select: { nameEn: true, nameAr: true, quantity: true, pricePiasters: true }, orderBy: { id: 'asc' } },
      linksFrom: { take: MAX_LINKED_ORDERS, select: { toOrder: { select: { number: true, type: true } } } },
      linksTo: { take: MAX_LINKED_ORDERS, select: { fromOrder: { select: { number: true, type: true } } } },
      labelPrints: { take: 1, select: { id: true } },
    },
  });
  // Another merchant's order looks exactly like a missing one.
  if (!order) throw new AppError('not_found', 404);

  const timeline = await getOrderTimeline(user, order.id);
  const linkedOrders: LinkedOrder[] = [
    ...order.linksFrom.map(({ toOrder }) => ({ number: toOrder.number, type: toOrder.type, direction: 'original' as const })),
    ...order.linksTo.map(({ fromOrder }) => ({ number: fromOrder.number, type: fromOrder.type, direction: 'follow_up' as const })),
  ];

  return {
    id: order.id,
    number: order.number,
    type: order.type,
    status: order.status,
    customerName: order.customerName,
    customerMobile: order.customerMobile,
    addressText: order.addressText,
    addressExtra: order.addressExtra,
    size: order.size,
    description: order.description,
    codAmountPiasters: order.codAmountPiasters,
    refundPiasters: order.refundPiasters,
    allowOpenPackage: order.allowOpenPackage,
    depositRequired: order.depositRequired,
    insuredValuePiasters: order.insuredValuePiasters,
    merchantReference: order.merchantReference,
    courierNote: order.courierNote,
    attempts: order.attempts,
    expectedDeliveryDate: order.expectedDeliveryDate,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    fees: {
      shippingPiasters: order.shippingPiasters,
      openPackagePiasters: order.openPackagePiasters,
      codFeePiasters: order.codFeePiasters,
      insurancePiasters: order.insurancePiasters,
      vatPiasters: order.vatPiasters,
      totalFeePiasters: order.totalFeePiasters,
    },
    area: order.area,
    items: order.items,
    linkedOrders,
    timeline,
    isPrinted: order.labelPrints.length > 0,
    allowedActions: allowedActionsFor(order.status),
  };
}
