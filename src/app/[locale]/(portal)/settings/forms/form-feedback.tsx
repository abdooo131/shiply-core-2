'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Toast } from '@/ui/toast';
import type { ActionState } from '../actions';

// Error box inside the form, and a toast when the action succeeded.
export function FormFeedback({ state, successMessage }: { state: ActionState; successMessage: string }) {
  const t = useTranslations('settings');
  const [toastKey, setToastKey] = useState(0);

  useEffect(() => {
    if (state.status === 'ok') setToastKey((key) => key + 1);
  }, [state]);

  return (
    <>
      {state.status === 'error' && state.errorKey ? (
        <div className="alert" role="alert">
          {t(`errors.${state.errorKey}`)}
        </div>
      ) : null}
      {toastKey > 0 ? <Toast key={toastKey} message={successMessage} /> : null}
    </>
  );
}

// A fresh key per form use: a double click resends the same key, a new request gets a new one.
export function useIdempotencyKey(state: ActionState): string {
  const [key, setKey] = useState(() => crypto.randomUUID());
  useEffect(() => {
    if (state.status === 'ok') setKey(crypto.randomUUID());
  }, [state]);
  return key;
}

export const IDLE: ActionState = { status: 'idle' };
