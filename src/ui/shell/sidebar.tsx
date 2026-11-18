'use client';

import { useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';
import { Icon } from '../icon';
import { ACCOUNT_NAV, GROW_NAV, isNavItemActive, MAIN_NAV, type NavItem } from './nav-items';

export function Sidebar() {
  const t = useTranslations('shell');
  const pathname = usePathname();

  const renderLink = (item: NavItem) => {
    const active = isNavItemActive(item, pathname);
    return (
      <Link key={item.key} href={item.href} className={active ? 'nav on' : 'nav'} aria-current={active ? 'page' : undefined}>
        <Icon name={item.icon} />
        <span>{t(item.key)}</span>
      </Link>
    );
  };

  return (
    <aside className="side" aria-label={t('mainNavigation')}>
      <Link className="brand" href="/" aria-label="Shiply">
        <img className="lg-l" src="/brand/shiply-logo-light.png" alt="Shiply" width={88} height={32} />
        <img className="lg-d" src="/brand/shiply-logo-dark.png" alt="" width={88} height={32} />
      </Link>
      <div className="ins-badge">
        <Icon name="shield" size={15} />
        <span className="cell2">
          <b>{t('insuranceActive')}</b>
          <span>{t('insuranceCover')}</span>
        </span>
      </div>
      {MAIN_NAV.map(renderLink)}
      <div className="label">{t('groupGrow')}</div>
      {GROW_NAV.map(renderLink)}
      <div className="label">{t('groupAccount')}</div>
      {ACCOUNT_NAV.map(renderLink)}
      <div className="help-card">
        <b>{t('helpTitle')}</b>
        <span>{t('helpText')}</span>
        <Link className="btn lime sm" style={{ alignSelf: 'flex-start' }} href="/support">
          {t('chatWithUs')}
        </Link>
      </div>
    </aside>
  );
}
