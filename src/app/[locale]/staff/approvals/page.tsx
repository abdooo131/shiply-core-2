import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { requireUser } from '@/accounts';
import { routing } from '@/i18n/routing';
import { formatCairo } from '@/shared/cairo-time';
import { canUseSection, listPendingBankAccounts, listPendingPriceLists } from '@/staff/staff-queues';
import { ActionButton } from '../action-button';
import { approveBankAccountAction, approvePriceListAction } from '../actions';

export default async function StaffApprovalsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const safeLocale = routing.locales.find((known) => known === locale) ?? routing.defaultLocale;
  const user = await requireUser(safeLocale);
  if (!canUseSection(user, 'approvals')) notFound();
  const t = await getTranslations('staff.approvals');
  const [banks, priceLists] = await Promise.all([listPendingBankAccounts(user), listPendingPriceLists(user)]);
  const nameOf = (row: { merchantNameEn: string | null; merchantNameAr: string | null }) =>
    (safeLocale === 'ar' ? row.merchantNameAr : row.merchantNameEn) ?? t('defaultList');

  return (
    <>
      <div className="page-head">
        <div className="grow">
          <h1>{t('title')}</h1>
          <span className="muted">{t('subtitle')}</span>
        </div>
      </div>

      <section className="card" style={{ marginBottom: 16 }} aria-labelledby="bank-title">
        <div className="card-h"><h2 id="bank-title">{t('bankTitle')}</h2></div>
        {banks.length === 0 ? (
          <div className="empty">{t('emptyBank')}</div>
        ) : (
          <div className="tbl-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('merchant')}</th>
                  <th>{t('bank')}</th>
                  <th>{t('holder')}</th>
                  <th>{t('iban')}</th>
                  <th>{t('requested')}</th>
                  <th><span className="sr-only">{t('approve')}</span></th>
                </tr>
              </thead>
              <tbody>
                {banks.map((bank) => (
                  <tr key={bank.id} data-testid="pending-bank">
                    <td>{nameOf(bank)}</td>
                    <td><bdi>{bank.bankName}</bdi></td>
                    <td><bdi>{bank.holderName}</bdi></td>
                    <td><bdi className="mono">{bank.ibanMasked}</bdi></td>
                    <td className="small">{formatCairo(bank.createdAt, safeLocale, 'dateTime')}</td>
                    <td>
                      <ActionButton
                        action={approveBankAccountAction.bind(null, safeLocale, bank.id)}
                        label={t('approve')}
                        doneText={t('approved')}
                        testId="approve-bank"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card" aria-labelledby="price-title">
        <div className="card-h"><h2 id="price-title">{t('priceTitle')}</h2></div>
        {priceLists.length === 0 ? (
          <div className="empty">{t('emptyPrice')}</div>
        ) : (
          <div className="tbl-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('merchant')}</th>
                  <th>{t('version')}</th>
                  <th>{t('lines')}</th>
                  <th>{t('requested')}</th>
                  <th><span className="sr-only">{t('approve')}</span></th>
                </tr>
              </thead>
              <tbody>
                {priceLists.map((list) => (
                  <tr key={list.id} data-testid="pending-price-list">
                    <td>{nameOf(list)}</td>
                    <td className="num"><bdi>{list.version}</bdi></td>
                    <td className="num"><bdi>{list.lineCount}</bdi></td>
                    <td className="small">{formatCairo(list.createdAt, safeLocale, 'dateTime')}</td>
                    <td>
                      <ActionButton
                        action={approvePriceListAction.bind(null, safeLocale, list.id)}
                        label={t('approve')}
                        doneText={t('approved')}
                        testId="approve-price-list"
                      />
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
