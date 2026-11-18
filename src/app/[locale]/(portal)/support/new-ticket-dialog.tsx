'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState, useTransition, type FormEvent, type ReactNode } from 'react';
import { useRouter } from '@/i18n/navigation';
import { Button } from '@/ui/button';
import { Icon } from '@/ui/icon';
import { Toast } from '@/ui/toast';
import { openTicketAction } from './actions';

const TOPICS = ['order', 'pickup', 'payment', 'account', 'other'] as const;
const SUBJECT_MIN_LENGTH = 3;
const SUBJECT_MAX_LENGTH = 120;
const BODY_MAX_LENGTH = 2000;
const ORDER_NUMBER_MAX_LENGTH = 40;

// The mockup's ticketModal: topic, optional order number, a short subject and what happened.
// `renderTrigger` draws the opener (a header button or the corner chat button).
export function NewTicketDialog({
  renderTrigger,
  openSignal = 0,
}: {
  renderTrigger: (open: () => void) => ReactNode;
  openSignal?: number;
}) {
  const t = useTranslations('support');
  const locale = useLocale();
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const ids = useId();
  const [pending, startTransition] = useTransition();
  // A fresh key per request: a double click resends the same key, the next request gets a new one.
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [toast, setToast] = useState<{ key: number; message: string } | null>(null);

  const open = () => {
    setErrorKey(null);
    dialogRef.current?.showModal();
  };
  const close = () => dialogRef.current?.close();

  // Opened from outside, e.g. the help card's "Chat with us" link (?new=1).
  useEffect(() => {
    const dialog = dialogRef.current;
    if (openSignal === 0 || !dialog || dialog.open) return;
    setErrorKey(null);
    dialog.showModal();
  }, [openSignal]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const input = {
      topic: String(form.get('topic') ?? '') as (typeof TOPICS)[number],
      orderNumber: String(form.get('orderNumber') ?? ''),
      subject: String(form.get('subject') ?? ''),
      body: String(form.get('body') ?? ''),
    };
    startTransition(async () => {
      const result = await openTicketAction(locale, input, idempotencyKey);
      setIdempotencyKey(crypto.randomUUID());
      if (result.status === 'error') {
        setErrorKey(result.errorKey);
        return;
      }
      close();
      formRef.current?.reset();
      setToast({ key: Date.now(), message: t('sent') });
      router.push(`/support/${result.number}`);
    });
  };

  return (
    <>
      {renderTrigger(open)}
      <dialog ref={dialogRef} className="modal" aria-labelledby={`${ids}-title`} data-testid="new-ticket-dialog">
        <div className="modal-h">
          <h2 id={`${ids}-title`}>{t('newTicketTitle')}</h2>
          <button type="button" className="icon-btn" onClick={close} aria-label={t('close')}>
            <Icon name="x" />
          </button>
        </div>
        <form ref={formRef} onSubmit={submit}>
          <div className="modal-b">
            {errorKey ? <div className="alert" role="alert" data-testid="new-ticket-error">{t(`errors.${errorKey}`)}</div> : null}
            <div className="field">
              <label htmlFor={`${ids}-topic`}>{t('topic')}</label>
              <select id={`${ids}-topic`} name="topic" className="input" defaultValue="order" data-testid="ticket-topic">
                {TOPICS.map((topic) => (
                  <option key={topic} value={topic}>{t(`topics.${topic}`)}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor={`${ids}-order`}>
                {t('orderNumber')} <span className="subtle">{t('optional')}</span>
              </label>
              <input id={`${ids}-order`} name="orderNumber" className="input mono" inputMode="numeric" dir="ltr"
                autoComplete="off" maxLength={ORDER_NUMBER_MAX_LENGTH} data-testid="ticket-order" />
            </div>
            <div className="field">
              <label htmlFor={`${ids}-subject`}>{t('subject')}</label>
              <input id={`${ids}-subject`} name="subject" className="input" required minLength={SUBJECT_MIN_LENGTH}
                maxLength={SUBJECT_MAX_LENGTH} placeholder={t('subjectPlaceholder')} data-testid="ticket-subject" />
            </div>
            <div className="field">
              <label htmlFor={`${ids}-body`}>{t('message')}</label>
              <textarea id={`${ids}-body`} name="body" className="input" rows={4} required maxLength={BODY_MAX_LENGTH}
                data-testid="ticket-body" />
            </div>
          </div>
          <div className="modal-f">
            <Button onClick={close}>{t('cancel')}</Button>
            <Button type="submit" variant="primary" disabled={pending} data-testid="ticket-submit">
              {pending ? t('sending') : t('send')}
            </Button>
          </div>
        </form>
      </dialog>
      {toast ? <Toast key={toast.key} message={toast.message} /> : null}
    </>
  );
}
