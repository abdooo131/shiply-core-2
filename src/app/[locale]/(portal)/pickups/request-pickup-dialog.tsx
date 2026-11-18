'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useId, useRef, useState, useTransition, type FormEvent } from 'react';
import { Link, useRouter } from '@/i18n/navigation';
import { Button } from '@/ui/button';
import { Icon } from '@/ui/icon';
import { Toast } from '@/ui/toast';
import { requestPickupAction } from './actions';

export type LocationChoice = { id: string; label: string; areaName: string; isDefault: boolean };

const DEFAULT_EXPECTED_COUNT = 10;
const MAX_EXPECTED_COUNT = 1000;

// A pickup day ("YYYY-MM-DD") shown as "19 Nov 2026"; the date is a calendar day, so no time zone shift.
function formatPickupDay(date: string, locale: string): string {
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC', numberingSystem: 'latn',
  }).format(new Date(`${date}T00:00:00Z`));
}

// The mockup's pickupModal: day, about how many orders, place, and an optional weekly repeat.
export function RequestPickupDialog({
  readyCount,
  locations,
  minDate,
  maxDate,
  withIcon = false,
  testId,
}: {
  readyCount: number;
  locations: LocationChoice[];
  minDate: string;
  maxDate: string;
  withIcon?: boolean;
  testId: string;
}) {
  const t = useTranslations('pickups');
  const locale = useLocale();
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const ids = useId();
  const [pending, startTransition] = useTransition();
  // A fresh key per request: a double click resends the same key, the next request gets a new one.
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [toast, setToast] = useState<{ key: number; message: string } | null>(null);
  const defaultLocationId = locations.find((location) => location.isDefault)?.id ?? locations[0]?.id ?? '';

  const open = () => {
    setErrorKey(null);
    dialogRef.current?.showModal();
  };
  const close = () => dialogRef.current?.close();

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const pickupDate = String(form.get('pickupDate') ?? '');
    const input = {
      locationId: String(form.get('locationId') ?? ''),
      pickupDate,
      expectedCount: Number(form.get('expectedCount')),
      repeatWeekly: form.get('repeatWeekly') === 'on',
    };
    startTransition(async () => {
      const result = await requestPickupAction(locale, input, idempotencyKey);
      setIdempotencyKey(crypto.randomUUID());
      if (result.status === 'error') {
        setErrorKey(result.errorKey);
        return;
      }
      close();
      setToast({ key: Date.now(), message: t('booked', { date: formatPickupDay(pickupDate, locale) }) });
      router.push('/pickups', { scroll: false });
    });
  };

  return (
    <>
      <Button variant="primary" onClick={open} data-testid={testId}>
        {withIcon ? <Icon name="plus" size={16} strokeWidth={2.6} /> : null}
        {t('requestPickup')}
      </Button>
      <dialog ref={dialogRef} className="modal" aria-labelledby={`${ids}-title`}>
        <div className="modal-h">
          <h2 id={`${ids}-title`}>{t('requestPickup')}</h2>
          <button type="button" className="icon-btn" onClick={close} aria-label={t('close')}>
            <Icon name="x" />
          </button>
        </div>
        {locations.length === 0 ? (
          <>
            <div className="modal-b">
              <div className="found"><Icon name="pin" size={18} /><span>{t('needLocation')}</span></div>
            </div>
            <div className="modal-f">
              <Button onClick={close}>{t('cancel')}</Button>
              <Link className="btn primary" href={{ pathname: '/pickups', query: { tab: 'locations' } }} onClick={close}>
                {t('addLocation')}
              </Link>
            </div>
          </>
        ) : (
          <form onSubmit={submit}>
            <div className="modal-b">
              {errorKey ? <div className="alert" role="alert">{t(`errors.${errorKey}`)}</div> : null}
              <div className="found"><Icon name="box" size={18} /><span>{t('readyToGo', { count: readyCount })}</span></div>
              <div className="grid g2">
                <div className="field">
                  <label htmlFor={`${ids}-day`}>{t('day')}</label>
                  <input id={`${ids}-day`} name="pickupDate" type="date" className="input" required
                    defaultValue={minDate} min={minDate} max={maxDate} data-testid="pickup-day" />
                </div>
                <div className="field">
                  <label htmlFor={`${ids}-count`}>{t('expectedCount')}</label>
                  <input id={`${ids}-count`} name="expectedCount" type="number" className="input" required
                    min={1} max={MAX_EXPECTED_COUNT} step={1} defaultValue={readyCount > 0 ? readyCount : DEFAULT_EXPECTED_COUNT}
                    data-testid="pickup-count" />
                </div>
              </div>
              <div className="field">
                <label htmlFor={`${ids}-location`}>{t('pickupLocation')}</label>
                <select id={`${ids}-location`} name="locationId" className="input" defaultValue={defaultLocationId} data-testid="pickup-location">
                  {locations.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.areaName ? `${location.label} · ${location.areaName}` : location.label}
                    </option>
                  ))}
                </select>
              </div>
              <label className="opt">
                <input type="checkbox" name="repeatWeekly" data-testid="pickup-repeat" />
                <span className="cell2"><b>{t('repeatWeekly')}</b><span className="small muted">{t('repeatHint')}</span></span>
              </label>
            </div>
            <div className="modal-f">
              <Button onClick={close}>{t('cancel')}</Button>
              <Button type="submit" variant="primary" disabled={pending} data-testid="pickup-submit">
                {pending ? t('sending') : t('requestPickup')}
              </Button>
            </div>
          </form>
        )}
      </dialog>
      {toast ? <Toast key={toast.key} message={toast.message} /> : null}
    </>
  );
}
