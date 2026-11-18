import { getTranslations, setRequestLocale } from 'next-intl/server';
import { requireMerchantAccess, requireUser, type SessionUser } from '@/accounts';
import { Link } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';
import { listPickupLocations } from '@/pickups/locations';
import { listPickups, PICKUPS_PAGE_SIZE, type PickupListRow } from '@/pickups/pickups';
import { cairoDateString, cairoDateToUtcStart, formatCairo } from '@/shared/cairo-time';
import { db } from '@/shared/db';
import { Icon } from '@/ui/icon';
import { PickupLocations, type LocationView } from './pickup-locations';
import { PickupsTable, type PickupRowView } from './pickups-table';
import { RequestPickupDialog, type LocationChoice } from './request-pickup-dialog';

type Translate = Awaited<ReturnType<typeof getTranslations<'pickups'>>>;
type Locale = 'en' | 'ar';

const PICKUP_TABS = ['upcoming', 'history', 'locations'] as const;
type PickupTab = (typeof PICKUP_TABS)[number];
// Same window the domain accepts: from tomorrow up to 14 days ahead, Cairo calendar.
const FIRST_PICKUP_DAY_OFFSET = 1;
const LAST_PICKUP_DAY_OFFSET = 14;
const MS_PER_DAY = 86_400_000;
const PAGE_PATTERN = /^\d{1,6}$/;

function firstValue(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? '';
}

function toTab(value: string): PickupTab {
  return PICKUP_TABS.find((tab) => tab === value) ?? 'upcoming';
}

function canManagePickups(user: SessionUser, merchantId: string | undefined): merchantId is string {
  if (!merchantId) return false;
  try {
    requireMerchantAccess(user, merchantId, 'orders');
    return true;
  } catch {
    return false;
  }
}

// Date strings are Cairo calendar days ("YYYY-MM-DD"); adding whole days in UTC keeps them exact.
function addDaysToDate(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * MS_PER_DAY).toISOString().slice(0, 10);
}

function dayLabel(t: Translate, date: string, today: string, locale: Locale): string {
  if (date === today) return t('today');
  if (date === addDaysToDate(today, 1)) return t('tomorrow');
  if (date === addDaysToDate(today, -1)) return t('yesterday');
  return formatCairo(cairoDateToUtcStart(date), locale, 'date');
}

function toRowView(row: PickupListRow, t: Translate, today: string, locale: Locale): PickupRowView {
  return {
    id: row.id,
    number: row.number,
    status: row.status,
    dateLabel: dayLabel(t, row.pickupDate, today, locale),
    addressText: row.addressText,
    contactName: row.contactName,
    contactMobile: row.contactMobile,
    expectedCount: row.expectedCount,
    attachedOrderCount: row.attachedOrderCount,
    collectedCount: row.collectedCount,
    repeatWeekly: row.repeatWeekly,
    rating: row.rating,
  };
}

function NoAccess({ t }: { t: Translate }) {
  return (
    <>
      <h1>{t('title')}</h1>
      <section className="card soon">
        <span className="ic"><Icon name="shield" size={26} /></span>
        <h2>{t('noAccessTitle')}</h2>
        <p className="muted" style={{ margin: 0 }}>{t('noAccessText')}</p>
      </section>
    </>
  );
}

function Pager({ t, tab, page, pageCount, total }: { t: Translate; tab: PickupTab; page: number; pageCount: number; total: number }) {
  const hrefFor = (target: number) => ({
    pathname: '/pickups',
    query: { ...(tab === 'upcoming' ? {} : { tab }), ...(target === 1 ? {} : { page: String(target) }) },
  });
  const from = (page - 1) * PICKUPS_PAGE_SIZE + 1;
  const to = Math.min(total, page * PICKUPS_PAGE_SIZE);
  return (
    <nav className="pager" aria-label={t('pages')}>
      <span className="grow" style={{ textAlign: 'start' }}>
        {total > 0 ? <bdi className="num">{t('range', { from, to, total })}</bdi> : t('noneShown')}
      </span>
      {page > 1 ? (
        <Link className="btn sm" href={hrefFor(page - 1)} scroll={false}>
          <Icon name="back" size={14} /> {t('prev')}
        </Link>
      ) : (
        <button type="button" className="btn sm" disabled><Icon name="back" size={14} /> {t('prev')}</button>
      )}
      <span className="small" aria-label={t('pageNumber', { page })}><bdi className="num">{page} / {pageCount}</bdi></span>
      {page < pageCount ? (
        <Link className="btn sm" href={hrefFor(page + 1)} scroll={false}>{t('next')}</Link>
      ) : (
        <button type="button" className="btn sm" disabled>{t('next')}</button>
      )}
    </nav>
  );
}

export default async function PickupsPage({
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
  const merchantId = user.memberships[0]?.merchantId;
  const t = await getTranslations('pickups');
  if (!canManagePickups(user, merchantId)) return <NoAccess t={t} />;

  const tab = toTab(firstValue(query.tab));
  const pageText = firstValue(query.page);
  const page = PAGE_PATTERN.test(pageText) ? Math.max(1, Number(pageText)) : 1;
  const today = cairoDateString(new Date());

  const [readyCount, locations, list] = await Promise.all([
    db.order.count({ where: { merchantId, status: 'new' } }),
    listPickupLocations(user, merchantId),
    tab === 'locations' ? Promise.resolve(null) : listPickups(user, merchantId, { tab, page }),
  ]);

  const areaName = (location: { areaNameEn: string | null; areaNameAr: string | null }) =>
    (safeLocale === 'ar' ? location.areaNameAr : location.areaNameEn) ?? '';
  const locationChoices: LocationChoice[] = locations.map((location) => ({
    id: location.id,
    label: location.label,
    areaName: areaName(location),
    isDefault: location.isDefault,
  }));
  const locationViews: LocationView[] = locations.map((location) => ({
    id: location.id,
    label: location.label,
    addressText: location.addressText,
    areaId: location.areaId,
    areaName: areaName(location),
    contactName: location.contactName,
    contactMobile: location.contactMobile,
    isDefault: location.isDefault,
  }));
  const dialogProps = {
    readyCount,
    locations: locationChoices,
    minDate: addDaysToDate(today, FIRST_PICKUP_DAY_OFFSET),
    maxDate: addDaysToDate(today, LAST_PICKUP_DAY_OFFSET),
  };

  return (
    <>
      <div className="page-head">
        <div className="grow">
          <h1>{t('title')}</h1>
          <span className="muted" data-testid="pickups-ready">{t('readyCount', { count: readyCount })}</span>
        </div>
        <div className="row">
          <RequestPickupDialog {...dialogProps} withIcon testId="request-pickup-open" />
        </div>
      </div>
      <section className="card" style={{ overflow: 'hidden' }}>
        <nav className="tabs" aria-label={t('tabsLabel')}>
          {PICKUP_TABS.map((candidate) => (
            <Link
              key={candidate}
              href={candidate === 'upcoming' ? '/pickups' : { pathname: '/pickups', query: { tab: candidate } }}
              className={candidate === tab ? 'tab on' : 'tab'}
              aria-current={candidate === tab ? 'page' : undefined}
              data-testid={`pickups-tab-${candidate}`}
            >
              {t(`tabs.${candidate}`)}
            </Link>
          ))}
        </nav>
        {list === null ? (
          <PickupLocations locations={locationViews} />
        ) : list.rows.length === 0 ? (
          <div className="empty" data-testid="pickups-empty">
            <h3>{tab === 'upcoming' ? t('emptyUpcomingTitle') : t('emptyHistoryTitle')}</h3>
            <p>{tab === 'upcoming' ? t('emptyUpcomingText') : t('emptyHistoryText')}</p>
            {tab === 'upcoming' ? <RequestPickupDialog {...dialogProps} testId="request-pickup-empty" /> : null}
          </div>
        ) : (
          <>
            <PickupsTable rows={list.rows.map((row) => toRowView(row, t, today, safeLocale))} />
            {list.pageCount > 1 ? <Pager t={t} tab={tab} page={list.page} pageCount={list.pageCount} total={list.total} /> : null}
          </>
        )}
      </section>
    </>
  );
}
