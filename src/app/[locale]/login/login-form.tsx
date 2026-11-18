'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { Button } from '@/ui/button';
import { Field } from '@/ui/field';
import { signInAction, type SignInState } from './actions';

const INITIAL_STATE: SignInState = { errorKey: null, identifier: '' };

export function LoginForm() {
  const t = useTranslations('login');
  const locale = useLocale();
  const [state, formAction, pending] = useActionState(signInAction.bind(null, locale), INITIAL_STATE);

  return (
    <form action={formAction} noValidate>
      <div className="cell2" style={{ gap: 6 }}>
        <h1>{t('title')}</h1>
        <span className="muted">{t('subtitle')}</span>
      </div>
      {state.errorKey ? (
        <div className="alert" role="alert">
          {t(`errors.${state.errorKey}`)}
        </div>
      ) : null}
      <Field
        label={t('identifier')}
        name="identifier"
        type="text"
        inputMode="email"
        autoComplete="username"
        placeholder={t('identifierPlaceholder')}
        defaultValue={state.identifier}
        dir="ltr"
        required
        data-testid="identifier"
      />
      <Field
        label={t('password')}
        name="password"
        type="password"
        autoComplete="current-password"
        dir="ltr"
        required
        data-testid="password"
      />
      <Button type="submit" variant="primary" block disabled={pending} data-testid="sign-in">
        {pending ? t('submitting') : t('submit')}
      </Button>
    </form>
  );
}
