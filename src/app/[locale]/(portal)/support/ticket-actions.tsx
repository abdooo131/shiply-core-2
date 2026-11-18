'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useId, useRef, useState, useTransition, type FormEvent } from 'react';
import { useRouter } from '@/i18n/navigation';
import { Button } from '@/ui/button';
import { Icon } from '@/ui/icon';
import { openNewTicketDialog } from '@/ui/shell/support-chat-button';
import { Toast } from '@/ui/toast';
import { closeTicketAction, replyToTicketAction } from './actions';

const BODY_MAX_LENGTH = 2000;

// Opens the one "New support ticket" dialog that lives with the corner chat button.
export function NewTicketButton({ withIcon = false, testId }: { withIcon?: boolean; testId: string }) {
  const t = useTranslations('support');
  return (
    <Button variant="primary" onClick={openNewTicketDialog} data-testid={testId}>
      {withIcon ? <Icon name="plus" size={16} strokeWidth={2.6} /> : null}
      {t('newTicket')}
    </Button>
  );
}

// The reply box under the conversation (mockup: input + Send).
export function TicketReplyForm({ ticketId }: { ticketId: string }) {
  const t = useTranslations('support');
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [body, setBody] = useState('');
  // A fresh key per reply: a double click resends the same key, the next reply gets a new one.
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [toast, setToast] = useState<{ key: number; message: string } | null>(null);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!body.trim()) return;
    startTransition(async () => {
      const result = await replyToTicketAction(locale, ticketId, body, idempotencyKey);
      setIdempotencyKey(crypto.randomUUID());
      if (result.status === 'error') {
        setErrorKey(result.errorKey);
        return;
      }
      setErrorKey(null);
      setBody('');
      setToast({ key: Date.now(), message: t('replySent') });
      router.refresh();
    });
  };

  return (
    <>
      <form className="card-h sp-reply" onSubmit={submit}>
        {errorKey ? <div className="alert" role="alert" style={{ flexBasis: '100%' }}>{t(`errors.${errorKey}`)}</div> : null}
        <input className="input grow" value={body} onChange={(event) => setBody(event.target.value)} maxLength={BODY_MAX_LENGTH}
          placeholder={t('replyPlaceholder')} aria-label={t('replyLabel')} required data-testid="ticket-reply" />
        <Button type="submit" variant="primary" disabled={pending} data-testid="ticket-reply-send">{t('sendReply')}</Button>
      </form>
      {toast ? <Toast key={toast.key} message={toast.message} /> : null}
    </>
  );
}

// Stays mounted after closing (showing nothing but the toast) so "Ticket closed" is still seen.
export function CloseTicketButton({ ticketId, isClosed }: { ticketId: string; isClosed: boolean }) {
  const t = useTranslations('support');
  const locale = useLocale();
  const router = useRouter();
  const ids = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [pending, startTransition] = useTransition();
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [toast, setToast] = useState<{ key: number; message: string } | null>(null);
  const close = () => dialogRef.current?.close();

  const confirm = () => {
    startTransition(async () => {
      const result = await closeTicketAction(locale, ticketId);
      if (result.status === 'error') {
        setErrorKey(result.errorKey);
        return;
      }
      close();
      setToast({ key: Date.now(), message: t('ticketClosed') });
      router.refresh();
    });
  };

  const toastView = toast ? <Toast key={toast.key} message={toast.message} /> : null;
  if (isClosed) return toastView;

  return (
    <>
      <Button small onClick={() => { setErrorKey(null); dialogRef.current?.showModal(); }} data-testid="ticket-close">
        {t('closeTicket')}
      </Button>
      <dialog ref={dialogRef} className="modal" aria-labelledby={`${ids}-title`}>
        <div className="modal-h">
          <h2 id={`${ids}-title`}>{t('closeTicket')}</h2>
          <button type="button" className="icon-btn" onClick={close} aria-label={t('close')}><Icon name="x" /></button>
        </div>
        <div className="modal-b">
          {errorKey ? <div className="alert" role="alert">{t(`errors.${errorKey}`)}</div> : null}
          <p style={{ margin: 0 }}>{t('closeConfirm')}</p>
        </div>
        <div className="modal-f">
          <Button onClick={close}>{t('cancel')}</Button>
          <Button variant="primary" onClick={confirm} disabled={pending} data-testid="ticket-close-confirm">{t('closeTicket')}</Button>
        </div>
      </dialog>
      {toastView}
    </>
  );
}
