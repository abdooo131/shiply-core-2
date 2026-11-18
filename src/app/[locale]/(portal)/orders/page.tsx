import { getTranslations, setRequestLocale } from 'next-intl/server';
import { requireMerchantAccess, requireUser, type SessionUser } from '@/accounts';
import { Link } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';
import { ORDER_TABS } from '@/orders/merchant-status';
import { listOrders, PAGE_SIZE, parseOrderListQuery, toQueryString, type OrderListQuery, type OrderListRow } from '@/orders/order-list';
import { listSavedViews } from '@/orders/saved-views';
import { formatCairo } from '@/shared/cairo-time';
import { db } from '@/shared/db';
import { formatPiasters } from '@/shared/money';
import { Icon } from '@/ui/icon';
import type { FilterDef } from './filter-pill';
import { OrdersBoard, type OrderRowView } from './orders-board';
import { ordersHref } from './orders-url';
import type { ViewChoice } from './saved-views-menu';

type Translate = Awaited<ReturnType<typeof getTranslations<'ordersList'>>>;
type Locale = 'en' | 'ar';
type TextOf = (key: string) => string;

const ORDER_TYPES = ['deliver', 'pick_and_choose', 'exchange', 'return', 'sign_and_return', 'cash_collection'] as const;
const DATE_RANGES = ['any', 'today', '7d', '30d'] as const;
const PAYMENTS = ['any', 'cod', 'prepaid'] as const;
const TRIES = ['any', '0', 'some', '3'] as const;
// Page numbers shown on each side of the current page before the list is shortened with "…".
const PAGE_WINDOW = 1;
const CAIRO_CODE = 'C';
const GIZA_CODE = 'GZ';

function canSeeOrders(user: SessionUser, merchantId: string | undefined): merchantId is string {
  if (!merchantId) return false;
  try {
    requireMerchantAccess(user, merchantId, 'orders');
    return true;
  } catch {
    return false;
  }
}

function isFilteredQuery(query: OrderListQuery): boolean {
  return (
    query.q !== '' || query.date !== 'any' || query.gov.length > 0 || query.type.length > 0 || query.pay !== 'any' || query.tries !== 'any'
  );
}

// Decision 6: the mockup's presets that exist today ("Waiting for payout" comes with Money).
function presetViews(t: Translate): ViewChoice[] {
  const base = parseOrderListQuery({});
  return [
    { id: null, name: t('presets.cashCairoGiza'), query: toQueryString({ ...base, pay: 'cod', gov: [CAIRO_CODE, GIZA_CODE] }) },
    { id: null, name: t('presets.triedThree'), query: toQueryString({ ...base, tries: '3' }) },
    { id: null, name: t('presets.createdToday'), query: toQueryString({ ...base, date: 'today' }) },
  ];
}

function filterDefinitions(t: Translate, tTypes: TextOf, governorates: { code: string; name: string }[]): FilterDef[] {
  return [
    {
      key: 'date', kind: 'single', icon: 'cal', label: t('filters.date'), defaultValue: 'any',
      options: DATE_RANGES.map((value) => ({ value, label: t(`dateOptions.${value}`) })),
    },
    {
      key: 'gov', kind: 'multi', icon: 'pin', label: t('filters.gov'), searchable: true,
      options: governorates.map((governorate) => ({ value: governorate.code, label: governorate.name })),
    },
    {
      key: 'type', kind: 'multi', icon: 'box', label: t('filters.type'),
      options: ORDER_TYPES.map((value) => ({ value, label: tTypes(value) })),
    },
    {
      key: 'pay', kind: 'single', icon: 'wallet', label: t('filters.pay'), defaultValue: 'any',
      options: PAYMENTS.map((value) => ({ value, label: t(`payOptions.${value}`) })),
    },
    {
      key: 'tries', kind: 'single', icon: 'truck', label: t('filters.tries'), defaultValue: 'any',
      options: TRIES.map((value) => ({ value, label: t(`triesOptions.${value}`) })),
    },
  ];
}

function toRowView(
  order: OrderListRow,
  locale: Locale,
  labels: { status: TextOf; type: TextOf; governorateName: TextOf },
): OrderRowView {
  return {
    id: order.id,
    number: order.number,
    status: order.status,
    tone: order.tone,
    statusLabel: labels.status(order.merchantStatus),
    typeName: labels.type(order.type),
    customerName: order.customerName,
    customerMobile: order.customerMobile,
    areaName: locale === 'ar' ? order.areaNameAr : order.areaNameEn,
    governorateName: labels.governorateName(order.governorateCode),
    cashText: order.codAmountPiasters > 0 ? formatPiasters(order.codAmountPiasters, locale) : null,
    attempts: order.attempts,
    createdDate: formatCairo(order.createdAt, locale, 'date'),
    createdTime: formatCairo(order.createdAt, locale, 'time'),
  };
}

// 1 … 4 5 6 … 12: the first, the last and the pages next to the current one.
function pageNumbers(page: number, pageCount: number): (number | 'gap')[] {
  const shown: (number | 'gap')[] = [];
  for (let candidate = 1; candidate <= pageCount; candidate += 1) {
    const isNear = Math.abs(candidate - page) <= PAGE_WINDOW;
    if (candidate === 1 || candidate === pageCount || isNear) shown.push(candidate);
    else if (shown[shown.length - 1] !== 'gap') shown.push('gap');
  }
  return shown;
}

function Pager({ t, page, pageCount, total, currentSearch }: { t: Translate; page: number; pageCount: number; total: number; currentSearch: string }) {
  const hrefFor = (target: number) => ordersHref(currentSearch, { page: target === 1 ? null : String(target) });
  const from = (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(total, page * PAGE_SIZE);
  return (
    <nav className="pager" aria-label={t('pages')}>
      <span className="grow" style={{ textAlign: 'start' }}>
        {total > 0 ? <bdi className="num">{t('range', { from, to, total })}</bdi> : t('noneShown')}
      </span>
      {page > 1 ? (
        <Link className="btn sm" href={hrefFor(page - 1)} scroll={false} data-testid="pager-prev">
          <Icon name="back" size={14} /> {t('prev')}
        </Link>
      ) : (
        <button type="button" className="btn sm" disabled><Icon name="back" size={14} /> {t('prev')}</button>
      )}
      {pageCount > 1 ? (
        <span className="pages">
          {pageNumbers(page, pageCount).map((entry, index) =>
            entry === 'gap' ? (
              <span key={`gap-${index}`} aria-hidden="true" style={{ alignSelf: 'center' }}>…</span>
            ) : (
              <Link
                key={entry}
                className={entry === page ? 'btn sm on' : 'btn sm ghost'}
                href={hrefFor(entry)}
                scroll={false}
                aria-label={t('pageNumber', { page: entry })}
                aria-current={entry === page ? 'page' : undefined}
              >
                {entry}
              </Link>
            ),
          )}
        </span>
      ) : null}
      {page < pageCount ? (
        <Link className="btn sm" href={hrefFor(page + 1)} scroll={false} data-testid="pager-next">{t('next')}</Link>
      ) : (
        <button type="button" className="btn sm" disabled>{t('next')}</button>
      )}
    </nav>
  );
}

export default async function OrdersPage({
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
  const t = await getTranslations('ordersList');

  if (!canSeeOrders(user, merchantId)) {
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

  const query = parseOrderListQuery(await searchParams);
  const [result, savedViews, governorateRows, tStatus, tTypes] = await Promise.all([
    listOrders(user, merchantId, query),
    listSavedViews(user, merchantId),
    db.governorate.findMany({ select: { code: true, nameEn: true, nameAr: true } }),
    getTranslations('orderStatus'),
    getTranslations('orderTypes'),
  ]);

  const governorates = governorateRows
    .map((governorate) => ({ code: governorate.code, name: moneyLocale === 'ar' ? governorate.nameAr : governorate.nameEn }))
    .sort((first, second) => first.name.localeCompare(second.name, moneyLocale));
  const governorateNames = new Map(governorates.map((governorate) => [governorate.code, governorate.name]));
  const labels = {
    status: (key: string) => tStatus(key),
    type: (key: string) => tTypes(key),
    governorateName: (code: string) => governorateNames.get(code) ?? code,
  };

  const isFiltered = isFilteredQuery(query);
  const currentSearch = toQueryString({ ...query, page: result.page });
  const viewQuery = toQueryString({ ...query, page: 1 });
  const { tabCounts } = result;

  return (
    <>
      <div className="page-head">
        <div className="grow">
          <h1>{t('title')}</h1>
          {isFiltered ? null : (
            <span className="muted">{t('summary', { count: tabCounts.all, out: tabCounts.out_for_delivery })}</span>
          )}
        </div>
        <Link className="btn primary" href="/orders/new" data-testid="create-order-link">
          <Icon name="plus" size={16} strokeWidth={2.6} /> {t('createOrder')}
        </Link>
      </div>

      <nav className="chips" aria-label={t('tabsLabel')}>
        {ORDER_TABS.map((tab) => (
          <Link
            key={tab}
            href={ordersHref(currentSearch, { tab: tab === 'all' ? null : tab })}
            scroll={false}
            className={['chip', query.tab === tab && 'on', tab === 'needs_action' && 'alert'].filter(Boolean).join(' ')}
            aria-current={query.tab === tab ? 'page' : undefined}
            data-testid={`tab-${tab}`}
          >
            {t(`tabs.${tab}`)}
            <span className="count">{tabCounts[tab]}</span>
          </Link>
        ))}
      </nav>

      <OrdersBoard
        rows={result.orders.map((order) => toRowView(order, moneyLocale, labels))}
        query={{ q: query.q, date: query.date, gov: query.gov, type: query.type, pay: query.pay, tries: query.tries, sort: query.sort }}
        currentSearch={currentSearch}
        viewQuery={viewQuery}
        total={result.total}
        isFiltered={isFiltered}
        filterDefs={filterDefinitions(t, labels.type, governorates)}
        presets={presetViews(t)}
        views={savedViews.map((view) => ({ id: view.id, name: view.name, query: view.query }))}
        pager={<Pager t={t} page={result.page} pageCount={result.pageCount} total={result.total} currentSearch={currentSearch} />}
      />
    </>
  );
}
