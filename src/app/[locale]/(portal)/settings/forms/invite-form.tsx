'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { Button } from '@/ui/button';
import { Field } from '@/ui/field';
import { SelectField } from '@/ui/select-field';
import { inviteMemberAction } from '../actions';
import { FormFeedback, IDLE, useIdempotencyKey } from './form-feedback';

const ACCESS_LEVELS = ['orders_pickups', 'finance', 'full'] as const;

export function InviteForm() {
  const t = useTranslations('settings');
  const locale = useLocale();
  const [state, formAction, pending] = useActionState(inviteMemberAction.bind(null, locale), IDLE);
  const idempotencyKey = useIdempotencyKey(state);

  return (
    <form action={formAction} className="cell2" style={{ gap: 12 }}>
      <FormFeedback state={state} successMessage={t('saved')} />
      {state.status === 'ok' && state.oneTimePassword ? (
        <div className="secret" role="note">
          <b>{t('oneTimePassword')}</b>
          <code className="mono" data-testid="one-time-password">
            {state.oneTimePassword}
          </code>
          <span className="small">{t('oneTimePasswordNote', { name: state.invitedName ?? '' })}</span>
        </div>
      ) : null}
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <div className="g2">
        <Field label={t('inviteName')} name="name" required maxLength={120} />
        <Field label={t('email')} name="email" type="email" dir="ltr" maxLength={200} />
        <Field label={t('mobile')} name="mobile" type="tel" dir="ltr" placeholder="010…" maxLength={30} />
        <SelectField
          label={t('access')}
          name="access"
          defaultValue="orders_pickups"
          options={ACCESS_LEVELS.map((access) => ({ value: access, label: t(`accessLevels.${access}`) }))}
        />
      </div>
      <div>
        <Button type="submit" variant="primary" disabled={pending}>
          {t('inviteSend')}
        </Button>
      </div>
    </form>
  );
}
