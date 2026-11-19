'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { useRouter } from '@/i18n/navigation';
import { replyToTicketAction } from '../../actions';

const BODY_MAX_LENGTH = 2000;

// One key per reply being written: a double click or a retry stores the reply once.
function newKey(): string {
  return crypto.randomUUID();
}

export function StaffReplyForm({ ticketId }: { ticketId: string }) {
  const t = useTranslations('staff');
  const locale = useLocale();
  const router = useRouter();
  const [body, setBody] = useState('');
  const [key, setKey] = useState(newKey);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);

  const send = () =>
    startTransition(async () => {
      const result = await replyToTicketAction(locale, ticketId, body, key);
      if (result.status === 'error') {
        setMessage({ tone: 'bad', text: t(`errors.${result.errorKey}`) });
        return;
      }
      setBody('');
      setKey(newKey());
      setMessage({ tone: 'ok', text: t('support.sent') });
      router.refresh();
    });

  return (
    <div className="grid" style={{ gap: 10 }}>
      <label className="field">
        <span>{t('support.replyLabel')}</span>
        <textarea className="input" rows={4} maxLength={BODY_MAX_LENGTH} value={body} onChange={(event) => setBody(event.target.value)} data-testid="staff-reply" />
      </label>
      <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
        <button type="button" className="btn primary" disabled={pending || body.trim().length === 0} onClick={send} data-testid="staff-send-reply">
          {t('support.send')}
        </button>
        {message ? <span role="status" className={message.tone === 'bad' ? 'err-msg' : 'small ok-text'}>{message.text}</span> : null}
      </div>
    </div>
  );
}
