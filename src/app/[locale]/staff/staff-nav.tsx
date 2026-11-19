'use client';

import { useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';
import { Icon, type IconName } from '@/ui/icon';

export type StaffNavKey = 'overview' | 'orders' | 'pickups' | 'approvals' | 'money' | 'support';

const ICONS: Record<StaffNavKey, IconName> = {
  overview: 'home',
  orders: 'box',
  pickups: 'truck',
  approvals: 'shield',
  money: 'wallet',
  support: 'help',
};

function hrefOf(key: StaffNavKey): string {
  return key === 'overview' ? '/staff' : `/staff/${key}`;
}

function isActive(key: StaffNavKey, pathname: string): boolean {
  const href = hrefOf(key);
  if (key === 'overview') return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

// The staff sidebar: only the sections the signed-in person's role may use.
export function StaffNav({ sections, hasMerchant }: { sections: StaffNavKey[]; hasMerchant: boolean }) {
  const t = useTranslations('staff');
  const pathname = usePathname();
  return (
    <aside className="side" aria-label={t('navLabel')}>
      <Link className="brand" href="/staff" aria-label="Shiply">
        <img className="lg-l" src="/brand/shiply-logo-light.png" alt="Shiply" width={88} height={32} />
        <img className="lg-d" src="/brand/shiply-logo-dark.png" alt="" width={88} height={32} />
      </Link>
      <div className="label">{t('areaName')}</div>
      {(['overview', ...sections] as StaffNavKey[]).map((key) => {
        const active = isActive(key, pathname);
        return (
          <Link key={key} href={hrefOf(key)} className={active ? 'nav on' : 'nav'} aria-current={active ? 'page' : undefined} data-testid={`staff-nav-${key}`}>
            <Icon name={ICONS[key]} />
            <span>{t(`sections.${key}`)}</span>
          </Link>
        );
      })}
      {hasMerchant ? (
        <>
          <div className="label">{t('merchantPortal')}</div>
          <Link href="/" className="nav">
            <Icon name="apps" />
            <span>{t('merchantPortal')}</span>
          </Link>
        </>
      ) : null}
    </aside>
  );
}

// On a phone the sidebar is hidden; the same sections become a scrolling row of tabs.
export function StaffTabs({ sections }: { sections: StaffNavKey[] }) {
  const t = useTranslations('staff');
  const pathname = usePathname();
  return (
    <nav className="tabs staff-tabs" aria-label={t('navLabel')}>
      {(['overview', ...sections] as StaffNavKey[]).map((key) => (
        <Link key={key} href={hrefOf(key)} className={isActive(key, pathname) ? 'tab on' : 'tab'}>
          {t(`sections.${key}`)}
        </Link>
      ))}
    </nav>
  );
}
