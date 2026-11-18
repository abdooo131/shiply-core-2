import { requireMerchantAccess, type MerchantNeed, type SessionUser } from '@/accounts';

export const SETTINGS_TABS = [
  'preferences', 'profile', 'business', 'security', 'pricing', 'payouts', 'billing', 'team', 'api',
] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];

// Tabs whose screens are built in later plans.
export const COMING_SOON_TABS: ReadonlySet<SettingsTab> = new Set(['security', 'billing', 'api']);

// Tabs that need a particular merchant access; the rest are open to every member.
const TAB_NEEDS: Partial<Record<SettingsTab, MerchantNeed>> = {
  business: 'business',
  payouts: 'finance',
  team: 'team',
  pricing: 'finance',
  billing: 'finance',
  api: 'business',
};

export function isSettingsTab(value: string): value is SettingsTab {
  return (SETTINGS_TABS as readonly string[]).includes(value);
}

export function canOpenTab(user: SessionUser, merchantId: string | null, tab: SettingsTab): boolean {
  const need = TAB_NEEDS[tab];
  if (!need) return true;
  if (!merchantId) return false;
  try {
    requireMerchantAccess(user, merchantId, need);
    return true;
  } catch {
    return false;
  }
}
