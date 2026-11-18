import { AppError } from '@/shared/app-error';
import type { MerchantAccess, SessionUser } from './sessions';

// "business" covers the merchant's own details (names, website); only full access may change them.
export type MerchantNeed = 'orders' | 'finance' | 'team' | 'business';

const ALLOWED_NEEDS: Record<MerchantAccess, ReadonlySet<MerchantNeed>> = {
  full: new Set(['orders', 'finance', 'team', 'business']),
  orders_pickups: new Set(['orders']),
  finance: new Set(['finance']),
};

export function requireMerchantAccess(user: SessionUser, merchantId: string, need: MerchantNeed): void {
  const membership = user.memberships.find((member) => member.merchantId === merchantId);
  if (!membership || !ALLOWED_NEEDS[membership.access].has(need)) {
    throw new AppError('forbidden', 403);
  }
}
