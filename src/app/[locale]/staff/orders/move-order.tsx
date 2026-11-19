'use client';

import type { OrderStatus } from '@prisma/client';
import { useLocale, useTranslations } from 'next-intl';
import { useRef, useState, useTransition } from 'react';
import { useRouter } from '@/i18n/navigation';
import { FAILURE_REASONS } from '@/orders/failure-reasons';
import { Icon } from '@/ui/icon';
import { moveOrderAction } from '../actions';

// The next-status buttons for one order. A failed attempt asks why first.
export function MoveOrder({ orderId, number, nextStatuses }: { orderId: string; number: string; nextStatuses: OrderStatus[] }) {
  const t = useTranslations('staff');
  const locale = useLocale();
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const [reason, setReason] = useState<string>(FAILURE_REASONS[0]);
  const [note, setNote] = useState('');

  if (nextStatuses.length === 0) return <span className="small muted">{t('orders.noMoves')}</span>;

  const move = (to: OrderStatus, details: { reason?: string; note?: string } = {}) =>
    startTransition(async () => {
      const result = await moveOrderAction(locale, orderId, to, details);
      dialogRef.current?.close();
      if (result.status === 'error') {
        setMessage({ tone: 'bad', text: t(`errors.${result.errorKey}`) });
        return;
      }
      setMessage({ tone: 'ok', text: t('orders.moved', { number, status: t(`statuses.${to}`) }) });
      router.refresh();
    });

  return (
    <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
      {nextStatuses.map((to) => (
        <button
          key={to}
          type="button"
          className={to === 'delivered' ? 'btn sm primary' : 'btn sm'}
          disabled={pending}
          data-testid={`move-${number}-${to}`}
          onClick={() => (to === 'attempt_failed' ? dialogRef.current?.showModal() : move(to))}
        >
          {t(`statuses.${to}`)}
        </button>
      ))}
      {message ? (
        <span role="status" className={message.tone === 'bad' ? 'small err-msg' : 'small ok-text'}>{message.text}</span>
      ) : null}

      {nextStatuses.includes('attempt_failed') ? (
        <dialog ref={dialogRef} className="modal" aria-labelledby={`fail-${orderId}`}>
          <div className="modal-h">
            <h2 id={`fail-${orderId}`}>{t('orders.reasonTitle')}</h2>
            <button type="button" className="icon-btn" onClick={() => dialogRef.current?.close()} aria-label={t('orders.cancel')}>
              <Icon name="x" />
            </button>
          </div>
          <div className="modal-b grid">
            <label className="field">
              <span>{t('orders.reasonLabel')}</span>
              <select className="input" value={reason} onChange={(event) => setReason(event.target.value)} data-testid="fail-reason">
                {FAILURE_REASONS.map((key) => (
                  <option key={key} value={key}>{t(`orders.reasons.${key}`)}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{t('orders.noteLabel')}</span>
              <input className="input" value={note} maxLength={1000} onChange={(event) => setNote(event.target.value)} />
            </label>
          </div>
          <div className="modal-f">
            <button type="button" className="btn" onClick={() => dialogRef.current?.close()}>{t('orders.cancel')}</button>
            <button
              type="button"
              className="btn primary"
              disabled={pending}
              data-testid="fail-confirm"
              onClick={() => move('attempt_failed', { reason, note })}
            >
              {t('orders.confirm')}
            </button>
          </div>
        </dialog>
      ) : null}
    </div>
  );
}
