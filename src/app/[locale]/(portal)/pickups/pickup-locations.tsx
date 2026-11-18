'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useId, useRef, useState, useTransition, type FormEvent } from 'react';
import { useRouter } from '@/i18n/navigation';
import { Button } from '@/ui/button';
import { Field } from '@/ui/field';
import { Icon } from '@/ui/icon';
import { Pill } from '@/ui/pill';
import { Toast } from '@/ui/toast';
import { archiveLocationAction, savePickupLocationAction, setDefaultLocationAction } from './actions';
import { ContactLine } from './pickups-table';

export type LocationView = {
  id: string;
  label: string;
  addressText: string;
  areaId: string | null;
  areaName: string;
  contactName: string;
  contactMobile: string;
  isDefault: boolean;
};

type AreaOption = { id: string; nameEn: string; nameAr: string; governorateNameEn: string; governorateNameAr: string };
type ShowToast = (message: string) => void;

const AREA_SEARCH_DELAY_MS = 200;
const AREA_LIST_CLOSE_DELAY_MS = 150;

// Add or edit one location. The area is picked from the same search as Create order.
function LocationDialog({ location, onDone }: { location: LocationView | null; onDone: ShowToast }) {
  const t = useTranslations('pickups');
  const locale = useLocale();
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const ids = useId();
  const areaRequest = useRef(0);
  const [areaId, setAreaId] = useState(location?.areaId ?? '');
  const [areaText, setAreaText] = useState(location?.areaName ?? '');
  const [areaOptions, setAreaOptions] = useState<AreaOption[]>([]);
  const [areaOpen, setAreaOpen] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const close = () => dialogRef.current?.close();

  const searchArea = (text: string) => {
    setAreaText(text);
    setAreaId('');
    const requestId = (areaRequest.current += 1);
    if (!text.trim()) {
      setAreaOptions([]);
      return;
    }
    setTimeout(async () => {
      if (requestId !== areaRequest.current) return;
      const response = await fetch(`/api/areas?q=${encodeURIComponent(text)}`);
      if (!response.ok || requestId !== areaRequest.current) return;
      const body = (await response.json()) as { areas: AreaOption[] };
      setAreaOptions(body.areas);
      setAreaOpen(true);
    }, AREA_SEARCH_DELAY_MS);
  };

  const areaLabel = (area: AreaOption) =>
    locale === 'ar' ? `${area.nameAr}، ${area.governorateNameAr}` : `${area.nameEn}, ${area.governorateNameEn}`;

  const chooseArea = (area: AreaOption) => {
    setAreaId(area.id);
    setAreaText(areaLabel(area));
    setAreaOpen(false);
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!areaId) {
      setErrorKey('area');
      return;
    }
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const input = {
      ...(location ? { id: location.id } : {}),
      label: String(form.get('label') ?? ''),
      addressText: String(form.get('addressText') ?? ''),
      areaId,
      contactName: String(form.get('contactName') ?? ''),
      contactMobile: String(form.get('contactMobile') ?? ''),
    };
    startTransition(async () => {
      const result = await savePickupLocationAction(locale, input);
      if (result.status === 'error') {
        setErrorKey(result.errorKey);
        return;
      }
      close();
      if (!location) {
        formElement.reset();
        setAreaId('');
        setAreaText('');
      }
      router.refresh();
      onDone(t('locationSaved'));
    });
  };

  return (
    <>
      {location ? (
        <Button small onClick={() => { setErrorKey(null); dialogRef.current?.showModal(); }} data-testid="location-edit">{t('edit')}</Button>
      ) : (
        <Button variant="primary" onClick={() => { setErrorKey(null); dialogRef.current?.showModal(); }} data-testid="location-add">
          <Icon name="plus" size={16} strokeWidth={2.6} /> {t('addLocation')}
        </Button>
      )}
      <dialog ref={dialogRef} className="modal" aria-labelledby={`${ids}-title`}>
        <div className="modal-h">
          <h2 id={`${ids}-title`}>{location ? t('editLocation') : t('addLocation')}</h2>
          <button type="button" className="icon-btn" onClick={close} aria-label={t('close')}><Icon name="x" /></button>
        </div>
        <form onSubmit={submit}>
          <div className="modal-b" style={{ textAlign: 'start' }}>
            {errorKey ? <div className="alert" role="alert">{t(`errors.${errorKey}`)}</div> : null}
            <Field label={t('label')} name="label" required maxLength={60} dir="auto" placeholder={t('labelPlaceholder')}
              defaultValue={location?.label} data-testid="location-label" />
            <Field label={t('address')} name="addressText" required minLength={3} maxLength={300} dir="auto"
              placeholder={t('addressPlaceholder')} defaultValue={location?.addressText} data-testid="location-address" />
            <div className="field" style={{ position: 'relative' }}>
              <label htmlFor={`${ids}-area`}>{t('area')}</label>
              <input
                id={`${ids}-area`}
                className={errorKey === 'area' ? 'input err' : 'input'}
                role="combobox"
                aria-expanded={areaOpen && areaOptions.length > 0}
                aria-controls={`${ids}-areas`}
                aria-autocomplete="list"
                autoComplete="off"
                placeholder={t('areaPlaceholder')}
                value={areaText}
                onChange={(event) => searchArea(event.target.value)}
                onFocus={() => setAreaOpen(true)}
                onBlur={() => setTimeout(() => setAreaOpen(false), AREA_LIST_CLOSE_DELAY_MS)}
                data-testid="location-area"
              />
              {areaOpen && areaOptions.length > 0 ? (
                <ul id={`${ids}-areas`} role="listbox" className="card suggest">
                  {areaOptions.map((area) => (
                    <li key={area.id} role="option" aria-selected={area.id === areaId} onMouseDown={() => chooseArea(area)}>
                      {areaLabel(area)}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            <div className="grid g2">
              <Field label={t('contactName')} name="contactName" required maxLength={80} dir="auto"
                defaultValue={location?.contactName} data-testid="location-contact-name" />
              <Field label={t('contactMobile')} name="contactMobile" required maxLength={30} dir="ltr" inputMode="tel"
                placeholder="010 1234 5678" defaultValue={location?.contactMobile} data-testid="location-contact-mobile" />
            </div>
          </div>
          <div className="modal-f">
            <Button onClick={close}>{t('cancel')}</Button>
            <Button type="submit" variant="primary" disabled={pending} data-testid="location-save">
              {pending ? t('saving') : t('saveLocation')}
            </Button>
          </div>
        </form>
      </dialog>
    </>
  );
}

function ArchiveButton({ location, onDone }: { location: LocationView; onDone: ShowToast }) {
  const t = useTranslations('pickups');
  const locale = useLocale();
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const ids = useId();
  const [pending, startTransition] = useTransition();
  const close = () => dialogRef.current?.close();

  const confirm = () =>
    startTransition(async () => {
      const result = await archiveLocationAction(locale, location.id);
      close();
      if (result.status === 'error') {
        onDone(t(`errors.${result.errorKey}`));
        return;
      }
      router.refresh();
      onDone(t('archived', { label: location.label }));
    });

  return (
    <>
      <Button small variant="danger" onClick={() => dialogRef.current?.showModal()} data-testid="location-archive">{t('archive')}</Button>
      <dialog ref={dialogRef} className="modal" aria-labelledby={`${ids}-title`}>
        <div className="modal-h">
          <h2 id={`${ids}-title`}>{t('archiveTitle', { label: location.label })}</h2>
          <button type="button" className="icon-btn" onClick={close} aria-label={t('close')}><Icon name="x" /></button>
        </div>
        <div className="modal-b"><p style={{ margin: 0 }}>{t('archiveText')}</p></div>
        <div className="modal-f">
          <Button onClick={close}>{t('keepLocation')}</Button>
          <Button variant="danger" onClick={confirm} disabled={pending} data-testid="location-archive-confirm">{t('archive')}</Button>
        </div>
      </dialog>
    </>
  );
}

function MakeDefaultButton({ location, onDone }: { location: LocationView; onDone: ShowToast }) {
  const t = useTranslations('pickups');
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const makeDefault = () =>
    startTransition(async () => {
      const result = await setDefaultLocationAction(locale, location.id);
      if (result.status === 'error') {
        onDone(t(`errors.${result.errorKey}`));
        return;
      }
      router.refresh();
      onDone(t('defaultSet', { label: location.label }));
    });

  return <Button small onClick={makeDefault} disabled={pending} data-testid="location-default">{t('makeDefault')}</Button>;
}

// The Locations tab: every active place couriers collect from, with the default first.
export function PickupLocations({ locations }: { locations: LocationView[] }) {
  const t = useTranslations('pickups');
  const [toast, setToast] = useState<{ key: number; message: string } | null>(null);
  const showToast: ShowToast = (message) => setToast({ key: Date.now(), message });

  return (
    <>
      <div className="card-h">
        <div className="grow cell2">
          <h2>{t('locationsTitle')}</h2>
          <span className="small muted">{t('locationsHint')}</span>
        </div>
        <LocationDialog location={null} onDone={showToast} />
      </div>
      {locations.length === 0 ? (
        <div className="empty">
          <h3>{t('noLocationsTitle')}</h3>
          <p>{t('noLocationsText')}</p>
        </div>
      ) : (
        <ul className="pk-locs">
          {locations.map((location) => (
            <li key={location.id} className="pk-loc" data-testid="location-row">
              <span className="thumb"><Icon name="pin" size={20} /></span>
              <div className="cell2">
                <span className="row" style={{ gap: 8 }}>
                  <b dir="auto">{location.label}</b>
                  {location.isDefault ? <Pill tone="blue">{t('default')}</Pill> : null}
                </span>
                <span className="small muted" dir="auto">
                  {location.areaName ? `${location.addressText} · ${location.areaName}` : location.addressText}
                </span>
                <ContactLine name={location.contactName} mobile={location.contactMobile} />
              </div>
              <div className="pk-acts">
                {/* Keyed by the saved values so the form opens with them after an edit. */}
                <LocationDialog key={JSON.stringify(location)} location={location} onDone={showToast} />
                {location.isDefault ? null : <MakeDefaultButton location={location} onDone={showToast} />}
                {location.isDefault ? null : <ArchiveButton location={location} onDone={showToast} />}
              </div>
            </li>
          ))}
        </ul>
      )}
      {toast ? <Toast key={toast.key} message={toast.message} /> : null}
    </>
  );
}
