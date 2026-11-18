import { getTranslations, setRequestLocale } from 'next-intl/server';
import { requireMerchantAccess, requireUser, type SessionUser } from '@/accounts';
import {
  ANALYTICS_PERIODS,
  getMerchantAnalytics,
  type AnalyticsPeriodDays,
  type MerchantAnalytics,
  type MoneyDay,
  type PaidCashOut,
} from '@/analytics/merchant-analytics';
import { Link } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';
import { formatCairo } from '@/shared/cairo-time';
import { db } from '@/shared/db';
import { formatPiasters } from '@/shared/money';
import { Icon } from '@/ui/icon';
import { Pill, type PillTone } from '@/ui/pill';
import { amountParts } from '../wallet/wallet-formatting';
import { formatCount, formatShare, formatShortDate, splitHours, type Locale } from './analytics-formatting';
import { CashChart } from './cash-chart';

type Translate = Awaited<ReturnType<typeof getTranslations<'analytics'>>>;

const DEFAULT_DAYS: AnalyticsPeriodDays = 30;
const KNOWN_REASONS: ReadonlySet<string> = new Set([
  'customer_not_answering',
  'wrong_address',
  'customer_refused',
  'rescheduled_by_customer',
  'unclear_address',
  'unspecified',
]);
const GOOD_RATE = 0.88;
const FAIR_RATE = 0.8;
const DONUT_RADIUS = 58;
const DONUT_GAP = 3;
const PERCENT = 100;
const AXIS_TICKS = [0, 0.2, 0.4, 0.6, 0.8, 1];

function parseDays(value: string | string[] | undefined): AnalyticsPeriodDays {
  const days = typeof value === 'string' ? Number(value) : DEFAULT_DAYS;
  return ANALYTICS_PERIODS.find((period) => period === days) ?? DEFAULT_DAYS;
}

function canSeeAnalytics(user: SessionUser, merchantId: string | undefined): merchantId is string {
  if (!merchantId) return false;
  try {
    requireMerchantAccess(user, merchantId, 'orders');
    return true;
  } catch {
    return false;
  }
}

function rateTone(rate: number): PillTone {
  if (rate >= GOOD_RATE) return 'ok';
  if (rate >= FAIR_RATE) return 'warn';
  return 'bad';
}

// Shown in place of a table or chart, so phone widths never get a cut-off table.
function EmptyState({ title, text }: { title: string; text: string }) {
  return (
    <div className="empty an-empty">
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}

function CardHead({ title, hint, children }: { title: string; hint?: string; children?: React.ReactNode }) {
  return (
    <div className="card-h">
      <div className="grow">
        <h2>{title}</h2>
        {hint ? <span className="small muted">{hint}</span> : null}
      </div>
      {children}
    </div>
  );
}

function Kpis({ t, data, locale }: { t: Translate; data: MerchantAnalytics; locale: Locale }) {
  const cashPiasters = data.moneyByDay?.reduce((sum, day) => sum + day.cashCollectedPiasters, 0);
  const cards = [
    { key: 'completed', label: t('kpi.completed'), value: formatCount(data.completedOrders, locale), foot: t('kpi.completedFoot') },
    {
      key: 'delivered',
      label: t('kpi.delivered'),
      value: formatCount(data.deliveredCount, locale),
      foot: data.successRate === null ? t('kpi.noRate') : t('kpi.deliveredFoot', { rate: formatShare(data.successRate, locale) }),
    },
    { key: 'not-delivered', label: t('kpi.notDelivered'), value: formatCount(data.notDeliveredCount, locale), foot: t('kpi.notDeliveredFoot') },
    ...(cashPiasters === undefined
      ? []
      : [{ key: 'cash', label: t('kpi.cash'), value: amountParts(cashPiasters, locale).number, unit: amountParts(cashPiasters, locale).currency, foot: t('kpi.cashFoot') }]),
  ];
  return (
    <div className="grid an-kpis" data-testid="analytics-kpis">
      {cards.map((card) => (
        <div key={card.key} className="card an-kpi" data-testid={`kpi-${card.key}`}>
          <span className="muted">{card.label}</span>
          <span className="v"><bdi>{card.value}</bdi>{'unit' in card ? <small> {card.unit}</small> : null}</span>
          <span className="small subtle">{card.foot}</span>
        </div>
      ))}
    </div>
  );
}

function ReasonsCard({ t, data, locale }: { t: Translate; data: MerchantAnalytics; locale: Locale }) {
  // Reason codes the portal has no wording for are grouped under one "Other reasons" row.
  const grouped = new Map<string, number>();
  for (const { reason, count } of data.notDeliveredReasons) {
    const key = KNOWN_REASONS.has(reason) ? reason : 'other';
    grouped.set(key, (grouped.get(key) ?? 0) + count);
  }
  const rows = [...grouped.entries()].sort((a, b) => b[1] - a[1]);
  const total = rows.reduce((sum, [, count]) => sum + count, 0);
  const top = rows[0]?.[1] ?? 1;
  return (
    <section className="card" data-testid="analytics-reasons">
      <CardHead title={t('reasons.title')} hint={t('reasons.hint', { count: total })} />
      {rows.length === 0 ? (
        <EmptyState title={t('reasons.emptyTitle')} text={t('reasons.emptyText')} />
      ) : (
        <div className="tbl-wrap">
          <table className="an-plain">
            <thead>
              <tr>
                <th className="an-rank" style={{ width: 36 }}>{t('reasons.number')}</th>
                <th>{t('reasons.reason')}</th>
                <th style={{ width: '38%' }}>{t('reasons.share')}</th>
                <th style={{ textAlign: 'end' }}>{t('reasons.orders')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([reason, count], index) => (
                <tr key={reason}>
                  <td className="subtle an-rank">{index + 1}</td>
                  <td>{t(`reasons.labels.${reason as 'other'}`)}</td>
                  <td>
                    <div className="an-share">
                      <span className="an-track"><i style={{ width: `${(count / top) * PERCENT}%` }} /></span>
                      <span className="num small muted">{formatShare(count / total, locale, 1)}</span>
                    </div>
                  </td>
                  <td className="num">{formatCount(count, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function SuccessCard({ t, data, locale }: { t: Translate; data: MerchantAnalytics; locale: Locale }) {
  if (data.successRate === null) {
    return (
      <section className="card" data-testid="analytics-success">
        <CardHead title={t('success.title')} />
        <EmptyState title={t('success.emptyTitle')} text={t('success.emptyText')} />
      </section>
    );
  }
  const rate = data.successRate;
  const circumference = 2 * Math.PI * DONUT_RADIUS;
  const rateText = formatShare(rate, locale);
  return (
    <section className="card" data-testid="analytics-success">
      <CardHead title={t('success.title')} />
      <div className="card-b an-donut-wrap">
        <svg viewBox="0 0 160 160" width="168" role="img" aria-label={t('success.chartLabel', { rate: rateText })}>
          <circle cx="80" cy="80" r={DONUT_RADIUS} fill="none" stroke="var(--an-c2)" strokeWidth="16" />
          <circle
            cx="80"
            cy="80"
            r={DONUT_RADIUS}
            fill="none"
            stroke="var(--an-c1)"
            strokeWidth="16"
            strokeDasharray={`${Math.max(0, circumference * rate - DONUT_GAP)} ${circumference}`}
            strokeDashoffset="-1.5"
            transform="rotate(-90 80 80)"
          />
          <text x="80" y="84" textAnchor="middle" fontSize="28" fontWeight="700" fill="var(--fg)">{rateText}</text>
          <text x="80" y="104" textAnchor="middle" fontSize="11.5" fill="var(--muted)">{t('success.deliveredWord')}</text>
        </svg>
        <div className="an-legend">
          <div>
            <span><i className="an-sw" style={{ background: 'var(--an-c1)' }} />{t('success.delivered')}</span>
            <Pill tone="blue">{rateText}</Pill>
            <b className="num">{formatCount(data.deliveredCount, locale)}</b>
          </div>
          <div>
            <span><i className="an-sw" style={{ background: 'var(--an-c2)' }} />{t('success.notDelivered')}</span>
            <Pill tone="grey">{formatShare(1 - rate, locale)}</Pill>
            <b className="num">{formatCount(data.notDeliveredCount, locale)}</b>
          </div>
          <div className="tot">
            <span>{t('success.total')}</span>
            <span />
            <b className="num">{formatCount(data.completedOrders, locale)}</b>
          </div>
        </div>
      </div>
    </section>
  );
}

function AttemptsCard({ t, data, locale }: { t: Translate; data: MerchantAnalytics; locale: Locale }) {
  const rows = [
    { key: 'first', label: t('attempts.first'), share: data.attempts.first },
    { key: 'second', label: t('attempts.second'), share: data.attempts.second },
    { key: 'third', label: t('attempts.third'), share: data.attempts.third },
  ];
  return (
    <section className="card" data-testid="analytics-attempts">
      <CardHead title={t('attempts.title')} hint={t('attempts.hint')} />
      {data.deliveredCount === 0 ? (
        <EmptyState title={t('attempts.emptyTitle')} text={t('attempts.emptyText')} />
      ) : (
        <div className="card-b an-bars-wrap">
          <ul className="an-bars">
            {rows.map((row) => (
              <li key={row.key} className="an-bar" aria-label={t('attempts.barLabel', { try: row.label, share: formatShare(row.share, locale, 1) })}>
                <span className="muted">{row.label}</span>
                <span className="an-track"><i style={{ width: `${row.share * PERCENT}%` }} /></span>
                <b className="num">{formatShare(row.share, locale)}</b>
              </li>
            ))}
          </ul>
          <div className="an-axis" aria-hidden="true">
            <span />
            <span className="ticks">{AXIS_TICKS.map((tick) => <i key={tick}>{formatShare(tick, locale)}</i>)}</span>
            <span />
          </div>
        </div>
      )}
    </section>
  );
}

function TimeCard({ t, data }: { t: Translate; data: MerchantAnalytics }) {
  const hours = data.averageDeliveryHours;
  let text = '';
  if (hours !== null) {
    const parts = splitHours(hours);
    const daysText = t('time.days', { count: parts.days });
    const hoursText = t('time.hours', { count: parts.hours });
    if (parts.days > 0 && parts.hours > 0) text = t('time.daysAndHours', { days: daysText, hours: hoursText });
    else if (parts.days > 0) text = daysText;
    else if (parts.hours > 0) text = hoursText;
    else text = t('time.underHour');
  }
  return (
    <section className="card" data-testid="analytics-time">
      <CardHead title={t('time.title')} hint={t('time.hint')} />
      {hours === null ? (
        <EmptyState title={t('time.emptyTitle')} text={t('time.emptyText')} />
      ) : (
        <div className="card-b an-time">
          <div className="an-bigtime">{text}</div>
          <span className="small muted">{t('time.basedOn', { count: data.deliveredCount })}</span>
        </div>
      )}
    </section>
  );
}

function GovernoratesCard({
  t, data, locale, names,
}: { t: Translate; data: MerchantAnalytics; locale: Locale; names: Map<string, string> }) {
  // Most delivered orders first, as in the mockup.
  const rows = [...data.byGovernorate].sort((a, b) => b.delivered - a.delivered || b.orders - a.orders);
  const maxDelivered = Math.max(1, ...rows.map((row) => row.delivered));
  return (
    <section className="card" style={{ overflow: 'hidden' }} data-testid="analytics-governorates">
      <CardHead title={t('governorates.title')} hint={t('governorates.hint')} />
      {data.byGovernorate.length === 0 ? (
        <EmptyState title={t('governorates.emptyTitle')} text={t('governorates.emptyText')} />
      ) : (
        <div className="tbl-wrap">
          <table className="an-plain">
            <thead>
              <tr>
                <th className="an-rank" style={{ width: 36 }}>{t('governorates.number')}</th>
                <th>{t('governorates.governorate')}</th>
                <th>{t('governorates.rate')}</th>
                <th style={{ textAlign: 'end' }}>{t('governorates.delivered')}</th>
                <th className="an-sharecol" style={{ width: '30%' }}>{t('governorates.share')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const rate = row.delivered / row.orders;
                return (
                  <tr key={row.governorateCode}>
                    <td className="subtle an-rank">{index + 1}</td>
                    <td>{names.get(row.governorateCode) ?? row.governorateCode}</td>
                    <td><Pill tone={rateTone(rate)}>{formatShare(rate, locale, 1)}</Pill></td>
                    <td className="num">{formatCount(row.delivered, locale)}</td>
                    <td className="an-sharecol"><span className="an-track"><i style={{ width: `${(row.delivered / maxDelivered) * PERCENT}%` }} /></span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function CashOutsCard({ t, cashOuts, locale }: { t: Translate; cashOuts: PaidCashOut[]; locale: Locale }) {
  const total = cashOuts.reduce((sum, cashOut) => sum + cashOut.amountPiasters, 0);
  return (
    <section className="card" style={{ overflow: 'hidden' }} data-testid="analytics-cash-outs">
      <CardHead title={t('cashOuts.title')} hint={t('cashOuts.hint')}>
        <Link className="btn sm" href="/wallet" data-testid="open-wallet">
          <Icon name="wallet" size={14} /> {t('cashOuts.openWallet')}
        </Link>
      </CardHead>
      {cashOuts.length === 0 ? (
        <EmptyState title={t('cashOuts.emptyTitle')} text={t('cashOuts.emptyText')} />
      ) : (
        <>
          <div className="card-b" style={{ paddingTop: 0 }}>
            <div className="an-bignum"><bdi>{formatPiasters(total, locale)}</bdi></div>
          </div>
          <div className="tbl-wrap an-scroll">
            <table className="an-plain">
              <thead>
                <tr>
                  <th>{t('cashOuts.reference')}</th>
                  <th>{t('cashOuts.date')}</th>
                  <th style={{ textAlign: 'end' }}>{t('cashOuts.amount')}</th>
                </tr>
              </thead>
              <tbody>
                {cashOuts.map((cashOut) => (
                  <tr key={cashOut.id}>
                    <td><Link className="mono" href={`/wallet/proof/${cashOut.id}`}>{cashOut.number}</Link></td>
                    <td className="an-date">{formatCairo(cashOut.paidAt, locale, 'date')}</td>
                    <td className="num"><bdi>{formatPiasters(cashOut.amountPiasters, locale)}</bdi></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

function CashCard({ t, days, locale }: { t: Translate; days: MoneyDay[]; locale: Locale }) {
  const activeDays = days.filter((day) => day.cashCollectedPiasters !== 0 || day.feesPiasters !== 0).reverse();
  const cash = days.reduce((sum, day) => sum + day.cashCollectedPiasters, 0);
  const fees = days.reduce((sum, day) => sum + day.feesPiasters, 0);
  const net = days.reduce((sum, day) => sum + day.netPiasters, 0);
  const first = days[0]?.date ?? '';
  const last = days.at(-1)?.date ?? '';
  return (
    <section className="card" style={{ overflow: 'hidden' }} data-testid="analytics-cash">
      <CardHead title={t('cash.title')} hint={t('cash.hint')} />
      {activeDays.length === 0 ? (
        <EmptyState title={t('cash.emptyTitle')} text={t('cash.emptyText')} />
      ) : (
        <>
          <div className="card-b" style={{ paddingTop: 0 }}>
            <div className="g3 an-minis">
              <div><span><i className="an-sw" style={{ background: 'var(--an-c1)' }} />{t('cash.collected')}</span><b className="num"><bdi>{formatPiasters(cash, locale)}</bdi></b></div>
              <div><span><i className="an-sw" style={{ background: 'var(--an-c2)' }} />{t('cash.fees')}</span><b className="num"><bdi>{formatPiasters(fees, locale)}</bdi></b></div>
              <div className="net"><span>{t('cash.net')}</span><b className="num"><bdi>{formatPiasters(net, locale)}</bdi></b></div>
            </div>
            <CashChart
              days={days}
              locale={locale}
              label={t('cash.chartLabel', {
                from: formatShortDate(first, locale),
                to: formatShortDate(last, locale),
                cash: formatPiasters(cash, locale),
                fees: formatPiasters(fees, locale),
              })}
            />
          </div>
          <div className="tbl-wrap an-scroll">
            <table className="an-plain">
              <thead>
                <tr>
                  <th>{t('cash.date')}</th>
                  <th style={{ textAlign: 'end' }}>{t('cash.collected')}</th>
                  <th style={{ textAlign: 'end' }}>{t('cash.fees')}</th>
                  <th style={{ textAlign: 'end' }}>{t('cash.net')}</th>
                </tr>
              </thead>
              <tbody>
                {activeDays.map((day) => (
                  <tr key={day.date}>
                    <td className="an-date">{formatShortDate(day.date, locale)}</td>
                    <td className="num"><bdi>{formatPiasters(day.cashCollectedPiasters, locale)}</bdi></td>
                    <td className="num"><bdi>{formatPiasters(day.feesPiasters, locale)}</bdi></td>
                    <td className="num" style={{ fontWeight: 700 }}><bdi>{formatPiasters(day.netPiasters, locale)}</bdi></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

export default async function AnalyticsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const safeLocale = routing.locales.find((known) => known === locale) ?? routing.defaultLocale;
  const viewLocale: Locale = safeLocale === 'ar' ? 'ar' : 'en';
  const user = await requireUser(safeLocale);
  const merchantId = user.memberships[0]?.merchantId;
  const t = await getTranslations('analytics');

  if (!canSeeAnalytics(user, merchantId)) {
    return (
      <>
        <h1>{t('title')}</h1>
        <section className="card soon" data-testid="analytics-no-access">
          <span className="ic"><Icon name="shield" size={26} /></span>
          <h2>{t('noAccessTitle')}</h2>
          <p className="muted" style={{ margin: 0 }}>{t('noAccessText')}</p>
        </section>
      </>
    );
  }

  const days = parseDays((await searchParams).days);
  const [data, governorates] = await Promise.all([
    getMerchantAnalytics(user, merchantId, { days }),
    db.governorate.findMany({ select: { code: true, nameEn: true, nameAr: true } }),
  ]);
  const names = new Map(governorates.map((row) => [row.code, viewLocale === 'ar' ? row.nameAr : row.nameEn]));

  return (
    <div className="an">
      <div className="page-head">
        <div className="grow">
          <h1>{t('title')}</h1>
          <span className="muted">{t('subtitle', { days })}</span>
        </div>
        <nav className="chips an-periods" aria-label={t('periodLabel')}>
          {ANALYTICS_PERIODS.map((period) => (
            <Link
              key={period}
              href={{ pathname: '/analytics', query: { days: String(period) } }}
              className={period === days ? 'chip on' : 'chip'}
              aria-current={period === days ? 'page' : undefined}
              data-testid={`period-${period}`}
              scroll={false}
            >
              {t(`periods.${period}`)}
            </Link>
          ))}
        </nav>
      </div>

      <Kpis t={t} data={data} locale={viewLocale} />

      <div className="grid an-2">
        <ReasonsCard t={t} data={data} locale={viewLocale} />
        <SuccessCard t={t} data={data} locale={viewLocale} />
      </div>

      <div className="grid an-2">
        <AttemptsCard t={t} data={data} locale={viewLocale} />
        <TimeCard t={t} data={data} />
      </div>

      <GovernoratesCard t={t} data={data} locale={viewLocale} names={names} />

      {data.moneyByDay && data.cashOuts ? (
        <div className="grid an-2r">
          <CashOutsCard t={t} cashOuts={data.cashOuts} locale={viewLocale} />
          <CashCard t={t} days={data.moneyByDay} locale={viewLocale} />
        </div>
      ) : null}
    </div>
  );
}
