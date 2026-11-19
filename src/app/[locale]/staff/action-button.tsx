'use client';

import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { useRouter } from '@/i18n/navigation';
import type { StaffActionResult } from './actions';

// One click, one server action, then a short message: what was done, or what went wrong.
// The button stays disabled while the request runs, and the server refuses a repeat anyway.
export function ActionButton({
  action,
  label,
  doneText,
  variant = 'primary',
  testId,
}: {
  action: () => Promise<StaffActionResult>;
  label: string;
  doneText: string;
  variant?: 'primary' | 'plain' | 'danger';
  testId?: string;
}) {
  const t = useTranslations('staff.errors');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const className = variant === 'plain' ? 'btn sm' : variant === 'danger' ? 'btn sm danger' : 'btn sm primary';

  const click = () =>
    startTransition(async () => {
      const result = await action();
      if (result.status === 'error') {
        setMessage({ tone: 'bad', text: t(result.errorKey) });
        return;
      }
      setMessage({ tone: 'ok', text: doneText });
      router.refresh();
    });

  return (
    <span className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
      <button type="button" className={className} disabled={pending} onClick={click} data-testid={testId}>
        {label}
      </button>
      {message ? (
        <span role="status" className={message.tone === 'bad' ? 'small err-msg' : 'small ok-text'}>
          {message.text}
        </span>
      ) : null}
    </span>
  );
}
