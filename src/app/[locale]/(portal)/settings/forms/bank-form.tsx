'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { Button } from '@/ui/button';
import { Field } from '@/ui/field';
import { requestBankChangeAction } from '../actions';
import { FormFeedback, IDLE, useIdempotencyKey } from './form-feedback';

export function BankForm() {
  const t = useTranslations('settings');
  const locale = useLocale();
  const [state, formAction, pending] = useActionState(requestBankChangeAction.bind(null, locale), IDLE);
  const idempotencyKey = useIdempotencyKey(state);

  return (
    <form action={formAction} className="cell2" style={{ gap: 12 }}>
      <FormFeedback state={state} successMessage={t('bankRequested')} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <div className="g2">
        <Field label={t('bankName')} name="bankName" required maxLength={120} />
        <Field label={t('holderName')} name="holderName" required maxLength={120} />
      </div>
      <Field
        label={t('iban')}
        name="iban"
        hint={t('ibanHint')}
        dir="ltr"
        autoComplete="off"
        spellCheck={false}
        required
        maxLength={60}
        className="input mono"
      />
      <div>
        <Button type="submit" variant="primary" disabled={pending}>
          {t('requestChange')}
        </Button>
      </div>
    </form>
  );
}
