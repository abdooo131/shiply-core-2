import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { ReactNode } from 'react';
import { requireUser } from '@/accounts';
import { routing } from '@/i18n/routing';
import { isStaff, staffSections } from '@/staff/staff-queues';
import { Icon } from '@/ui/icon';
import { LanguageSwitch } from '@/ui/shell/language-switch';
import { signOutAction } from '@/ui/shell/sign-out-action';
import { ThemeToggle } from '@/ui/shell/theme-toggle';
import { StaffNav, StaffTabs } from './staff-nav';

// Shiply's own team only. Anyone else gets "not found", so the area is not advertised.
export default async function StaffLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const safeLocale = routing.locales.find((known) => known === locale) ?? routing.defaultLocale;
  const user = await requireUser(safeLocale);
  if (!isStaff(user)) notFound();
  const t = await getTranslations('staff');
  const tShell = await getTranslations('shell');
  const sections = staffSections(user);
  const signOut = signOutAction.bind(null, safeLocale);

  return (
    <div className="app">
      <StaffNav sections={sections} hasMerchant={user.memberships.length > 0} />
      <div className="main">
        <header className="top">
          <img className="mlogo lg-l" src="/brand/shiply-logo-light.png" alt="Shiply" width={72} height={26} />
          <img className="mlogo lg-d" src="/brand/shiply-logo-dark.png" alt="" width={72} height={26} />
          <span className="pill p-blue" data-testid="staff-badge">{t('areaName')}</span>
          <span className="small muted hide-sm">{t('standIn')}</span>
          <div className="grow" />
          <LanguageSwitch />
          <ThemeToggle />
          <div className="store hide-sm">
            <span className="cell2">
              <b>{user.name}</b>
              <span>{user.staffRoles.join(' · ')}</span>
            </span>
          </div>
          <form action={signOut}>
            <button type="submit" className="icon-btn" aria-label={tShell('signOut')} title={tShell('signOut')} data-testid="sign-out">
              <Icon name="logout" size={20} />
            </button>
          </form>
        </header>
        <StaffTabs sections={sections} />
        <main className="page">{children}</main>
      </div>
    </div>
  );
}
