import { requireMerchantAccess, type SessionUser } from '@/accounts';

// The wallet and its proofs of transfer need the merchant's 'finance' access; other members see a no-access card.
export function canSeeWallet(user: SessionUser, merchantId: string | undefined): merchantId is string {
  if (!merchantId) return false;
  try {
    requireMerchantAccess(user, merchantId, 'finance');
    return true;
  } catch {
    return false;
  }
}
