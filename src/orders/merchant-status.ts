import type { OrderStatus } from '@prisma/client';

export type StatusTone = 'ok' | 'info' | 'warn' | 'bad' | 'grey' | 'blue';
// The merchant label key is the internal status name; the screens map it to Arabic and English text.
export type MerchantStatus = { key: OrderStatus; tone: StatusTone };

// Pill colours follow the mockup STATUS map. A failed attempt shows like "Unclear address" (bad):
// the merchant may need to call the customer.
export const MERCHANT_STATUS: Record<OrderStatus, MerchantStatus> = {
  new: { key: 'new', tone: 'blue' },
  pickup_requested: { key: 'pickup_requested', tone: 'blue' },
  picked_up: { key: 'picked_up', tone: 'info' },
  in_progress: { key: 'in_progress', tone: 'info' },
  out_for_delivery: { key: 'out_for_delivery', tone: 'warn' },
  attempt_failed: { key: 'attempt_failed', tone: 'bad' },
  awaiting_merchant_action: { key: 'awaiting_merchant_action', tone: 'bad' },
  rescheduled: { key: 'rescheduled', tone: 'warn' },
  delivered: { key: 'delivered', tone: 'ok' },
  returning: { key: 'returning', tone: 'bad' },
  returned: { key: 'returned', tone: 'grey' },
  canceled: { key: 'canceled', tone: 'grey' },
};

export function merchantStatusOf(status: OrderStatus): MerchantStatus {
  return MERCHANT_STATUS[status];
}

export const ORDER_TABS = [
  'all',
  'needs_action',
  'new',
  'in_progress',
  'out_for_delivery',
  'coming_back',
  'delivered',
  'returned',
  'canceled',
  'not_printed',
] as const;

export type OrderTab = (typeof ORDER_TABS)[number];

const EVERY_STATUS = Object.keys(MERCHANT_STATUS) as OrderStatus[];

// "all" and "not_printed" cover every status; not_printed additionally needs no LabelPrint row.
export const TAB_STATUSES: Record<OrderTab, readonly OrderStatus[]> = {
  all: EVERY_STATUS,
  needs_action: ['awaiting_merchant_action'],
  new: ['new', 'pickup_requested'],
  in_progress: ['picked_up', 'in_progress', 'attempt_failed', 'rescheduled'],
  out_for_delivery: ['out_for_delivery'],
  coming_back: ['returning'],
  delivered: ['delivered'],
  returned: ['returned'],
  canceled: ['canceled'],
  not_printed: EVERY_STATUS,
};
