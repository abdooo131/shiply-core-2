import { AppError } from '@/shared/app-error';
import type { MerchantAccess, SessionUser } from './sessions';

export type MerchantNeed = 'orders' | 'finance' | 'team';

const ALLOWED_NEEDS: Record<MerchantAccess, ReadonlySet<MerchantNeed>> = {
  full: new Set(['orders', 'finance', 'team']),
  orders_pickups: new Set(['orders']),
  finance: new Set(['finance']),
};

export function requireMerchantAccess(user: SessionUser, merchantId: string, need: MerchantNeed): void {
  const membership = user.memberships.find((member) => member.merchantId === merchantId);
  if (!membership || !ALLOWED_NEEDS[membership.access].has(need)) {
    throw new AppError('forbidden', 403);
  }
}
