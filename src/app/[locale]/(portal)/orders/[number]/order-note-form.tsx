'use client';

import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { Button } from '@/ui/button';
import { Toast } from '@/ui/toast';
import { addOrderNoteAction } from './actions';

// Matches the note limit in the order status rules.
const MAX_NOTE_LENGTH = 1000;

export function OrderNoteForm({ orderId }: { orderId: string }) {
  const t = useTranslations('orderPage');
  const locale = useLocale();
  const router = useRouter();
  const noteId = useId();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedCount, setSavedCount] = useState(0);

  const save = async () => {
    if (!note.trim()) {
      setError(t('notes.required'));
      return;
    }
    setSaving(true);
    const result = await addOrderNoteAction(locale, orderId, note);
    setSaving(false);
    if ('errorKey' in result) {
      setError(t(`errors.${result.errorKey}`));
      return;
    }
    setNote('');
    setSavedCount((count) => count + 1);
    router.refresh();
  };

  return (
    <section className="card">
      <div className="card-h b"><h2>{t('notes.title')}</h2></div>
      <form className="card-b" noValidate onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <label htmlFor={noteId} className="sr-only">{t('notes.label')}</label>
        <textarea id={noteId} className={error ? 'input err' : 'input'} rows={3} maxLength={MAX_NOTE_LENGTH} dir="auto" value={note}
          placeholder={t('notes.placeholder')} aria-invalid={error ? true : undefined} data-testid="note-input"
          onChange={(event) => { setNote(event.target.value); setError(null); }} />
        {error ? <span className="err-msg" role="alert">{error}</span> : null}
        <Button small type="submit" disabled={saving} style={{ marginTop: 10 }} data-testid="save-note">{t('notes.save')}</Button>
      </form>
      {/* A new key per save shows the toast again for a second note. */}
      <Toast key={savedCount} message={savedCount ? t('notes.saved') : null} />
    </section>
  );
}
