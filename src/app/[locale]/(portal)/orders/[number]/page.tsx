import type { OrderStatus } from '@prisma/client';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { ReactNode } from 'react';
import { requireUser } from '@/accounts';
import { Link } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';
import { MAX_DELIVERY_ATTEMPTS } from '@/orders';
import { merchantStatusOf } from '@/orders/merchant-status';
import { getOrderDetail, type OrderDetail } from '@/orders/order-detail';
import { AppError } from '@/shared/app-error';
import { formatCairo } from '@/shared/cairo-time';
import { formatPiasters } from '@/shared/money';
import { Icon, type IconName } from '@/ui/icon';
import { Pill } from '@/ui/pill';
import { AwaitingAnswer } from './awaiting-answer';
import { OrderHeaderActions } from './order-header-actions';
import { OrderNoteForm } from './order-note-form';

type Locale = 'en' | 'ar';
type Translate = Awaited<ReturnType<typeof getTranslations<'orderPage'>>>;
type TranslateRoot = Awaited<ReturnType<typeof getTranslations>>;

// Progress stages from the mockup STAGE map: created, picked up, on the way, delivered (or returned).
const LAST_STAGE = 3;
const CANCELED_STAGE = -1;
const STAGE_OF: Record<OrderStatus, number> = {
  new: 0,
  pickup_requested: 0,
  picked_up: 1,
  in_progress: 1,
  attempt_failed: 1,
  rescheduled: 2,
  awaiting_merchant_action: 2,
  out_for_delivery: 2,
  returning: 2,
  delivered: 3,
  returned: 3,
  canceled: CANCELED_STAGE,
};
const COMING_BACK: ReadonlySet<OrderStatus> = new Set(['returning', 'returned']);
const KNOWN_REASONS: ReadonlySet<string> = new Set(['merchant_canceled']);
const CAIRO_TIME_ZONE = 'Africa/Cairo';

// Short "Tue 17 Nov" like the mockup tracker, so four dates fit side by side on a phone.
function formatStageDate(date: Date, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', timeZone: CAIRO_TIME_ZONE, numberingSystem: 'latn',
  }).format(date);
}

function KeyValue({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div style={wide ? { gridColumn: '1 / -1' } : undefined}>
      <span>{label}</span>
      {children}
    </div>
  );
}

// The first time the order reached each stage, read from its status history.
function stageDates(order: OrderDetail): (Date | null)[] {
  const dates: (Date | null)[] = [order.createdAt, null, null, null];
  for (const entry of order.timeline) {
    if (entry.kind !== 'status_changed' || !entry.toStatus) continue;
    const reached = STAGE_OF[entry.toStatus];
    for (let stage = 1; stage <= reached; stage += 1) dates[stage] ??= entry.at;
  }
  return dates;
}

function Tracker({ order, t, locale }: { order: OrderDetail; t: Translate; locale: Locale }) {
  const current = STAGE_OF[order.status];
  const isBack = COMING_BACK.has(order.status);
  const dates = stageDates(order);
  const stages: { label: string; icon: IconName }[] = [
    { label: t('stages.created'), icon: 'doc' },
    { label: t('stages.pickedUp'), icon: 'box' },
    { label: t('stages.onTheWay'), icon: 'truck' },
    { label: isBack ? t('stages.returned') : t('stages.delivered'), icon: 'done' },
  ];
  const progress = Math.max(current, 0) / LAST_STAGE;

  return (
    <section className="card card-b" aria-label={t('progress')}>
      <ol className={isBack ? 'tracker back' : 'tracker'} style={{ ['--p' as string]: progress }}>
        {stages.map((stage, index) => {
          const isDone = index < current || (index === current && current === LAST_STAGE);
          const isNow = index === current && current < LAST_STAGE;
          const reachedAt = index <= current ? dates[index] : null;
          let when = t('none');
          if (reachedAt) when = formatStageDate(reachedAt, locale);
          else if (index === LAST_STAGE && order.expectedDeliveryDate && current !== CANCELED_STAGE) {
            when = t('expectedOn', { date: formatStageDate(order.expectedDeliveryDate, locale) });
          }
          return (
            <li key={stage.label} className={['tstep', isDone && 'done', isNow && 'now'].filter(Boolean).join(' ')} aria-current={isNow ? 'step' : undefined}>
              <span className="nd"><Icon name={stage.icon} size={20} /></span>
              <b>{stage.label}</b>
              <span>{when}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function paymentOf(order: OrderDetail, t: Translate): { label: string; amountPiasters: number } {
  if (order.type === 'return') return { label: t('payment.refund'), amountPiasters: order.refundPiasters };
  if (order.refundPiasters > 0) return { label: t('payment.cashToGive'), amountPiasters: order.refundPiasters };
  return { label: t('payment.cashToCollect'), amountPiasters: order.codAmountPiasters };
}

function DetailsTab({ order, t, tRoot, locale }: { order: OrderDetail; t: Translate; tRoot: TranslateRoot; locale: Locale }) {
  const money = (piasters: number) => formatPiasters(piasters, locale);
  const yesNo = (value: boolean) => (value ? t('yes') : t('no'));
  const area = locale === 'ar' ? `${order.area.nameAr}، ${order.area.governorate.nameAr}` : `${order.area.nameEn}, ${order.area.governorate.nameEn}`;
  const payment = paymentOf(order, t);
  const { fees } = order;

  return (
    <div className="split od-split">
      <div className="grid">
        <section className="card">
          <div className="card-h b"><h2>{t('customer.title')}</h2></div>
          <div className="card-b kv">
            <KeyValue label={t('customer.name')}><b dir="auto">{order.customerName}</b></KeyValue>
            <KeyValue label={t('customer.mobile')}><span className="mono" data-testid="customer-mobile">{order.customerMobile}</span></KeyValue>
            <KeyValue label={t('customer.address')}><span dir="auto">{order.addressText}</span></KeyValue>
            <KeyValue label={t('customer.extra')}><span dir="auto">{order.addressExtra ?? t('none')}</span></KeyValue>
            <KeyValue label={t('customer.area')}>{area}</KeyValue>
          </div>
        </section>

        <section className="card">
          <div className="card-h b"><h2>{t('shipment.title')}</h2></div>
          <div className="card-b kv">
            <KeyValue label={t('shipment.type')}>{tRoot(`orderTypes.${order.type}`)}</KeyValue>
            <KeyValue label={t('shipment.size')}>{tRoot(`createOrder.sizes.${order.size}`)}</KeyValue>
            <KeyValue label={t('shipment.openPackage')}>{yesNo(order.allowOpenPackage)}</KeyValue>
            <KeyValue label={t('shipment.reference')}>
              {order.merchantReference ? <span className="mono">{order.merchantReference}</span> : t('none')}
            </KeyValue>
            <KeyValue label={t('shipment.description')} wide><span dir="auto">{order.description ?? t('none')}</span></KeyValue>
            {order.items.length > 0 ? (
              <KeyValue label={t('shipment.items')} wide>
                <ul className="od-items">
                  {order.items.map((item, index) => (
                    <li key={`${item.nameEn}-${index}`}>
                      {t('shipment.itemLine', { quantity: item.quantity, name: locale === 'ar' ? item.nameAr : item.nameEn, price: money(item.pricePiasters) })}
                    </li>
                  ))}
                </ul>
              </KeyValue>
            ) : null}
            <KeyValue label={t('shipment.courierNote')} wide><span dir="auto">{order.courierNote ?? t('none')}</span></KeyValue>
          </div>
        </section>

        <section className="card">
          <div className="card-h b"><h2>{t('delivery.title')}</h2></div>
          <div className="card-b kv">
            <KeyValue label={t('delivery.attempts')}>{t('delivery.attemptsValue', { attempts: order.attempts, max: MAX_DELIVERY_ATTEMPTS })}</KeyValue>
            <KeyValue label={t('delivery.expected')}>
              {order.expectedDeliveryDate ? formatCairo(order.expectedDeliveryDate, locale, 'date') : <span className="muted">{t('delivery.notScheduled')}</span>}
            </KeyValue>
            <KeyValue label={t('delivery.label')}>{order.isPrinted ? t('delivery.printed') : <span className="muted">{t('delivery.notPrinted')}</span>}</KeyValue>
          </div>
        </section>
      </div>

      <div className="grid">
        <section className="card stat money" data-testid="payment-card">
          <span className="k">{payment.label}</span>
          <span className="v" data-testid="payment-amount">{money(payment.amountPiasters)}</span>
          <div className="lines od-lines small">
            <div><span>{t('payment.deposit')}</span><b>{yesNo(order.depositRequired)}</b></div>
            <div>
              <span>{t('payment.insuredValue')}</span>
              <b>{order.insuredValuePiasters > 0 ? money(order.insuredValuePiasters) : t('payment.notInsured')}</b>
            </div>
          </div>
        </section>

        <section className="card" data-testid="fee-breakdown">
          <div className="card-h b"><h2>{t('fees.title')}</h2></div>
          <div className="card-b lines od-lines small">
            <div><span className="muted">{t('fees.shipping')}</span><span>{money(fees.shippingPiasters)}</span></div>
            {fees.openPackagePiasters > 0 ? <div><span className="muted">{t('fees.openPackage')}</span><span>{money(fees.openPackagePiasters)}</span></div> : null}
            {fees.codFeePiasters > 0 ? <div><span className="muted">{t('fees.codFee')}</span><span>{money(fees.codFeePiasters)}</span></div> : null}
            {fees.insurancePiasters > 0 ? <div><span className="muted">{t('fees.insurance')}</span><span>{money(fees.insurancePiasters)}</span></div> : null}
            <div><span className="muted">{t('fees.vat')}</span><span>{money(fees.vatPiasters)}</span></div>
            <div className="total"><span>{t('fees.total')}</span><span data-testid="fee-total">{money(fees.totalFeePiasters)}</span></div>
          </div>
        </section>

        {order.linkedOrders.length > 0 ? (
          <section className="card">
            <div className="card-h b"><h2>{t('linked.title')}</h2></div>
            <div className="card-b lines od-lines small">
              {order.linkedOrders.map((linked) => (
                <div key={`${linked.direction}-${linked.number}`}>
                  <span className="muted">{t(`linked.${linked.direction}`)} · {tRoot(`orderTypes.${linked.type}`)}</span>
                  <Link href={`/orders/${linked.number}`} className="mono od-link">#{linked.number}</Link>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <OrderNoteForm orderId={order.id} />
      </div>
    </div>
  );
}

function timelineTitle(entry: OrderDetail['timeline'][number], t: Translate, tRoot: TranslateRoot): string {
  if (entry.kind === 'created') return t('timeline.created');
  if (entry.kind === 'status_changed' && entry.toStatus) {
    const status = tRoot(`orderStatus.${entry.toStatus}`);
    return entry.reason && KNOWN_REASONS.has(entry.reason) ? `${status} · ${t(`timeline.reasons.${entry.reason}` as 'timeline.reasons.merchant_canceled')}` : status;
  }
  return t('timeline.note');
}

function TrackingTab({ order, t, tRoot, locale }: { order: OrderDetail; t: Translate; tRoot: TranslateRoot; locale: Locale }) {
  const newestFirst = [...order.timeline].reverse();
  return (
    <div className="grid g2 od-tracking">
      <section className="card">
        <div className="card-h b"><h2>{t('timeline.title')}</h2></div>
        <ol className="card-b timeline" data-testid="timeline">
          {newestFirst.map((entry, index) => (
            <li key={`${entry.at.toISOString()}-${index}`} className="tl">
              <i />
              <div className="cell2">
                <b>{timelineTitle(entry, t, tRoot)}</b>
                {entry.note ? <p className="tl-note" dir="auto">{entry.note}</p> : null}
                <span>{formatCairo(entry.at, locale, 'dateTime')}</span>
              </div>
            </li>
          ))}
        </ol>
      </section>
      <OrderNoteForm orderId={order.id} />
    </div>
  );
}

export default async function OrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; number: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, number } = await params;
  setRequestLocale(locale);
  const safeLocale: Locale = routing.locales.find((known) => known === locale) ?? routing.defaultLocale;
  const user = await requireUser(safeLocale);
  const merchantId = user.memberships[0]?.merchantId;
  if (!merchantId) notFound();

  let order: OrderDetail;
  try {
    order = await getOrderDetail(user, merchantId, number);
  } catch (error) {
    if (error instanceof AppError && error.code === 'not_found') notFound();
    throw error;
  }

  const { tab } = await searchParams;
  const isTracking = tab === 'tracking';
  const t = await getTranslations('orderPage');
  const tRoot = await getTranslations();
  const status = merchantStatusOf(order.status);
  const subtitle = t('subtitle', {
    type: tRoot(`orderTypes.${order.type}`),
    size: tRoot(`createOrder.sizes.${order.size}`),
    date: formatCairo(order.createdAt, safeLocale, 'dateTime'),
  });

  return (
    <>
      <div>
        <Link href="/orders" className="btn ghost sm od-back"><Icon name="back" size={14} /> {t('backToOrders')}</Link>
      </div>
      <div className="page-head">
        <div className="grow">
          <h1 dir="auto">{order.customerName}</h1>
          <p className="muted small" style={{ margin: 0 }}>
            <span className="mono" data-testid="order-number">#{order.number}</span> · {subtitle}
          </p>
        </div>
        <div className="row od-actions">
          <span data-testid="order-status"><Pill tone={status.tone}>{tRoot(`orderStatus.${status.key}`)}</Pill></span>
          <OrderHeaderActions
            orderId={order.id}
            orderNumber={order.number}
            customerName={order.customerName}
            canCancel={order.allowedActions.cancel}
            canCreateExchange={order.allowedActions.createExchange}
            canCreateReturn={order.allowedActions.createReturn}
          />
        </div>
      </div>

      <Tracker order={order} t={t} locale={safeLocale} />

      <AwaitingAnswer orderId={order.id} isAwaiting={order.allowedActions.answerAwaiting} attempt={order.attempts} maxAttempts={MAX_DELIVERY_ATTEMPTS} />

      <nav className="tabs" aria-label={t('tabs.label')}>
        <Link href={`/orders/${order.number}`} className={isTracking ? 'tab' : 'tab on'} aria-current={isTracking ? undefined : 'page'}>
          {t('tabs.details')}
        </Link>
        <Link href={`/orders/${order.number}?tab=tracking`} className={isTracking ? 'tab on' : 'tab'} aria-current={isTracking ? 'page' : undefined}>
          {t('tabs.tracking')}
        </Link>
      </nav>

      {isTracking ? <TrackingTab order={order} t={t} tRoot={tRoot} locale={safeLocale} /> : <DetailsTab order={order} t={t} tRoot={tRoot} locale={safeLocale} />}
    </>
  );
}
