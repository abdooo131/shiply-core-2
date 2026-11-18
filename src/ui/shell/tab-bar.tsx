'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Link, usePathname } from '@/i18n/navigation';
import { Icon } from '../icon';
import { ALL_NAV, isNavItemActive, type NavItem } from './nav-items';

const TAB_KEYS = ['home', 'orders', 'wallet'] as const;

// Phone navigation under 860px: Home, Orders, Create, Wallet, More.
export function TabBar() {
  const t = useTranslations('shell');
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);

  const tabs = TAB_KEYS.map((key) => ALL_NAV.find((item) => item.key === key)).filter(
    (item): item is NavItem => Boolean(item),
  );
  const moreItems = ALL_NAV.filter((item) => !TAB_KEYS.includes(item.key as (typeof TAB_KEYS)[number]));
  const moreActive = moreItems.some((item) => isNavItemActive(item, pathname));

  const renderTab = (item: NavItem) => (
    <Link key={item.key} href={item.href} className={isNavItemActive(item, pathname) ? 'on' : undefined}>
      <Icon name={item.icon} size={20} />
      {t(item.key)}
    </Link>
  );

  return (
    <>
      <nav className="tabbar" aria-label={t('mainNavigation')}>
        {tabs.slice(0, 2).map(renderTab)}
        <Link href="/orders/new" aria-label={t('createOrder')}>
          <span className="fab">
            <Icon name="plus" size={22} strokeWidth={2.6} />
          </span>
        </Link>
        {tabs.slice(2).map(renderTab)}
        <button type="button" className={moreActive ? 'on' : undefined} onClick={() => setMoreOpen((open) => !open)} aria-expanded={moreOpen}>
          <Icon name="menu" size={20} />
          {t('more')}
        </button>
      </nav>
      {moreOpen ? (
        <div className="more-sheet card" role="menu">
          {moreItems.map((item) => (
            <Link key={item.key} href={item.href} className="nav" role="menuitem" onClick={() => setMoreOpen(false)}>
              <Icon name={item.icon} />
              <span>{t(item.key)}</span>
            </Link>
          ))}
        </div>
      ) : null}
    </>
  );
}
