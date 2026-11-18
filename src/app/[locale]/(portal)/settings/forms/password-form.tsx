'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { Button } from '@/ui/button';
import { Field } from '@/ui/field';
import { changePasswordAction } from '../actions';
import { FormFeedback, IDLE } from './form-feedback';

export function PasswordForm() {
  const t = useTranslations('settings');
  const locale = useLocale();
  const [state, formAction, pending] = useActionState(changePasswordAction.bind(null, locale), IDLE);

  return (
    <form action={formAction} className="cell2" style={{ gap: 12 }}>
      <FormFeedback state={state} successMessage={t('passwordChanged')} />
      <div className="g2">
        <Field label={t('currentPassword')} name="currentPassword" type="password" autoComplete="current-password" dir="ltr" required />
        <Field label={t('newPassword')} name="newPassword" type="password" autoComplete="new-password" dir="ltr" minLength={8} required />
      </div>
      <div>
        <Button type="submit" disabled={pending}>
          {t('changePassword')}
        </Button>
      </div>
    </form>
  );
}
