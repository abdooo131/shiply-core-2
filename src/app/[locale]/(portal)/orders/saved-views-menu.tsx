'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useImperativeHandle, useRef, useState, useTransition, type FormEvent, type Ref } from 'react';
import { useRouter } from '@/i18n/navigation';
import { Button } from '@/ui/button';
import { Field } from '@/ui/field';
import { Icon } from '@/ui/icon';
import { deleteViewAction, saveViewAction } from './actions';
import { ORDERS_PATH } from './orders-url';
import { PopoverMenu } from './popover-menu';

const MAX_VIEW_NAME_LENGTH = 40;

// A preset has no id: it ships with Shiply and cannot be deleted.
export type ViewChoice = { id: string | null; name: string; query: string };
export type SaveViewDialogHandle = { open: () => void };

// "Save this view": names the current filters, tab, search and sort and keeps them for this user.
export function SaveViewDialog({
  ref,
  currentQuery,
  suggestedName,
  notify,
}: {
  ref: Ref<SaveViewDialogHandle>;
  currentQuery: string;
  suggestedName: string;
  notify: (message: string) => void;
}) {
  const t = useTranslations('ordersList');
  const locale = useLocale();
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [formKey, setFormKey] = useState(0);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const close = () => dialogRef.current?.close();

  useImperativeHandle(ref, () => ({
    open: () => {
      setErrorKey(null);
      setFormKey((key) => key + 1);
      dialogRef.current?.showModal();
    },
  }));

  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get('name') ?? '').trim();
    if (!name) {
      setErrorKey('invalid_input');
      return;
    }
    startTransition(async () => {
      const result = await saveViewAction(locale, name, currentQuery);
      if (result.status === 'error') {
        setErrorKey(result.errorKey);
        return;
      }
      close();
      router.refresh();
      notify(t('viewSaved', { name }));
    });
  };

  return (
    <dialog ref={dialogRef} className="modal" aria-labelledby="save-view-title">
      <form key={formKey} onSubmit={save}>
        <div className="modal-h">
          <h2 id="save-view-title">{t('saveViewTitle')}</h2>
          <button type="button" className="icon-btn" onClick={close} aria-label={t('close')}>
            <Icon name="x" />
          </button>
        </div>
        <div className="modal-b">
          <p className="muted" style={{ margin: 0 }}>{t('saveViewText')}</p>
          <Field
            label={t('viewName')}
            name="name"
            defaultValue={suggestedName.slice(0, MAX_VIEW_NAME_LENGTH)}
            maxLength={MAX_VIEW_NAME_LENGTH}
            error={errorKey ? t(`errors.${errorKey}`) : undefined}
            data-testid="view-name"
          />
        </div>
        <div className="modal-f">
          <Button onClick={close}>{t('cancel')}</Button>
          <Button type="submit" variant="primary" disabled={pending} data-testid="save-view">{t('saveView')}</Button>
        </div>
      </form>
    </dialog>
  );
}

// The "Views" button: presets and the user's own views, each one click away; own views can be deleted.
export function SavedViewsMenu({
  presets,
  views,
  canSaveCurrent,
  onSaveCurrent,
  notify,
}: {
  presets: ViewChoice[];
  views: ViewChoice[];
  canSaveCurrent: boolean;
  onSaveCurrent: () => void;
  notify: (message: string) => void;
}) {
  const t = useTranslations('ordersList');
  const locale = useLocale();
  const router = useRouter();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const close = useCallback(() => setIsOpen(false), []);

  const apply = (view: ViewChoice) => {
    setIsOpen(false);
    router.push(view.query ? `${ORDERS_PATH}?${view.query}` : ORDERS_PATH, { scroll: false });
    notify(t('showingView', { name: view.name }));
  };

  const remove = (view: ViewChoice) => {
    const viewId = view.id;
    if (!viewId) return;
    startTransition(async () => {
      const result = await deleteViewAction(locale, viewId);
      if (result.status === 'error') {
        notify(t(`errors.${result.errorKey}`));
        return;
      }
      router.refresh();
      notify(t('viewDeleted', { name: view.name }));
    });
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="btn sm"
        aria-haspopup="true"
        aria-expanded={isOpen}
        data-testid="views-button"
        onClick={() => setIsOpen((open) => !open)}
      >
        <Icon name="doc" size={15} /> {t('views')}
        {views.length > 0 ? <span className="pill p-blue" style={{ padding: '0 7px' }}>{views.length}</span> : null}
      </button>

      {isOpen && buttonRef.current ? (
        <PopoverMenu anchor={buttonRef.current} onClose={close} align="end" label={t('savedViews')}>
          <div className="fp-pop">
            <div className="fp-title">{t('savedViews')}</div>
            {[...presets, ...views].map((view) => (
              <div key={view.id ?? `preset-${view.name}`} className="row" style={{ flexWrap: 'nowrap', gap: 0 }}>
                <button type="button" className="fp-opt" onClick={() => apply(view)}>
                  <Icon name={view.id ? 'doc' : 'sparkle'} size={15} />
                  <span style={{ flex: 1 }}>{view.name}</span>
                </button>
                {view.id ? (
                  <button
                    type="button"
                    className="icon-btn sm"
                    disabled={pending}
                    aria-label={t('deleteView', { name: view.name })}
                    onClick={() => remove(view)}
                  >
                    <Icon name="x" size={13} strokeWidth={2.4} />
                  </button>
                ) : null}
              </div>
            ))}
            <div className="fp-foot">
              <span className="small muted" style={{ alignSelf: 'center' }}>{views.length ? '' : t('viewsEmpty')}</span>
              <Button
                small
                disabled={!canSaveCurrent}
                data-testid="save-current-view"
                onClick={() => {
                  setIsOpen(false);
                  onSaveCurrent();
                }}
              >
                <Icon name="plus" size={13} strokeWidth={2.6} /> {t('saveCurrent')}
              </Button>
            </div>
          </div>
        </PopoverMenu>
      ) : null}
    </>
  );
}
