'use client';

import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { Link } from '@/i18n/navigation';
import { Button } from '@/ui/button';
import { Icon } from '@/ui/icon';
import { Toast } from '@/ui/toast';
import { answerAwaitingActionAction } from './orders/[number]/actions';

type Choice = 'deliver_again' | 'return';

export type NeedsActionRowView = {
  id: string;
  number: string;
  customerName: string;
  areaName: string;
  reasonText: string;
  attemptText: string;
};

function NeedsActionRow({ row, onAnswered }: { row: NeedsActionRowView; onAnswered: (message: string) => void }) {
  const t = useTranslations('home.needs');
  const tErrors = useTranslations('orderPage.errors');
  const locale = useLocale();
  const router = useRouter();
  const noteId = useId();
  const [choice, setChoice] = useState<Choice | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const pick = (next: Choice) => {
    setChoice(next);
    setError(null);
  };

  const send = async () => {
    if (!choice || saving) return;
    if (!note.trim()) {
      setError(t('noteRequired'));
      return;
    }
    setSaving(true);
    const result = await answerAwaitingActionAction(locale, row.id, choice, note);
    setSaving(false);
    if ('errorKey' in result) {
      setError(tErrors(result.errorKey));
      return;
    }
    onAnswered(choice === 'deliver_again' ? t('answeredDeliver', { number: row.number }) : t('answeredReturn', { number: row.number }));
    router.refresh();
  };

  return (
    <div className="hm-need" data-testid="needs-action-row">
      <div className="attn-row">
        <span className="attn-ic"><Icon name="alert" size={18} /></span>
        <div className="cell2">
          <span className="row hm-need-who">
            <Link className="oid" href={`/orders/${row.number}`}>{row.number}</Link>
            <b dir="auto">{row.customerName}</b>
            <span className="subtle small">{row.areaName}</span>
          </span>
          <span className="hm-need-why"><bdi>{row.reasonText}</bdi> · {row.attemptText}</span>
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
    </div>
  );
}

// Stays mounted when the last row is answered, so the confirmation toast survives the refresh.
export function NeedsActionCard({ rows, totalCount }: { rows: NeedsActionRowView[]; totalCount: number }) {
  const t = useTranslations('home.needs');
  const [toast, setToast] = useState<string | null>(null);

  if (rows.length === 0) return <Toast message={toast} />;

  return (
    <section className="card hm-needs" aria-labelledby="hm-needs-title" data-testid="needs-action">
      <div className="card-h">
        <div className="grow cell2">
          <h2 id="hm-needs-title">{t('title')}</h2>
          <span className="small muted">{t('hint')}</span>
        </div>
        <Link className="btn sm" href={{ pathname: '/orders', query: { tab: 'needs_action' } }}>{t('seeAll', { count: totalCount })}</Link>
      </div>
      {rows.map((row) => <NeedsActionRow key={row.id} row={row} onAnswered={setToast} />)}
      <Toast message={toast} />
    </section>
  );
}
