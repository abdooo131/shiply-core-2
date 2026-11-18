'use client';

import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { Button } from '@/ui/button';
import { Icon } from '@/ui/icon';
import { Toast } from '@/ui/toast';
import { answerAwaitingActionAction } from './actions';

type Choice = 'deliver_again' | 'return';

// Stays mounted after the answer so its confirmation toast survives the refresh that hides the box.
export function AwaitingAnswer({ orderId, isAwaiting, attempt, maxAttempts }: { orderId: string; isAwaiting: boolean; attempt: number; maxAttempts: number }) {
  const t = useTranslations('orderPage.awaiting');
  const tErrors = useTranslations('orderPage.errors');
  const locale = useLocale();
  const router = useRouter();
  const noteId = useId();
  const [choice, setChoice] = useState<Choice | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const pick = (next: Choice) => {
    setChoice(next);
    setError(null);
  };

  const send = async () => {
    if (!choice) return;
    if (!note.trim()) {
      setError(t('noteRequired'));
      return;
    }
    setSaving(true);
    const result = await answerAwaitingActionAction(locale, orderId, choice, note);
    setSaving(false);
    if ('errorKey' in result) {
      setError(tErrors(result.errorKey));
      return;
    }
    setToast(choice === 'deliver_again' ? t('answeredDeliver') : t('answeredReturn'));
    setChoice(null);
    setNote('');
    router.refresh();
  };

  if (!isAwaiting) return <Toast message={toast} />;

  return (
    <section className="card awaiting-card" data-testid="awaiting-box">
      <div className="attn-row">
        <span className="attn-ic"><Icon name="alert" size={18} /></span>
        <div className="cell2">
          <b>{t('title')}</b>
          <span>{t('attempt', { attempt: Math.max(attempt, 1), max: maxAttempts })}</span>
        </div>
        <div className="row" style={{ gap: 6 }}>
          <Button small variant={choice === 'deliver_again' ? 'primary' : 'default'} aria-pressed={choice === 'deliver_again'} onClick={() => pick('deliver_again')}>
            {t('deliverAgain')}
          </Button>
          <Button small variant={choice === 'return' ? 'primary' : 'default'} aria-pressed={choice === 'return'} onClick={() => pick('return')}>
            {t('returnToMe')}
          </Button>
        </div>
      </div>
      {choice ? (
        <form className="awaiting-form" noValidate onSubmit={(event) => { event.preventDefault(); void send(); }}>
          <div className="field">
            <label htmlFor={noteId}>{t('noteLabel')}</label>
            <textarea id={noteId} className={error ? 'input err' : 'input'} rows={2} maxLength={500} dir="auto" value={note}
              placeholder={t('notePlaceholder')} aria-invalid={error ? true : undefined}
              onChange={(event) => { setNote(event.target.value); setError(null); }} />
            {error ? <span className="err-msg" role="alert">{error}</span> : null}
          </div>
          <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
            <Button small onClick={() => setChoice(null)}>{t('cancel')}</Button>
            <Button small variant="primary" type="submit" disabled={saving} data-testid="send-answer">{t('send')}</Button>
          </div>
        </form>
      ) : null}
      <Toast message={toast} />
    </section>
  );
}
