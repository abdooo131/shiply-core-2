import type { CashOutSchedule } from '@prisma/client';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { ReactNode } from 'react';
import { requireUser, type SessionUser } from '@/accounts';
import { Link } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';
import { listBankAccounts } from '@/merchants';
import {
  getWalletSummary,
  listCashCycles,
  listCashOuts,
  listWalletTransactions,
  type CashCycleView,
  type CashOutView,
  type WalletTransaction,
} from '@/money';
import { formatCairo } from '@/shared/cairo-time';
import { db } from '@/shared/db';
import { formatPiasters } from '@/shared/money';
import { Icon } from '@/ui/icon';
import { Pill, type PillTone } from '@/ui/pill';
import { BalanceBreakdown } from './balance-breakdown';
import { HowCashOutsWork } from './how-cash-outs-work';
import { TransactionsTable, type TransactionReason, type TransactionRowView } from './transactions-table';
import { amountParts, formatCalendarDate, nextCashOutDate, signedPiasters, type Locale } from './wallet-formatting';
import { canSeeWallet } from './wallet-access';

type Translate = Awaited<ReturnType<typeof getTranslations<'wallet'>>>;
type WalletTab = 'balance' | 'cycles';

const KNOWN_REASONS: ReadonlySet<string> = new Set(['order_delivered', 'order_returned', 'cash_out_paid']);
const CASH_OUT_TONES: Record<string, PillTone> = { prepared: 'warn', approved: 'info', paid: 'ok' };
const OPEN_CASH_OUT_STATUSES: ReadonlySet<string> = new Set(['prepared', 'approved']);

function parsePage(value: string | string[] | undefined): number {
  const page = typeof value === 'string' ? Number.parseInt(value, 10) : 1;
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}

function Pager({ t, tab, page, pageCount }: { t: Translate; tab: WalletTab; page: number; pageCount: number }) {
  if (pageCount <= 1) return null;
  const hrefFor = (target: number) => ({
    pathname: '/wallet',
    query: { ...(tab === 'cycles' ? { tab } : {}), ...(target > 1 ? { page: String(target) } : {}) },
  });
  return (
    <nav className="pager" aria-label={t('pages')}>
      <span className="grow" style={{ textAlign: 'start' }}>{t('pageOf', { page, pageCount })}</span>
      {page > 1 ? (
        <Link className="btn sm" href={hrefFor(page - 1)} scroll={false}><Icon name="back" size={14} /> {t('prev')}</Link>
      ) : (
        <button type="button" className="btn sm" disabled><Icon name="back" size={14} /> {t('prev')}</button>
      )}
      {page < pageCount ? (
        <Link className="btn sm" href={hrefFor(page + 1)} scroll={false}>{t('next')}</Link>
      ) : (
        <button type="button" className="btn sm" disabled>{t('next')}</button>
      )}
    </nav>
  );
}

// Shown instead of the table, so on a phone the text is not cut off by the table's horizontal scroll.
function EmptyState({ title, text }: { title: string; text: string }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}

function toTransactionRow(tx: WalletTransaction, locale: Locale, proofIdOf: Map<string, string>): TransactionRowView {
  const reason = (KNOWN_REASONS.has(tx.reason) ? tx.reason : 'other') as TransactionReason;
  return {
    id: tx.entryId,
    reason,
    isOut: tx.amountPiasters < 0,
    amountText: signedPiasters(tx.amountPiasters, locale),
    dateText: formatCairo(tx.postedAt, locale, 'date'),
    timeText: formatCairo(tx.postedAt, locale, 'time'),
    orderNumber: tx.orderNumber,
    cashOutNumber: tx.cashOutNumber,
    proofId: tx.cashOutNumber ? (proofIdOf.get(tx.cashOutNumber) ?? null) : null,
  };
}

function CashOutsCard({ t, cashOuts, locale }: { t: Translate; cashOuts: CashOutView[]; locale: Locale }) {
  return (
    <section className="card" style={{ overflow: 'hidden' }} data-testid="cash-outs">
      <div className="card-h b">
        <div className="grow">
          <h2>{t('cashOuts.title')}</h2>
          <span className="small muted">{t('cashOuts.hint')}</span>
        </div>
      </div>
      {cashOuts.length === 0 ? (
        <EmptyState title={t('cashOuts.emptyTitle')} text={t('cashOuts.emptyText')} />
      ) : (
      <div className="tbl-wrap">
        <table>
          <thead>
            <tr>
              <th>{t('cashOuts.number')}</th>
              <th>{t('cashOuts.date')}</th>
              <th style={{ textAlign: 'end' }}>{t('cashOuts.amount')}</th>
              <th>{t('cashOuts.status')}</th>
              <th style={{ textAlign: 'end' }}>{t('table.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {cashOuts.map((cashOut) => (
                <tr key={cashOut.id}>
                  <td><span className="mono">{cashOut.number}</span></td>
                  <td>
                    {cashOut.paidAt ? formatCairo(cashOut.paidAt, locale, 'date') : formatCalendarDate(cashOut.scheduledDate, locale)}
                  </td>
                  <td className="num" style={{ fontWeight: 800 }}><bdi>{formatPiasters(cashOut.amountPiasters, locale)}</bdi></td>
                  <td>
                    <Pill tone={CASH_OUT_TONES[cashOut.status] ?? 'grey'}>{t(`cashOuts.statuses.${cashOut.status}`)}</Pill>
                  </td>
                  <td style={{ textAlign: 'end' }}>
                    {cashOut.status === 'paid' ? (
                      <Link className="btn sm" href={`/wallet/proof/${cashOut.id}`} data-testid="proof-link">
                        <Icon name="doc" size={13} /> {t('proof.title')}
                      </Link>
                    ) : (
                      <span className="subtle small">{t('cashOuts.proofLater')}</span>
                    )}
                  </td>
                </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}
    </section>
  );
}

function cycleStatus(t: Translate, cycle: CashCycleView, cashOutsById: Map<string, CashOutView>): ReactNode {
  if (!cycle.cashOutId) return <Pill tone="warn">{t('cycles.inNextCashOut')}</Pill>;
  const cashOut = cashOutsById.get(cycle.cashOutId);
  if (!cashOut || cashOut.status === 'paid') {
    return (
      <span className="row-actions" style={{ justifyContent: 'flex-start' }}>
        <Pill tone="ok">{t('cycles.paid')}</Pill>
        {cashOut ? (
          <Link className="mono" href={`/wallet/proof/${cashOut.id}`}>{cashOut.number}</Link>
        ) : null}
      </span>
    );
  }
  return <Pill tone="warn">{t('cycles.inCashOut', { number: cashOut.number })}</Pill>;
}

async function CyclesTab({
  t, user, merchantId, locale, page, cashOuts,
}: { t: Translate; user: SessionUser; merchantId: string; locale: Locale; page: number; cashOuts: CashOutView[] }) {
  const { cycles, pageCount } = await listCashCycles(user, merchantId, { page });
  const cashOutsById = new Map(cashOuts.map((cashOut) => [cashOut.id, cashOut]));
  const shownPage = Math.min(page, pageCount);
  return (
    <section className="card" style={{ overflow: 'hidden' }} data-testid="cycles">
      <div className="card-h b">
        <div className="grow">
          <h2>{t('cycles.title')}</h2>
          <span className="small muted">{t('cycles.hint')}</span>
        </div>
      </div>
      {cycles.length === 0 ? (
        <EmptyState title={t('cycles.emptyTitle')} text={t('cycles.emptyText')} />
      ) : (
      <div className="tbl-wrap">
        <table>
          <thead>
            <tr>
              <th>{t('cycles.date')}</th>
              <th style={{ textAlign: 'end' }}>{t('cycles.orders')}</th>
              <th style={{ textAlign: 'end' }}>{t('cycles.cash')}</th>
              <th style={{ textAlign: 'end' }}>{t('cycles.fees')}</th>
              <th style={{ textAlign: 'end' }}>{t('cycles.net')}</th>
              <th>{t('cycles.payout')}</th>
            </tr>
          </thead>
          <tbody>
            {cycles.map((cycle) => (
                <tr key={cycle.id}>
                  <td><b>{formatCalendarDate(cycle.cycleDate, locale, true)}</b></td>
                  <td className="num">{cycle.orderCount}</td>
                  <td className="num"><bdi>{formatPiasters(cycle.cashCollectedPiasters, locale)}</bdi></td>
                  <td className="num"><bdi>{formatPiasters(cycle.feesPiasters, locale)}</bdi></td>
                  <td className="num" style={{ fontWeight: 800, color: cycle.netPiasters < 0 ? 'var(--bad-fg)' : 'var(--ok-text)' }}>
                    <bdi>{signedPiasters(cycle.netPiasters, locale)}</bdi>
                  </td>
                  <td>{cycleStatus(t, cycle, cashOutsById)}</td>
                </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}
      <Pager t={t} tab="cycles" page={shownPage} pageCount={pageCount} />
    </section>
  );
}

async function BalanceTab({
  t, user, merchantId, locale, page, cashOuts, schedule,
}: {
  t: Translate; user: SessionUser; merchantId: string; locale: Locale; page: number; cashOuts: CashOutView[]; schedule: CashOutSchedule;
}) {
  const [summary, { transactions, pageCount }, bankAccounts] = await Promise.all([
    getWalletSummary(user, merchantId),
    listWalletTransactions(user, merchantId, { page }),
    listBankAccounts(user, merchantId),
  ]);
  const paidCashOuts = cashOuts.filter((cashOut) => cashOut.status === 'paid');
  const proofIdOf = new Map(paidCashOuts.map((cashOut) => [cashOut.number, cashOut.id]));
  const paidOutPiasters = paidCashOuts.reduce((sum, cashOut) => sum + cashOut.amountPiasters, 0);
  const openCashOut = cashOuts.find((cashOut) => OPEN_CASH_OUT_STATUSES.has(cashOut.status));
  const nextDate = openCashOut?.scheduledDate ?? nextCashOutDate(schedule, new Date());
  const bank = bankAccounts.find((account) => account.status === 'active');
  const isOwing = summary.balancePiasters < 0;
  const balance = amountParts(summary.balancePiasters, locale);
  const shownPage = Math.min(page, pageCount);

  return (
    <>
      <div className="grid wl-top">
        <section className="card stat money wl-balance" data-testid="balance-card">
          {/* The brand route motif from the mockup's balance card. */}
          <svg className="wl-deco" width="140" viewBox="0 0 240 130" fill="none" aria-hidden="true">
            <path d="M14 112 H150 a26 26 0 0 0 0-52 H86 a26 26 0 0 1 0-52 H214" stroke="rgba(223,255,0,.5)" strokeWidth="16" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M206 -6 L226 8 L206 22" stroke="rgba(223,255,0,.5)" strokeWidth="10" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="60" cy="112" r="5" fill="#0A23A8" />
            <circle cx="118" cy="60" r="5" fill="#0A23A8" />
            <circle cx="160" cy="8" r="5" fill="#0A23A8" />
          </svg>
          <span className="k">{isOwing ? t('balance.owe') : t('balance.available')}</span>
          <span className="v" style={{ fontSize: 38 }} data-testid="balance-amount">
            <bdi>{isOwing ? '−' : ''}{balance.number}</bdi>
            <small> {balance.currency}</small>
          </span>
          <span className="foot">
            {isOwing
              ? t('balance.oweHint', { amount: formatPiasters(Math.abs(summary.balancePiasters), locale) })
              : t('balance.availableHint')}
          </span>
          <div className="row-actions" style={{ marginTop: 8, justifyContent: 'flex-start' }}>
            <BalanceBreakdown
              view={{
                processingText: formatPiasters(summary.processingPiasters, locale),
                inNextCashOutText: formatPiasters(summary.inNextCashOutPiasters, locale),
                paidOutText: formatPiasters(paidOutPiasters, locale),
                paidOutCount: paidCashOuts.length,
                balanceText: formatPiasters(summary.balancePiasters, locale),
              }}
            />
          </div>
        </section>
        <section className="card stat" data-testid="schedule-card">
          <span className="k"><i><Icon name="cal" size={16} /></i>{t('schedule.title')}</span>
          <span className="v" style={{ fontSize: 20 }}>{t(`schedule.names.${schedule}`)}</span>
          <span className="foot">{t(`schedule.days.${schedule}`)}</span>
          <Link className="btn sm" style={{ alignSelf: 'flex-start' }} href="/settings/pricing">{t('schedule.see')}</Link>
        </section>
        <section className="card stat" data-testid="next-cash-out">
          <span className="k"><i><Icon name="wallet" size={16} /></i>{t('next.title')}</span>
          <span className="v" style={{ fontSize: 20 }}>{formatCalendarDate(nextDate, locale, true)}</span>
          <span className="foot">
            {bank
              ? t('next.toBank', {
                  amount: formatPiasters(openCashOut?.amountPiasters ?? summary.inNextCashOutPiasters, locale),
                  bank: bank.bankName,
                  last4: bank.maskedIban.slice(-4),
                })
              : t('next.noBank')}
          </span>
          <span className="row-actions" style={{ justifyContent: 'flex-start' }}>
            {openCashOut ? (
              <Pill tone={CASH_OUT_TONES[openCashOut.status] ?? 'warn'}>{t(`cashOuts.statuses.${openCashOut.status}`)}</Pill>
            ) : (
              <Pill tone="grey">{t('next.scheduled')}</Pill>
            )}
            {bank ? null : <Link className="foot linkish" href="/settings/payouts">{t('next.addBank')}</Link>}
          </span>
        </section>
      </div>

      <section className="card" style={{ overflow: 'hidden' }} data-testid="transactions">
        <div className="card-h b">
          <div className="grow">
            <h2>{t('transactions.title')}</h2>
            <span className="small muted">{t('transactions.hint')}</span>
          </div>
        </div>
        {transactions.length === 0 ? (
          <EmptyState title={t('transactions.emptyTitle')} text={t('transactions.emptyText')} />
        ) : (
          <TransactionsTable rows={transactions.map((tx) => toTransactionRow(tx, locale, proofIdOf))} />
        )}
        <Pager t={t} tab="balance" page={shownPage} pageCount={pageCount} />
      </section>

      <CashOutsCard t={t} cashOuts={cashOuts} locale={locale} />
    </>
  );
}

export default async function WalletPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const safeLocale = routing.locales.find((known) => known === locale) ?? routing.defaultLocale;
  const moneyLocale: Locale = safeLocale === 'ar' ? 'ar' : 'en';
  const user = await requireUser(safeLocale);
  const merchantId = user.memberships[0]?.merchantId;
  const t = await getTranslations('wallet');

  if (!canSeeWallet(user, merchantId)) {
    return (
      <>
        <h1>{t('title')}</h1>
        <section className="card soon" data-testid="wallet-no-access">
          <span className="ic"><Icon name="shield" size={26} /></span>
          <h2>{t('noAccessTitle')}</h2>
          <p className="muted" style={{ margin: 0 }}>{t('noAccessText')}</p>
        </section>
      </>
    );
  }

  const query = await searchParams;
  const tab: WalletTab = query.tab === 'cycles' ? 'cycles' : 'balance';
  const page = parsePage(query.page);
  const [cashOuts, merchant] = await Promise.all([
    listCashOuts(user, merchantId),
    db.merchant.findUniqueOrThrow({ where: { id: merchantId }, select: { cashOutSchedule: true } }),
  ]);

  return (
    <>
      <div className="page-head">
        <div className="grow">
          <h1>{t('title')}</h1>
        </div>
        <HowCashOutsWork scheduleText={t(`how.cashOutText.${merchant.cashOutSchedule}`)} />
      </div>
      <nav className="tabs" aria-label={t('tabsLabel')}>
        {(['balance', 'cycles'] as const).map((candidate) => (
          <Link
            key={candidate}
            href={candidate === 'balance' ? '/wallet' : { pathname: '/wallet', query: { tab: candidate } }}
            className={candidate === tab ? 'tab on' : 'tab'}
            aria-current={candidate === tab ? 'page' : undefined}
            data-testid={`wallet-tab-${candidate}`}
          >
            {t(`tabs.${candidate}`)}
          </Link>
        ))}
      </nav>
      {tab === 'cycles' ? (
        <CyclesTab t={t} user={user} merchantId={merchantId} locale={moneyLocale} page={page} cashOuts={cashOuts} />
      ) : (
        <BalanceTab t={t} user={user} merchantId={merchantId} locale={moneyLocale} page={page} cashOuts={cashOuts} schedule={merchant.cashOutSchedule} />
      )}
    </>
  );
}
