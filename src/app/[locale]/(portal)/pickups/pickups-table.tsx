'use client';

import type { PickupStatus } from '@prisma/client';
import { useLocale, useTranslations } from 'next-intl';
import { useId, useRef, useState, useTransition, type FormEvent } from 'react';
import { useRouter } from '@/i18n/navigation';
import { Button } from '@/ui/button';
import { Icon } from '@/ui/icon';
import { Pill, type PillTone } from '@/ui/pill';
import { Toast } from '@/ui/toast';
import { cancelPickupAction, ratePickupAction, stopRepeatingAction, type PickupActionResult } from './actions';

export type PickupRowView = {
  id: string;
  number: string;
  status: PickupStatus;
  dateLabel: string;
  addressText: string;
  contactName: string;
  contactMobile: string;
  expectedCount: number;
  attachedOrderCount: number;
  collectedCount: number | null;
  repeatWeekly: boolean;
  rating: number | null;
};

const STATUS_TONES: Record<PickupStatus, PillTone> = { scheduled: 'blue', collected: 'ok', canceled: 'grey' };
const STAR_VALUES = [1, 2, 3, 4, 5] as const;

// Older locations may have no contact yet; only the parts that exist are shown.
export function ContactLine({ name, mobile }: { name: string; mobile: string }) {
  if (!name && !mobile) return null;
  return (
    <span className="small muted">
      {name ? <bdi>{name}</bdi> : null}
      {name && mobile ? ' · ' : null}
      {mobile ? <bdi dir="ltr">{mobile}</bdi> : null}
    </span>
  );
}

function OrdersCell({ row }: { row: PickupRowView }) {
  const t = useTranslations('pickups');
  if (row.status === 'collected') return <b className="num">{row.collectedCount ?? 0}</b>;
  if (row.status === 'canceled') return <span className="muted">—</span>;
  return (
    <span className="cell2" style={{ alignItems: 'flex-end' }}>
      <b className="num" data-testid="pickup-expected">{row.expectedCount}</b>
      {row.attachedOrderCount > 0 ? <span className="small muted">{t('attached', { count: row.attachedOrderCount })}</span> : null}
    </span>
  );
}

function RateDialog({ row, onDone }: { row: PickupRowView; onDone: (message: string) => void }) {
  const t = useTranslations('pickups');
  const locale = useLocale();
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const ids = useId();
  const [rating, setRating] = useState(row.rating ?? 0);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const close = () => dialogRef.current?.close();

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (rating < 1) {
      setErrorKey('rating');
      return;
    }
    const comment = String(new FormData(event.currentTarget).get('comment') ?? '');
    startTransition(async () => {
      const result = await ratePickupAction(locale, row.id, { rating, comment });
      if (result.status === 'error') {
        setErrorKey(result.errorKey);
        return;
      }
      close();
      router.refresh();
      onDone(t('thanks'));
    });
  };

  return (
    <>
      <Button small onClick={() => { setErrorKey(null); dialogRef.current?.showModal(); }} data-testid="pickup-rate">
        {row.rating ? <span aria-label={t('ratedStars', { rating: row.rating })}>{'★'.repeat(row.rating)}</span> : t('rate')}
      </Button>
      <dialog ref={dialogRef} className="modal" aria-labelledby={`${ids}-title`}>
        <div className="modal-h">
          <h2 id={`${ids}-title`}>{t('rateTitle', { number: row.number })}</h2>
          <button type="button" className="icon-btn" onClick={close} aria-label={t('close')}><Icon name="x" /></button>
        </div>
        <form onSubmit={submit}>
          <div className="modal-b" style={{ textAlign: 'start' }}>
            {errorKey ? <div className="alert" role="alert">{t(`errors.${errorKey}`)}</div> : null}
            <div className="chips pk-stars" role="radiogroup" aria-label={t('ratingGroup')}>
              {STAR_VALUES.map((value) => (
                <button key={value} type="button" role="radio" aria-checked={rating === value}
                  aria-label={t('starsLabel', { count: value })} className={rating === value ? 'chip on' : 'chip'}
                  onClick={() => setRating(value)} data-testid={`pickup-star-${value}`}>
                  {'★'.repeat(value)}
                </button>
              ))}
            </div>
            <div className="field">
              <label htmlFor={`${ids}-comment`}>{t('comment')}</label>
              <textarea id={`${ids}-comment`} name="comment" className="input" rows={2} maxLength={300} dir="auto" />
            </div>
          </div>
          <div className="modal-f">
            <Button onClick={close}>{t('cancel')}</Button>
            <Button type="submit" variant="primary" disabled={pending} data-testid="pickup-rate-send">
              {pending ? t('sending') : t('send')}
            </Button>
          </div>
        </form>
      </dialog>
    </>
  );
}

function CancelButton({ row, onDone }: { row: PickupRowView; onDone: (message: string) => void }) {
  const t = useTranslations('pickups');
  const locale = useLocale();
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const ids = useId();
  const [pending, startTransition] = useTransition();
  const close = () => dialogRef.current?.close();

  const confirm = () =>
    startTransition(async () => {
      const result = await cancelPickupAction(locale, row.id);
      close();
      if (result.status === 'error') {
        onDone(t(`errors.${result.errorKey}`));
        return;
      }
      router.refresh();
      onDone(t('canceled', { number: row.number }));
    });

  return (
    <>
      <Button small variant="danger" onClick={() => dialogRef.current?.showModal()} data-testid="pickup-cancel">{t('cancel')}</Button>
      <dialog ref={dialogRef} className="modal" aria-labelledby={`${ids}-title`}>
        <div className="modal-h">
          <h2 id={`${ids}-title`}>{t('cancelTitle', { number: row.number })}</h2>
          <button type="button" className="icon-btn" onClick={close} aria-label={t('close')}><Icon name="x" /></button>
        </div>
        <div className="modal-b" style={{ textAlign: 'start' }}><p style={{ margin: 0 }}>{t('cancelText')}</p></div>
        <div className="modal-f">
          <Button onClick={close}>{t('keepPickup')}</Button>
          <Button variant="danger" onClick={confirm} disabled={pending} data-testid="pickup-cancel-confirm">{t('cancelPickup')}</Button>
        </div>
      </dialog>
    </>
  );
}

function StopRepeatingButton({ row, onDone }: { row: PickupRowView; onDone: (message: string) => void }) {
  const t = useTranslations('pickups');
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const stop = () =>
    startTransition(async () => {
      const result: PickupActionResult = await stopRepeatingAction(locale, row.id);
      if (result.status === 'error') {
        onDone(t(`errors.${result.errorKey}`));
        return;
      }
      router.refresh();
      onDone(t('repeatStopped', { number: row.number }));
    });

  return <Button small onClick={stop} disabled={pending} data-testid="pickup-stop">{t('stopRepeating')}</Button>;
}

// Upcoming and History lists, as in the mockup's pickups table.
export function PickupsTable({ rows }: { rows: PickupRowView[] }) {
  const t = useTranslations('pickups');
  const [toast, setToast] = useState<{ key: number; message: string } | null>(null);
  const showToast = (message: string) => setToast({ key: Date.now(), message });

  return (
    <>
      <div className="tbl-wrap">
        <table>
          <thead>
            <tr>
              <th>{t('columns.pickup')}</th>
              <th>{t('columns.status')}</th>
              <th>{t('columns.date')}</th>
              <th>{t('columns.location')}</th>
              <th>{t('columns.courier')}</th>
              <th className="pk-end">{t('columns.orders')}</th>
              {/* Empty as in the mockup; a visually hidden span here would stretch the phone page sideways. */}
              <th aria-label={t('columns.actions')} />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} data-testid="pickup-row" data-number={row.number}>
                <td className="mono" dir="ltr">{row.number}</td>
                <td>
                  <span className="pk-pills">
                    <Pill tone={STATUS_TONES[row.status]}>{t(`statuses.${row.status}`)}</Pill>
                    {row.repeatWeekly ? <Pill tone="info">{t('everyWeek')}</Pill> : null}
                  </span>
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>{row.dateLabel}</td>
                <td>
                  <div className="cell2">
                    <span dir="auto">{row.addressText}</span>
                    <ContactLine name={row.contactName} mobile={row.contactMobile} />
                  </div>
                </td>
                <td className="muted" style={{ whiteSpace: 'nowrap' }}>{row.status === 'scheduled' ? t('courierOnDay') : '—'}</td>
                <td className="pk-end"><OrdersCell row={row} /></td>
                <td>
                  <div className="pk-acts">
                    {row.status === 'scheduled' && row.repeatWeekly ? <StopRepeatingButton row={row} onDone={showToast} /> : null}
                    {row.status === 'scheduled' ? <CancelButton row={row} onDone={showToast} /> : null}
                    {row.status === 'collected' ? <RateDialog row={row} onDone={showToast} /> : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {toast ? <Toast key={toast.key} message={toast.message} /> : null}
    </>
  );
}
