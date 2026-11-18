import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { ReactNode } from 'react';
import { requireUser, type SessionUser } from '@/accounts';
import { Link } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';
import { getTransferProof } from '@/money';
import { AppError } from '@/shared/app-error';
import { formatCairo } from '@/shared/cairo-time';
import { formatPiasters } from '@/shared/money';
import { Icon } from '@/ui/icon';
import { formatCalendarDate, type Locale } from '../../wallet-formatting';
import { ProofActions } from './proof-actions';
import { canSeeWallet } from '../../wallet-access';

async function loadProof(user: SessionUser, merchantId: string, cashOutId: string) {
  try {
    return await getTransferProof(user, merchantId, cashOutId);
  } catch (error) {
    if (error instanceof AppError && error.code === 'not_found') notFound();
    throw error;
  }
}

function SlipRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="sl-r">
      <span>{label}</span>
      <b>{children}</b>
    </div>
  );
}

function cyclesText(dates: string[], locale: Locale): string {
  const first = dates[0];
  const last = dates[dates.length - 1];
  if (!first || !last) return '';
  if (first === last) return formatCalendarDate(first, locale);
  return `${formatCalendarDate(first, locale)} – ${formatCalendarDate(last, locale)}`;
}

export default async function TransferProofPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const safeLocale = routing.locales.find((known) => known === locale) ?? routing.defaultLocale;
  const moneyLocale: Locale = safeLocale === 'ar' ? 'ar' : 'en';
  const user = await requireUser(safeLocale);
  const merchantId = user.memberships[0]?.merchantId;
  const t = await getTranslations('wallet');

  if (!canSeeWallet(user, merchantId)) {
    return (
      <>
        <h1>{t('proof.title')}</h1>
        <section className="card soon">
          <span className="ic"><Icon name="shield" size={26} /></span>
          <h2>{t('noAccessTitle')}</h2>
          <p className="muted" style={{ margin: 0 }}>{t('noAccessText')}</p>
        </section>
      </>
    );
  }

  const proof = await loadProof(user, merchantId, id);
  const merchantName = moneyLocale === 'ar' ? proof.merchantNameAr : proof.merchantNameEn;
  const paidText = proof.paidAt ? formatCairo(proof.paidAt, moneyLocale, 'dateTime') : '—';

  return (
    <>
      <div className="page-head no-print">
        <div className="grow">
          <Link className="linkbtn" href="/wallet" style={{ padding: 0, alignSelf: 'flex-start' }}>
            <Icon name="back" size={14} /> {t('proof.back')}
          </Link>
          <h1>{t('proof.title')}</h1>
        </div>
        <ProofActions bankReference={proof.bankReference} />
      </div>

      <article className="slip" aria-label={t('proof.slipLabel', { number: proof.number })} data-testid="transfer-proof">
        <div className="sl-top">
          <img src="/brand/shiply-logo-light.png" alt="Shiply" width={72} height={26} />
          <div className="sl-title">
            <b>{t('proof.title')}</b>
            <span>{t('proof.cashOutNumber')} <span className="mono">{proof.number}</span></span>
          </div>
        </div>
        <div className="sl-amt">
          <span>{t('proof.amount')}</span>
          <b><bdi>{formatPiasters(proof.amountPiasters, moneyLocale)}</bdi></b>
          <span className="sl-ok"><Icon name="check" size={12} strokeWidth={3} /> {t('proof.completed')}</span>
        </div>
        <div className="sl-cols">
          <div>
            <span className="sl-k">{t('proof.from')}</span>
            <b>Shiply</b>
            <span>{t('proof.fromHint')}</span>
          </div>
          <div>
            <span className="sl-k">{t('proof.to')}</span>
            <b>{merchantName}</b>
            <span>{proof.bankName} · <span className="mono">{proof.maskedIban}</span></span>
            <span>{t('proof.holder', { name: proof.holderName })}</span>
          </div>
        </div>
        <div className="sl-rows">
          <SlipRow label={t('proof.bankReference')}><span className="mono">{proof.bankReference ?? '—'}</span></SlipRow>
          <SlipRow label={t('proof.paidOn')}>{paidText}</SlipRow>
          <SlipRow label={t('proof.method')}>{t('proof.bankTransfer')}</SlipRow>
          <SlipRow label={t('proof.for')}>
            {proof.cycleCount > 0
              ? t('proof.cycles', { range: cyclesText(proof.cycleDates, moneyLocale), count: proof.cycleCount })
              : t('proof.walletBalance')}
          </SlipRow>
        </div>
        <p className="sl-note">{proof.hasReceipt ? `${t('proof.note')} ${t('proof.receiptOnFile')}` : t('proof.note')}</p>
      </article>
    </>
  );
}
