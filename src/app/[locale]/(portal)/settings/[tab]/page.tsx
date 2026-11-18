import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { ReactNode } from 'react';
import { requireUser, type SessionUser } from '@/accounts';
import { Link } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';
import { getMerchantProfile, listBankAccounts, listTeam } from '@/merchants';
import { getActivePriceLines, getSettingValues } from '@/pricing';
import { db } from '@/shared/db';
import { formatPiasters } from '@/shared/money';
import { Icon } from '@/ui/icon';
import { Pill } from '@/ui/pill';
import { ComingSoon } from '@/ui/shell/coming-soon';
import { BankForm } from '../forms/bank-form';
import { BusinessForm } from '../forms/business-form';
import { InviteForm } from '../forms/invite-form';
import { MemberActions } from '../forms/member-actions';
import { PasswordForm } from '../forms/password-form';
import { ThemeOptions } from '../forms/theme-options';
import { PricingTable } from '../pricing-table';
import { canOpenTab, COMING_SOON_TABS, isSettingsTab, SETTINGS_TABS, type SettingsTab } from '../settings-tabs';

type Translate = Awaited<ReturnType<typeof getTranslations<'settings'>>>;

function Section({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <div className="settings-sec">
      <div>
        <h2>{title}</h2>
        <p className="small muted">{hint}</p>
      </div>
      <div>{children}</div>
    </div>
  );
}

function NoAccess({ t }: { t: Translate }) {
  return (
    <section className="card soon">
      <span className="ic">
        <Icon name="shield" size={26} />
      </span>
      <h2>{t('noAccessTitle')}</h2>
      <p className="muted" style={{ margin: 0 }}>{t('noAccessText')}</p>
    </section>
  );
}

function PreferencesTab({ t, locale }: { t: Translate; locale: string }) {
  return (
    <>
      <Section title={t('language')} hint={t('languageHint')}>
        <div className="g2">
          <Link href="/settings/preferences" locale="ar" className={locale === 'ar' ? 'opt on' : 'opt'} lang="ar">
            <b>العربية</b>
          </Link>
          <Link href="/settings/preferences" locale="en" className={locale === 'en' ? 'opt on' : 'opt'} lang="en">
            <b>English</b>
          </Link>
        </div>
      </Section>
      <Section title={t('theme')} hint={t('themeHint')}>
        <ThemeOptions />
      </Section>
    </>
  );
}

async function ProfileTab({ t, user }: { t: Translate; user: SessionUser }) {
  const details = await db.user.findUniqueOrThrow({ where: { id: user.id }, select: { name: true, email: true, mobile: true } });
  return (
    <>
      <Section title={t('personal')} hint={t('personalHint')}>
        <div className="g2">
          <div className="cell2"><span className="small muted">{t('fullName')}</span><b>{details.name}</b></div>
          <div className="cell2"><span className="small muted">{t('email')}</span><b dir="ltr">{details.email ?? t('notSet')}</b></div>
          <div className="cell2"><span className="small muted">{t('mobile')}</span><b dir="ltr">{details.mobile ?? t('notSet')}</b></div>
        </div>
      </Section>
      <Section title={t('password')} hint={t('passwordHint')}>
        <PasswordForm />
      </Section>
    </>
  );
}

async function TeamTab({ t, user, merchantId, after }: { t: Translate; user: SessionUser; merchantId: string; after?: string }) {
  const { members: team, nextCursor } = await listTeam(user, merchantId, { after });
  return (
    <>
      <section className="card" style={{ overflow: 'hidden' }}>
        <div className="card-h b"><h2 className="grow">{t('team')}</h2></div>
        <div className="tbl-wrap">
          <table>
            <thead>
              <tr><th>{t('member')}</th><th>{t('email')}</th><th>{t('access')}</th><th>{t('status')}</th><th /></tr>
            </thead>
            <tbody>
              {team.map((member) => (
                <tr key={member.userId}>
                  <td><b>{member.name}</b>{member.userId === user.id ? <span className="muted small"> · {t('you')}</span> : null}</td>
                  <td dir="ltr">{member.email ?? member.mobile ?? '—'}</td>
                  <td>{t(`accessLevels.${member.access}`)}</td>
                  <td><Pill tone="ok">{t(`statuses.${member.status}`)}</Pill></td>
                  <td>
                    {member.userId === user.id ? null : (
                      <MemberActions memberUserId={member.userId} access={member.access} memberName={member.name} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {nextCursor ? (
          <div className="card-b">
            <Link className="btn sm" href={{ pathname: '/settings/team', query: { after: nextCursor } }}>
              {t('showMore')}
            </Link>
          </div>
        ) : null}
      </section>
      <Section title={t('inviteTitle')} hint={t('inviteHint')}>
        <InviteForm />
      </Section>
    </>
  );
}

async function PricingTab({ merchantId, locale }: { merchantId: string; locale: string }) {
  const t = await getTranslations('pricing');
  const [zones, lines, settings, merchant] = await Promise.all([
    db.pricingZone.findMany({ orderBy: { sortOrder: 'asc' }, select: { code: true, nameEn: true, nameAr: true } }),
    getActivePriceLines(merchantId),
    getSettingValues(['vat_basis_points', 'cod_fee_basis_points', 'cod_fee_threshold_piasters', 'open_package_fee_piasters'], merchantId),
    db.merchant.findUniqueOrThrow({ where: { id: merchantId }, select: { cashOutSchedule: true } }),
  ]);
  const moneyLocale = locale === 'ar' ? 'ar' : 'en';
  // Isolated left-to-right so "1%" does not turn into "%1" inside Arabic text.
  const percent = `⁦${settings.cod_fee_basis_points / 100}%⁩`;
  return (
    <div className="split" style={{ marginTop: 20 }}>
      <PricingTable
        zones={zones.map((zone) => ({ code: zone.code, name: locale === 'ar' ? zone.nameAr : zone.nameEn }))}
        lines={lines}
        vatBasisPoints={settings.vat_basis_points}
      />
      <div className="cell2" style={{ gap: 16 }}>
        <section className="card stat">
          <span className="k"><i><Icon name="wallet" size={16} /></i>{t('cashOutSchedule')}</span>
          <b>{t(`schedules.${merchant.cashOutSchedule}`)}</b>
        </section>
        <section className="card stat">
          <span className="k"><i><Icon name="coin" size={16} /></i>{t('codFeeTitle', { percent })}</span>
          <span className="foot">
            {t('codFeeText', { threshold: formatWholePounds(settings.cod_fee_threshold_piasters, moneyLocale) })}
          </span>
        </section>
        <section className="card stat">
          <span className="k"><i><Icon name="box" size={16} /></i>{t('openPackageTitle')}</span>
          <span className="foot">{t('openPackageText', { amount: formatPiasters(settings.open_package_fee_piasters, moneyLocale) })}</span>
        </section>
      </div>
    </div>
  );
}

// "EGP 3,000" rather than "EGP 3,000.00" for round thresholds in sentences.
function formatWholePounds(amountPiasters: number, locale: 'en' | 'ar'): string {
  return formatPiasters(amountPiasters, locale).replace(/\.00(?=\D|$)/, '');
}

async function PayoutsTab({ t, user, merchantId }: { t: Translate; user: SessionUser; merchantId: string }) {
  const accounts = await listBankAccounts(user, merchantId);
  return (
    <Section title={t('bankAccount')} hint={t('bankHint')}>
      {accounts.length === 0 ? <p className="muted" style={{ margin: 0 }}>{t('noBankAccount')}</p> : null}
      {accounts.map((account) => (
        <div className="opt" key={account.id} style={{ cursor: 'default' }}>
          <span className="thumb"><Icon name="wallet" size={20} /></span>
          <span className="cell2" style={{ flex: 1 }}>
            <b>{account.bankName}</b>
            <span>
              {account.holderName} · <span className="mono">{account.maskedIban}</span>
            </span>
          </span>
          <Pill tone={account.status === 'active' ? 'ok' : 'warn'}>{t(`bankStatuses.${account.status}`)}</Pill>
        </div>
      ))}
      <BankForm />
    </Section>
  );
}

export default async function SettingsTabPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; tab: string }>;
  searchParams: Promise<{ after?: string | string[] }>;
}) {
  const { locale, tab } = await params;
  const { after: afterParam } = await searchParams;
  // Only a single, well-formed id is accepted as a page cursor.
  const after = typeof afterParam === 'string' && /^[0-9a-f-]{36}$/i.test(afterParam) ? afterParam : undefined;
  setRequestLocale(locale);
  if (!isSettingsTab(tab)) notFound();

  const safeLocale = routing.locales.find((known) => known === locale) ?? routing.defaultLocale;
  const user = await requireUser(safeLocale);
  const merchantId = user.memberships[0]?.merchantId ?? null;
  const t = await getTranslations('settings');
  const visibleTabs = SETTINGS_TABS.filter((candidate) => canOpenTab(user, merchantId, candidate));

  const renderTab = async (current: SettingsTab): Promise<ReactNode> => {
    if (!canOpenTab(user, merchantId, current)) return <NoAccess t={t} />;
    if (COMING_SOON_TABS.has(current)) return <ComingSoon title={t(`tabs.${current}`)} icon="gear" />;
    if (current === 'preferences') return <PreferencesTab t={t} locale={safeLocale} />;
    if (current === 'profile') return <ProfileTab t={t} user={user} />;
    if (!merchantId) return <NoAccess t={t} />;
    if (current === 'business') {
      return (
        <Section title={t('businessDetails')} hint={t('businessHint')}>
          <BusinessForm profile={await getMerchantProfile(merchantId)} />
        </Section>
      );
    }
    if (current === 'team') return <TeamTab t={t} user={user} merchantId={merchantId} after={after} />;
    if (current === 'pricing') return <PricingTab merchantId={merchantId} locale={safeLocale} />;
    return <PayoutsTab t={t} user={user} merchantId={merchantId} />;
  };

  return (
    <>
      <h1>{t('title')}</h1>
      <nav className="tabs" aria-label={t('title')}>
        {visibleTabs.map((candidate) => (
          <Link
            key={candidate}
            href={`/settings/${candidate}`}
            className={candidate === tab ? 'tab on' : 'tab'}
            aria-current={candidate === tab ? 'page' : undefined}
          >
            {t(`tabs.${candidate}`)}
          </Link>
        ))}
      </nav>
      <div>{await renderTab(tab)}</div>
    </>
  );
}
