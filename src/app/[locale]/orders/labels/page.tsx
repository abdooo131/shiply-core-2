import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { requireUser } from '@/accounts';
import { Link } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';
import { barcodeSvg } from '@/orders/barcode';
import { getLabelData, recordLabelPrint, type LabelData } from '@/orders/labels';
import '@/orders/labels.css';
import { AppError } from '@/shared/app-error';
import { formatCairo } from '@/shared/cairo-time';
import { formatPiasters } from '@/shared/money';
import { PrintButton } from './print-button';

type LabelFormat = 'a6' | 'a4';
type Translate = Awaited<ReturnType<typeof getTranslations<'labels'>>>;

const LABEL_FORMATS: readonly LabelFormat[] = ['a6', 'a4'];
// Unknown ids, ids of other merchants and missing access all look the same: no such labels.
const NOT_FOUND_CODES = new Set(['not_found', 'invalid_input', 'forbidden']);

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'labels' });
  return { title: `${t('title')} · Shiply` };
}

function CashLine({ label, t, moneyLocale }: { label: LabelData; t: Translate; moneyLocale: 'en' | 'ar' }) {
  if (label.cashToCollectPiasters > 0) {
    return <p className="awb-cash">{t('cashToCollect', { amount: formatPiasters(label.cashToCollectPiasters, moneyLocale) })}</p>;
  }
  if (label.cashToGivePiasters > 0) {
    return <p className="awb-cash">{t('cashToGive', { amount: formatPiasters(label.cashToGivePiasters, moneyLocale) })}</p>;
  }
  return <p className="awb-cash awb-cash-none">{t('noCash')}</p>;
}

function AirwayBill({ label, t, locale }: { label: LabelData; t: Translate; locale: 'en' | 'ar' }) {
  const isArabic = locale === 'ar';
  const merchantName = isArabic ? label.merchantNameAr : label.merchantNameEn;
  const areaName = isArabic ? label.areaNameAr : label.areaNameEn;
  const governorateName = isArabic ? label.governorateNameAr : label.governorateNameEn;
  return (
    <article className="awb-label" data-testid="awb-label">
      <header className="awb-head">
        <img src="/brand/shiply-logo-light.png" alt="Shiply" width={88} height={32} />
        <span className="awb-created">{t('createdOn', { date: formatCairo(label.createdAt, locale, 'date') })}</span>
      </header>

      <section className="awb-number">
        <span className="awb-k">{t('orderNumber')}</span>
        <b dir="ltr">{label.orderNumber}</b>
        {/* Only barcodeSvg output goes here: it accepts nothing but a 10-digit number. */}
        <div className="awb-barcode" dangerouslySetInnerHTML={{ __html: barcodeSvg(label.orderNumber) }} />
      </section>

      <section className="awb-party">
        <span className="awb-k">{t('from')}</span>
        <b dir="auto">{merchantName}</b>
      </section>

      <section className="awb-party awb-to">
        <span className="awb-k">{t('to')}</span>
        <b dir="auto">{label.customerName}</b>
        <span dir="ltr" className="awb-mobile">{label.customerMobile}</span>
        <p dir="auto">{label.addressText}</p>
        {label.addressExtra ? <p dir="auto">{label.addressExtra}</p> : null}
        <p dir="auto" className="awb-area">{`${areaName} · ${governorateName}`}</p>
      </section>

      <CashLine label={label} t={t} moneyLocale={locale} />

      <section className="awb-facts">
        <span><span className="awb-k">{t('size')}</span> <b>{t(`sizes.${label.size}`)}</b></span>
        <span><span className="awb-k">{t('type')}</span> <b>{t(`types.${label.type}`)}</b></span>
      </section>

      {label.courierNote ? (
        <section className="awb-note">
          <span className="awb-k">{t('courierNote')}</span>
          <p dir="auto">{label.courierNote}</p>
        </section>
      ) : null}
    </article>
  );
}

export default async function LabelsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ ids?: string | string[]; format?: string | string[] }>;
}) {
  const { locale } = await params;
  const { ids: idsParam, format: formatParam } = await searchParams;
  setRequestLocale(locale);
  const safeLocale = routing.locales.find((known) => known === locale) ?? routing.defaultLocale;
  const user = await requireUser(safeLocale);

  if (typeof idsParam !== 'string') notFound();
  const orderIds = idsParam.split(',').map((id) => id.trim()).filter(Boolean);
  const format: LabelFormat = LABEL_FORMATS.find((known) => known === formatParam) ?? 'a6';

  let labels: LabelData[];
  try {
    labels = await getLabelData(user, orderIds);
    await recordLabelPrint(user, orderIds, format);
  } catch (error) {
    if (error instanceof AppError && NOT_FOUND_CODES.has(error.code)) notFound();
    throw error;
  }

  const t = await getTranslations('labels');
  return (
    <div className={`awb-page awb-${format}`}>
      <div className="awb-toolbar">
        <div className="awb-toolbar-title">
          <h1>{t('title')}</h1>
          <span className="muted small">{t('count', { count: labels.length })}</span>
        </div>
        <nav className="awb-formats" aria-label={t('formatLabel')}>
          {LABEL_FORMATS.map((candidate) => (
            <Link
              key={candidate}
              href={{ pathname: '/orders/labels', query: { ids: idsParam, format: candidate } }}
              className={candidate === format ? 'btn sm on' : 'btn sm ghost'}
              aria-current={candidate === format ? 'page' : undefined}
            >
              {t(`formats.${candidate}`)}
            </Link>
          ))}
        </nav>
        <PrintButton label={t('print')} />
      </div>
      <div className="awb-sheets">
        {labels.map((label) => (
          <AirwayBill key={label.orderId} label={label} t={t} locale={safeLocale} />
        ))}
      </div>
    </div>
  );
}
