import { getLocale, getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { Icon } from '../icon';
import { LanguageSwitch } from './language-switch';
import { signOutAction } from './sign-out-action';
import { ThemeToggle } from './theme-toggle';

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('');
}

export async function TopBar({ storeName, merchantNumber, showStaffLink = false }: { storeName: string; merchantNumber: string; showStaffLink?: boolean }) {
  const t = await getTranslations('shell');
  const tStaff = await getTranslations('staff');
  const locale = await getLocale();
  const signOut = signOutAction.bind(null, locale);

  return (
    <header className="top">
      <img className="mlogo lg-l" src="/brand/shiply-logo-light.png" alt="Shiply" width={72} height={26} />
      <img className="mlogo lg-d" src="/brand/shiply-logo-dark.png" alt="" width={72} height={26} />
      <div className="search gsearch">
        <Icon name="search" />
        {/* Search arrives with the orders list; the box is a placeholder for now. */}
        <input className="input" type="search" placeholder={t('searchPlaceholder')} aria-label={t('searchPlaceholder')} disabled />
      </div>
      <div className="grow" />
      {showStaffLink ? (
        <Link className="btn sm hide-sm" href="/staff" data-testid="open-staff-area">
          {tStaff('openStaffArea')}
        </Link>
      ) : null}
      <Link className="btn lime hide-sm" href="/orders/new">
        <Icon name="plus" size={16} strokeWidth={2.4} />
        {t('createOrder')}
      </Link>
      <LanguageSwitch />
      <ThemeToggle />
      <button type="button" className="icon-btn" aria-label={t('notifications')}>
        <Icon name="bell" size={20} />
      </button>
      <div className="store">
        <span className="avatar">{initialsOf(storeName)}</span>
        <span className="cell2">
          <b>{storeName}</b>
          <span>
            {t('merchantNumber')} #{merchantNumber}
          </span>
        </span>
      </div>
      <form action={signOut}>
        <button type="submit" className="icon-btn" aria-label={t('signOut')} title={t('signOut')} data-testid="sign-out">
          <Icon name="logout" size={20} />
        </button>
      </form>
    </header>
  );
}
