import { getTranslations, setRequestLocale } from 'next-intl/server';
import { requireMerchantAccess, requireUser, type SessionUser } from '@/accounts';
import { cairoPartOfDay } from '@/home/home-greeting';
import { getHomeSummary, type HomeSummary } from '@/home/home-summary';
import { Link } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';
import { getWalletSummary, listCashOuts } from '@/money';
import { MAX_DELIVERY_ATTEMPTS } from '@/orders/order-status';
import { db } from '@/shared/db';
import { formatPiasters } from '@/shared/money';
import { Icon, type IconName } from '@/ui/icon';
import { DeliveriesChart } from './deliveries-chart';
import { NeedsActionCard } from './needs-action-card';
import { canSeeWallet } from './wallet/wallet-access';
import { amountParts, formatCalendarDate, nextCashOutDate, type Locale } from './wallet/wallet-formatting';

type Translate = Awaited<ReturnType<typeof getTranslations<'home'>>>;
type MoneyView = { collectedPiasters: number; nextDate: string; nextAmountPiasters: number };

const OPEN_CASH_OUT_STATUSES: ReadonlySet<string> = new Set(['prepared', 'approved']);
const GROW_LINKS: { href: string; icon: IconName; key: 'products' | 'pickups' | 'pricing' }[] = [
  { href: '/products', icon: 'tag', key: 'products' },
  { href: '/pickups', icon: 'truck', key: 'pickups' },
  { href: '/settings/pricing', icon: 'shield', key: 'pricing' },
];

function hasOrdersAccess(user: SessionUser, merchantId: string): boolean {
  try {
    requireMerchantAccess(user, merchantId, 'orders');
    return true;
  } catch {
    return false;
  }
}

async function loadMoney(user: SessionUser, merchantId: string): Promise<MoneyView> {
  const [wallet, cashOuts, merchant] = await Promise.all([
    getWalletSummary(user, merchantId),
    listCashOuts(user, merchantId),
    db.merchant.findUniqueOrThrow({ where: { id: merchantId }, select: { cashOutSchedule: true } }),
  ]);
  const open = cashOuts.find((cashOut) => OPEN_CASH_OUT_STATUSES.has(cashOut.status));
  return {
    collectedPiasters: wallet.processingPiasters,
    nextDate: open?.scheduledDate ?? nextCashOutDate(merchant.cashOutSchedule, new Date()),
    nextAmountPiasters: open?.amountPiasters ?? wallet.inNextCashOutPiasters,
  };
}

// The mockup's arrow. The "flip" class mirrors it in Arabic so it points the reading direction.
function ForwardArrow({ size = 16 }: { size?: number }) {
  return (
    <svg className="flip" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

function Headline({ t, summary, separator }: { t: Translate; summary: HomeSummary; separator: string }) {
  return (
    <h1 className="hero-sum" data-testid="today-headline">
      {t('today')} <em>{t('todayDelivered', { count: summary.todayDelivered })}</em>
      {separator}{t('todayPickedUp', { count: summary.todayPickedUp })}
      {separator}{t('todayCreated', { count: summary.todayCreated })}
      {summary.needsActionCount > 0 ? (
        <>
          {separator}
          <Link href={{ pathname: '/orders', query: { tab: 'needs_action' } }}>{t('todayNeedAction', { count: summary.needsActionCount })}</Link>
        </>
      ) : null}
      .
    </h1>
  );
}

function HeroStats({ t, summary, money, locale }: { t: Translate; summary: HomeSummary; money: MoneyView | null; locale: Locale }) {
  const collected = money ? amountParts(money.collectedPiasters, locale) : null;
  return (
    <nav className="hero-stats" aria-label={t('stats.label')}>
      <Link className="hstat" href={{ pathname: '/orders', query: { tab: 'in_progress' } }}>
        <span>{t('stats.inProgress')}</span><b>{summary.openCounts.inProgress}</b>
      </Link>
      <Link className="hstat" href="/pickups">
        <span>{t('stats.new')}</span><b>{summary.openCounts.new}</b>
      </Link>
      <Link className="hstat" href={{ pathname: '/orders', query: { tab: 'coming_back' } }}>
        <span>{t('stats.comingBack')}</span><b>{summary.openCounts.comingBack}</b>
      </Link>
      {collected ? (
        <Link className="hstat" href="/wallet">
          <span>{t('stats.cashCollected')}</span><b><bdi>{collected.number}</bdi><small> {collected.currency}</small></b>
        </Link>
      ) : (
        <Link className="hstat" href={{ pathname: '/orders', query: { tab: 'needs_action' } }}>
          <span>{t('needs.title')}</span><b>{summary.needsActionCount}</b>
        </Link>
      )}
    </nav>
  );
}

function MoneyCard({ t, money, expectedPiasters, locale }: { t: Translate; money: MoneyView; expectedPiasters: number | null; locale: Locale }) {
  const collected = amountParts(money.collectedPiasters, locale);
  return (
    <Link className="card stat money hm-money" href="/wallet" data-testid="home-money">
      <span className="k">{t('money.collected')}</span>
      <span className="v"><bdi>{collected.number}</bdi><small> {collected.currency}</small></span>
      <div className="hm-lines small">
        {expectedPiasters === null ? null : (
          <div><span>{t('money.expected')}</span><b className="num"><bdi>{formatPiasters(expectedPiasters, locale)}</bdi></b></div>
        )}
        <div data-testid="next-cash-out">
          <span>{t('money.nextCashOut')}</span>
          <span className="hm-next">
            <b>{formatCalendarDate(money.nextDate, locale, true)}</b>
            <bdi className="num">{formatPiasters(money.nextAmountPiasters, locale)}</bdi>
          </span>
        </div>
      </div>
      <span className="btn lime sm hm-open">{t('money.openWallet')} <ForwardArrow size={14} /></span>
    </Link>
  );
}

function ExpectedCard({ t, expectedPiasters, locale }: { t: Translate; expectedPiasters: number; locale: Locale }) {
  const expected = amountParts(expectedPiasters, locale);
  return (
    <section className="card stat" data-testid="home-expected">
      <span className="k"><i><Icon name="coin" size={16} /></i>{t('money.expected')}</span>
      <span className="v"><bdi>{expected.number}</bdi><small> {expected.currency}</small></span>
      <span className="foot">{t('expected.hint')}</span>
    </section>
  );
}

function GrowCard({ t }: { t: Translate }) {
  return (
    <section className="card" aria-labelledby="hm-grow-title">
      <div className="card-h"><h2 className="grow" id="hm-grow-title">{t('grow.title')}</h2></div>
      <div className="card-b grid hm-grow">
        {GROW_LINKS.map((item) => (
          <Link key={item.key} className="svc" href={item.href}>
            <span className="ic"><Icon name={item.icon} /></span>
            <span className="cell2 grow"><b>{t(`grow.${item.key}`)}</b><span>{t(`grow.${item.key}Text`)}</span></span>
            <ForwardArrow />
          </Link>
        ))}
      </div>
    </section>
  );
}

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const safeLocale = routing.locales.find((known) => known === locale) ?? routing.defaultLocale;
  const moneyLocale: Locale = safeLocale === 'ar' ? 'ar' : 'en';
  const user = await requireUser(safeLocale);
  const merchantId = user.memberships[0]?.merchantId;
  const t = await getTranslations('home');

  const now = new Date();
  const [merchant, summary, money] = await Promise.all([
    merchantId ? db.merchant.findUnique({ where: { id: merchantId }, select: { nameEn: true, nameAr: true } }) : null,
    merchantId && hasOrdersAccess(user, merchantId) ? getHomeSummary(user, merchantId, now) : null,
    canSeeWallet(user, merchantId) ? loadMoney(user, merchantId) : null,
  ]);
  const name = merchant ? (moneyLocale === 'ar' ? merchant.nameAr : merchant.nameEn) : user.name;
  const separator = moneyLocale === 'ar' ? '، ' : ', ';
  const isQuiet = summary !== null && summary.todayCreated === 0 && summary.needsActionCount === 0;
  const dateOf = (date: string) => formatCalendarDate(date, moneyLocale, true);

  return (
    <>
      <section className="hero" data-testid="home-hero">
        <svg className="swoosh" viewBox="0 0 560 300" aria-hidden="true">
          <path d="M0 300 C140 230 230 120 560 40 V300Z" fill="#174BFF" />
          <path d="M90 300 C220 250 330 170 560 120 V300Z" fill="#0F3BE0" opacity=".7" />
        </svg>
        <div>
          <span className="eyebrow" data-testid="greeting">{t(`greeting.${cairoPartOfDay(now)}`, { name })}</span>
          {summary ? <Headline t={t} summary={summary} separator={separator} /> : null}
          {money ? <p>{t('nextCashOutLine', { date: dateOf(money.nextDate) })}</p> : isQuiet ? <p>{t('quietDay')}</p> : null}
          <div className="row">
            <Link className="btn lime" href="/orders/new"><Icon name="plus" size={16} strokeWidth={2.6} /> {t('createOrder')}</Link>
            <Link className="btn outline-w" href="/pickups"><Icon name="truck" size={16} /> {t('requestPickup')}</Link>
          </div>
        </div>
        {summary ? <HeroStats t={t} summary={summary} money={money} locale={moneyLocale} /> : null}
      </section>

      {summary ? (
        <NeedsActionCard
          totalCount={summary.needsActionCount}
          rows={summary.needsAction.map((order) => ({
            id: order.id,
            number: order.number,
            customerName: order.customerName,
            areaName: moneyLocale === 'ar' ? order.areaNameAr : order.areaNameEn,
            reasonText: order.reason ?? t('needs.noReason'),
            attemptText: t('needs.attempt', { attempt: Math.max(order.attempts, 1), max: MAX_DELIVERY_ATTEMPTS }),
          }))}
        />
      ) : null}

      <div className="split hm-split">
        <div className="grid">
          {summary ? (
            <section className="card" aria-labelledby="hm-chart-title" data-testid="deliveries-card">
              <div className="card-h">
                <div className="grow cell2">
                  <h2 id="hm-chart-title">{t('chart.title')}</h2>
                  <span className="small muted">{t('chart.hint')}</span>
                </div>
              </div>
              <div className="card-b" style={{ paddingTop: 0 }}>
                <DeliveriesChart
                  days={summary.deliveriesLast14Days}
                  isRtl={moneyLocale === 'ar'}
                  text={{
                    summary: t('chart.summary', {
                      delivered: summary.deliveriesLast14Days.reduce((sum, day) => sum + day.delivered, 0),
                      returned: summary.deliveriesLast14Days.reduce((sum, day) => sum + day.returned, 0),
                    }),
                    delivered: t('chart.delivered'),
                    returned: t('chart.returned'),
                    todayLabel: t('chart.todayLabel'),
                    day: t('chart.day'),
                    emptyTitle: t('chart.emptyTitle'),
                    emptyText: t('chart.emptyText'),
                    barTitles: summary.deliveriesLast14Days.map((day) =>
                      t('chart.bar', { date: dateOf(day.date), delivered: day.delivered, returned: day.returned })),
                    dayLabels: summary.deliveriesLast14Days.map((day) => String(Number(day.date.slice(8)))),
                    dates: summary.deliveriesLast14Days.map((day) => dateOf(day.date)),
                  }}
                />
              </div>
            </section>
          ) : null}
        </div>
        <div className="grid">
          {money ? (
            <MoneyCard t={t} money={money} expectedPiasters={summary ? summary.expectedFromActivePiasters : null} locale={moneyLocale} />
          ) : summary ? (
            <ExpectedCard t={t} expectedPiasters={summary.expectedFromActivePiasters} locale={moneyLocale} />
          ) : null}
          <GrowCard t={t} />
        </div>
      </div>
    </>
  );
}
