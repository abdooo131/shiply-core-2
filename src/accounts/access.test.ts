import { describe, expect, it } from 'vitest';
import { requireMerchantAccess } from './access';
import type { SessionUser } from './sessions';

function userWith(access: 'full' | 'orders_pickups' | 'finance'): SessionUser {
  return { id: 'u1', name: 'U', language: 'en', staffRoles: [], memberships: [{ merchantId: 'm1', access }] };
}

describe('requireMerchantAccess', () => {
  it('lets full access do everything', () => {
    for (const need of ['orders', 'finance', 'team'] as const) {
      expect(() => requireMerchantAccess(userWith('full'), 'm1', need)).not.toThrow();
    }
  });

  it('limits orders & pickups access to orders', () => {
    expect(() => requireMerchantAccess(userWith('orders_pickups'), 'm1', 'orders')).not.toThrow();
    expect(() => requireMerchantAccess(userWith('orders_pickups'), 'm1', 'finance')).toThrow(
      expect.objectContaining({ code: 'forbidden', status: 403 }),
    );
    expect(() => requireMerchantAccess(userWith('orders_pickups'), 'm1', 'team')).toThrow(
      expect.objectContaining({ code: 'forbidden' }),
    );
  });

  it('limits finance access to finance', () => {
    expect(() => requireMerchantAccess(userWith('finance'), 'm1', 'finance')).not.toThrow();
    expect(() => requireMerchantAccess(userWith('finance'), 'm1', 'orders')).toThrow(
      expect.objectContaining({ code: 'forbidden' }),
    );
  });

  it('refuses a merchant the user does not belong to', () => {
    expect(() => requireMerchantAccess(userWith('full'), 'other-merchant', 'orders')).toThrow(
      expect.objectContaining({ code: 'forbidden' }),
    );
  });
});
