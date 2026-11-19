import { OrderStatus } from '@prisma/client';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { requireUser } from '@/accounts';
import { routing } from '@/i18n/routing';
import { formatPiasters } from '@/shared/money';
import { canUseSection, listStaffOrders } from '@/staff/staff-queues';
import { firstValue, StaffPager, toPage } from '../staff-pager';
import { MoveOrder } from './move-order';

const STATUS_FILTERS = Object.values(OrderStatus);

function toStatus(value: string | undefined): OrderStatus | undefined {
  return STATUS_FILTERS.find((status) => status === value);
}

export default async function StaffOrdersPage({
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
  if (!canUseSection(user, 'orders')) notFound();
  const t = await getTranslations('staff');

  const status = toStatus(firstValue(query.status));
  const search = (firstValue(query.q) ?? '').trim().slice(0, 40);
  const list = await listStaffOrders(user, { status, search: search || undefined, page: toPage(firstValue(query.page)) });
  const pagerQuery: Record<string, string> = { ...(status ? { status } : {}), ...(search ? { q: search } : {}) };

  return (
    <>
      <div className="page-head">
        <div className="grow">
          <h1>{t('orders.title')}</h1>
          <span className="muted">{t('orders.subtitle')}</span>
        </div>
      </div>

      <form className="staff-tools card card-b" method="get" style={{ marginBottom: 16 }}>
        <label className="field">
          <span>{t('orders.status')}</span>
          <select className="input" name="status" defaultValue={status ?? ''} data-testid="staff-status-filter">
            <option value="">{t('orders.all')}</option>
            {STATUS_FILTERS.map((value) => (
              <option key={value} value={value}>{t(`statuses.${value}`)}</option>
            ))}
          </select>
        </label>
        <label className="field grow">
          <span>{t('orders.searchLabel')}</span>
          <input className="input" type="search" name="q" defaultValue={search} placeholder={t('orders.searchPlaceholder')} maxLength={40} data-testid="staff-order-search" />
        </label>
        <button type="submit" className="btn primary">{t('orders.search')}</button>
      </form>

      <section className="card">
        {list.rows.length === 0 ? (
          <div className="empty">{t('orders.empty')}</div>
        ) : (
          <div className="tbl-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('orders.number')}</th>
                  <th>{t('orders.merchant')}</th>
                  <th>{t('orders.customer')}</th>
                  <th>{t('orders.status')}</th>
                  <th style={{ textAlign: 'end' }}>{t('orders.cod')}</th>
                  <th>{t('orders.moveTo')}</th>
                </tr>
              </thead>
              <tbody>
                {list.rows.map((order) => (
                  <tr key={order.id} data-testid="staff-order-row">
                    <td><span className="oid mono">{order.number}</span></td>
                    <td>{safeLocale === 'ar' ? order.merchantNameAr : order.merchantNameEn}</td>
                    <td>
                      <div className="cell2">
                        <b><bdi>{order.customerName}</bdi></b>
                        <span>{safeLocale === 'ar' ? order.areaNameAr : order.areaNameEn}</span>
                      </div>
                    </td>
                    <td>
                      <div className="cell2">
                        <b>{t(`statuses.${order.status}`)}</b>
                        {order.attempts > 0 ? <span>{t('orders.attempts')}: <bdi className="num">{order.attempts}</bdi></span> : null}
                      </div>
                    </td>
                    <td className="num" style={{ textAlign: 'end' }}><bdi>{formatPiasters(order.codAmountPiasters, safeLocale)}</bdi></td>
                    <td><MoveOrder orderId={order.id} number={order.number} nextStatuses={order.nextStatuses} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <StaffPager pathname="/staff/orders" query={pagerQuery} info={list} />
      </section>
    </>
  );
}
