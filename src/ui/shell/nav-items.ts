import type { IconName } from '../icon';

export type NavKey =
  | 'home' | 'orders' | 'pickups' | 'wallet' | 'packaging' | 'credits'
  | 'products' | 'analytics' | 'applications' | 'capital' | 'support' | 'settings';

export type NavItem = { key: NavKey; href: string; icon: IconName };

// Same order and grouping as the approved mockup's sidebar.
export const MAIN_NAV: readonly NavItem[] = [
  { key: 'home', href: '/', icon: 'home' },
  { key: 'orders', href: '/orders', icon: 'box' },
  { key: 'pickups', href: '/pickups', icon: 'truck' },
  { key: 'wallet', href: '/wallet', icon: 'wallet' },
  { key: 'packaging', href: '/packaging', icon: 'bag' },
  { key: 'credits', href: '/credits', icon: 'coin' },
];
export const GROW_NAV: readonly NavItem[] = [
  { key: 'products', href: '/products', icon: 'tag' },
  { key: 'analytics', href: '/analytics', icon: 'chart' },
  { key: 'applications', href: '/applications', icon: 'apps' },
  { key: 'capital', href: '/capital', icon: 'rise' },
];
export const ACCOUNT_NAV: readonly NavItem[] = [
  { key: 'support', href: '/support', icon: 'help' },
  { key: 'settings', href: '/settings', icon: 'gear' },
];

export const ALL_NAV: readonly NavItem[] = [...MAIN_NAV, ...GROW_NAV, ...ACCOUNT_NAV];

const BUILT_SECTIONS: ReadonlySet<NavKey> = new Set(['home', 'settings']);

// Sections that do not have their own screen yet show the coming-soon page.
export const COMING_SOON_SECTIONS: ReadonlySet<string> = new Set(
  ALL_NAV.filter((item) => !BUILT_SECTIONS.has(item.key)).map((item) => item.href.slice(1)),
);

export function isNavItemActive(item: NavItem, pathname: string): boolean {
  if (item.href === '/') return pathname === '/';
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}
