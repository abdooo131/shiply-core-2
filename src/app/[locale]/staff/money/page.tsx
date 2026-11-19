import type { CashOutStatus } from '@prisma/client';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { requireUser } from '@/accounts';
import { Link } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';
import { cairoDateString } from '@/shared/cairo-time';
import { formatPiasters } from '@/shared/money';
import { canUseSection, listStaffCashOuts } from '@/staff/staff-queues';
import { formatCalendarDate } from '../../(portal)/wallet/wallet-formatting';
import { ActionButton } from '../action-button';
import { approveCashOutAction, cancelCashOutAction } from '../actions';
import { firstValue } from '../staff-pager';
import { MarkPaidButton, MoneyTools } from './money-tools';

const TABS: readonly CashOutStatus[] = ['prepared', 'approved', 'paid', 'canceled'];

export default async function StaffMoneyPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const query = await searchParams;
  setRequestLocale(locale);
  const safeLocale = routing.locales.find((known) => known === locale) ?? routing.defaultLocale;
  const user = await requireUser(safeLocale);
  if (!canUseSection(user, 'money')) notFound();
  const t = await getTranslations('staff.money');
  const tab = TABS.find((candidate) => candidate === firstValue(query.status)) ?? 'prepared';
  const rows = await listStaffCashOuts(user, { status: tab });

  return (
    <>
      <div className="page-head">
        <div className="grow">
          <h1>{t('title')}</h1>
          <span className="muted">{t('subtitle')}</span>
        </div>
      </div>

      <MoneyTools today={cairoDateString(new Date())} />

      <section className="card">
        <nav className="tabs" aria-label={t('title')} style={{ padding: '0 16px' }}>
          {TABS.map((candidate) => (
            <Link
              key={candidate}
              className={candidate === tab ? 'tab on' : 'tab'}
              href={{ pathname: '/staff/money', query: { status: candidate } }}
              aria-current={candidate === tab ? 'page' : undefined}
              data-testid={`money-tab-${candidate}`}
            >
              {t(`tabs.${candidate}`)}
            </Link>
          ))}
        </nav>
        {rows.length === 0 ? (
          <div className="empty">{t('empty')}</div>
        ) : (
          <div className="tbl-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('number')}</th>
                  <th>{t('merchant')}</th>
                  <th style={{ textAlign: 'end' }}>{t('amount')}</th>
                  <th>{t('bank')}</th>
                  <th>{t('scheduled')}</th>
                  {tab === 'paid' ? <th>{t('reference')}</th> : <th><span className="sr-only">{t('approve')}</span></th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} data-testid="staff-cash-out">
                    <td><span className="mono">{row.number}</span></td>
                    <td>{safeLocale === 'ar' ? row.merchantNameAr : row.merchantNameEn}</td>
                    <td className="num" style={{ textAlign: 'end' }}><bdi>{formatPiasters(row.amountPiasters, safeLocale)}</bdi></td>
                    <td>
                      <div className="cell2"><b><bdi>{row.bankName}</bdi></b><span><bdi className="mono">{row.ibanMasked}</bdi></span></div>
                    </td>
                    <td>{formatCalendarDate(row.scheduledDate, safeLocale, true)}</td>
                    <td>
                      {tab === 'prepared' ? (
                        <span className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                          <ActionButton action={approveCashOutAction.bind(null, safeLocale, row.id)} label={t('approve')} doneText={t('done')} testId={`approve-${row.number}`} />
                          <ActionButton action={cancelCashOutAction.bind(null, safeLocale, row.id)} label={t('cancel')} doneText={t('done')} variant="danger" />
                        </span>
                      ) : tab === 'approved' ? (
                        <span className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                          <MarkPaidButton cashOutId={row.id} number={row.number} />
                          <ActionButton action={cancelCashOutAction.bind(null, safeLocale, row.id)} label={t('cancel')} doneText={t('done')} variant="danger" />
                        </span>
                      ) : tab === 'paid' ? (
                        <bdi className="mono">{row.bankReference ?? '—'}</bdi>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
