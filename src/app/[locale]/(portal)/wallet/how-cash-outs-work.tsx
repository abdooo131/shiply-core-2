'use client';

import { useTranslations } from 'next-intl';
import { useRef } from 'react';
import { Link } from '@/i18n/navigation';
import { Button } from '@/ui/button';
import { Icon } from '@/ui/icon';

const STEPS = ['collect', 'close', 'fees', 'cashOut'] as const;

// The "How cash-outs work" button and dialog from the mockup's wallet header.
export function HowCashOutsWork({ scheduleText }: { scheduleText: string }) {
  const t = useTranslations('wallet.how');
  const dialogRef = useRef<HTMLDialogElement>(null);
  const close = () => dialogRef.current?.close();
  return (
    <>
      <Button onClick={() => dialogRef.current?.showModal()} data-testid="how-cash-outs">
        <Icon name="help" size={16} /> {t('open')}
      </Button>
      <dialog ref={dialogRef} className="modal drawer" aria-labelledby="how-title">
        <div className="modal-h">
          <h2 id="how-title">{t('title')}</h2>
          <button type="button" className="icon-btn" onClick={close} aria-label={t('close')}>
            <Icon name="x" size={18} />
          </button>
        </div>
        <div className="modal-b">
          <ol className="timeline">
            {STEPS.map((step) => (
              <li className="tl" key={step}>
                <i />
                <div className="cell2">
                  <b>{t(`steps.${step}.title`)}</b>
                  <span>{step === 'cashOut' ? scheduleText : t(`steps.${step}.text`)}</span>
                </div>
              </li>
            ))}
          </ol>
          <p className="small muted" style={{ margin: 0 }}>{t('note')}</p>
        </div>
        <div className="modal-f">
          <Link className="btn" href="/settings/pricing">{t('seeSchedule')}</Link>
          <Button variant="primary" onClick={close}>{t('gotIt')}</Button>
        </div>
      </dialog>
    </>
  );
}
