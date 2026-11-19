'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRef, useState, useTransition } from 'react';
import { useRouter } from '@/i18n/navigation';
import { Icon } from '@/ui/icon';
import { closeCashCyclesAction, markCashOutPaidAction, prepareCashOutsAction } from '../actions';

// Pick a Cairo day, close its cash cycles, then prepare the cash-outs due that day.
export function MoneyTools({ today }: { today: string }) {
  const t = useTranslations('staff');
  const locale = useLocale();
  const router = useRouter();
  const [date, setDate] = useState(today);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);

  const closeCycles = () =>
    startTransition(async () => {
      const result = await closeCashCyclesAction(locale, date);
      if (result.status === 'error') return setMessage({ tone: 'bad', text: t(`errors.${result.errorKey}`) });
      setMessage({ tone: 'ok', text: t('money.closedCycles', { count: result.closed }) });
      router.refresh();
    });

  const prepare = () =>
    startTransition(async () => {
      const result = await prepareCashOutsAction(locale, date);
      if (result.status === 'error') return setMessage({ tone: 'bad', text: t(`errors.${result.errorKey}`) });
      setMessage({ tone: 'ok', text: t('money.prepared', { created: result.created, skipped: result.skipped }) });
      router.refresh();
    });

  return (
    <section className="card card-b grid" style={{ gap: 12, marginBottom: 16 }}>
      <div className="staff-tools">
        <label className="field">
          <span>{t('money.dateLabel')}</span>
          <input className="input" type="date" value={date} onChange={(event) => setDate(event.target.value)} data-testid="money-date" />
        </label>
        <button type="button" className="btn" disabled={pending || !date} onClick={closeCycles} data-testid="close-cycles" title={t('money.closeCyclesHint')}>
          {t('money.closeCycles')}
        </button>
        <button type="button" className="btn primary" disabled={pending || !date} onClick={prepare} data-testid="prepare-cash-outs" title={t('money.prepareHint')}>
          {t('money.prepare')}
        </button>
      </div>
      <span className="small muted">{t('money.closeCyclesHint')} {t('money.prepareHint')}</span>
      {message ? <span role="status" className={message.tone === 'bad' ? 'err-msg' : 'small ok-text'}>{message.text}</span> : null}
    </section>
  );
}

// Finance types the bank's transfer reference; the cash-out is then booked as paid.
export function MarkPaidButton({ cashOutId, number }: { cashOutId: string; number: string }) {
  const t = useTranslations('staff');
  const locale = useLocale();
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [reference, setReference] = useState('');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const save = () =>
    startTransition(async () => {
      const result = await markCashOutPaidAction(locale, cashOutId, reference);
      if (result.status === 'error') return setError(t(`errors.${result.errorKey}`));
      dialogRef.current?.close();
      router.refresh();
    });

  return (
    <>
      <button type="button" className="btn sm primary" onClick={() => dialogRef.current?.showModal()} data-testid={`mark-paid-${number}`}>
        {t('money.markPaid')}
      </button>
      <dialog ref={dialogRef} className="modal" aria-labelledby={`paid-${cashOutId}`}>
        <div className="modal-h">
          <h2 id={`paid-${cashOutId}`}>{t('money.paidTitle', { number })}</h2>
          <button type="button" className="icon-btn" onClick={() => dialogRef.current?.close()} aria-label={t('money.close')}>
            <Icon name="x" />
          </button>
        </div>
        <div className="modal-b grid">
          <label className="field">
            <span>{t('money.referenceLabel')}</span>
            <input className="input" value={reference} minLength={3} maxLength={60} onChange={(event) => setReference(event.target.value)} data-testid="bank-reference" />
          </label>
          {error ? <span role="status" className="err-msg">{error}</span> : null}
        </div>
        <div className="modal-f">
          <button type="button" className="btn" onClick={() => dialogRef.current?.close()}>{t('money.close')}</button>
          <button type="button" className="btn primary" disabled={pending || reference.trim().length < 3} onClick={save} data-testid="save-paid">
            {t('money.save')}
          </button>
        </div>
      </dialog>
    </>
  );
}
