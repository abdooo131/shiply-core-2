import type { OrderStatus } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { MERCHANT_STATUS, ORDER_TABS, TAB_STATUSES, merchantStatusOf } from './merchant-status';

const ALL_STATUSES: OrderStatus[] = [
  'new',
  'pickup_requested',
  'picked_up',
  'in_progress',
  'out_for_delivery',
  'attempt_failed',
  'awaiting_merchant_action',
  'rescheduled',
  'delivered',
  'returning',
  'returned',
  'canceled',
];

describe('merchantStatusOf', () => {
  it('gives every internal status a label and a pill tone', () => {
    for (const status of ALL_STATUSES) {
      const shown = merchantStatusOf(status);
      expect(shown.key).toBeTruthy();
      expect(['ok', 'info', 'warn', 'bad', 'grey', 'blue']).toContain(shown.tone);
    }
    expect(Object.keys(MERCHANT_STATUS).sort()).toEqual([...ALL_STATUSES].sort());
  });

  it('uses the mockup colours', () => {
    expect(merchantStatusOf('new')).toEqual({ key: 'new', tone: 'blue' });
    expect(merchantStatusOf('picked_up').tone).toBe('info');
    expect(merchantStatusOf('out_for_delivery').tone).toBe('warn');
    expect(merchantStatusOf('awaiting_merchant_action')).toEqual({ key: 'awaiting_merchant_action', tone: 'bad' });
    expect(merchantStatusOf('delivered').tone).toBe('ok');
    expect(merchantStatusOf('returning').tone).toBe('bad');
    expect(merchantStatusOf('returned').tone).toBe('grey');
    expect(merchantStatusOf('canceled').tone).toBe('grey');
  });
});

describe('ORDER_TABS', () => {
  it('lists the ten tabs in order', () => {
    expect(ORDER_TABS).toEqual([
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
    ]);
  });

  it('puts every status in exactly one status tab', () => {
    const statusTabs = ORDER_TABS.filter((tab) => tab !== 'all' && tab !== 'not_printed');
    const covered = statusTabs.flatMap((tab) => TAB_STATUSES[tab]);
    expect([...covered].sort()).toEqual([...ALL_STATUSES].sort());
    expect(TAB_STATUSES.all).toHaveLength(ALL_STATUSES.length);
    expect(TAB_STATUSES.not_printed).toHaveLength(ALL_STATUSES.length);
    expect(TAB_STATUSES.in_progress).toEqual(['picked_up', 'in_progress', 'attempt_failed', 'rescheduled']);
  });
});
