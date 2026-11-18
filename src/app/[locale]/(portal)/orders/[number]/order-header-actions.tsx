'use client';

import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { Button } from '@/ui/button';
import { Icon } from '@/ui/icon';
import { Toast } from '@/ui/toast';
import { cancelOrderAction } from './actions';

type Props = {
  orderId: string;
  orderNumber: string;
  customerName: string;
  canCancel: boolean;
  canCreateExchange: boolean;
  canCreateReturn: boolean;
};

export function OrderHeaderActions({ orderId, orderNumber, customerName, canCancel, canCreateExchange, canCreateReturn }: Props) {
  const t = useTranslations('orderPage');
  const locale = useLocale();
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const openCancel = () => {
    setError(null);
    dialogRef.current?.showModal();
  };

  const confirmCancel = async () => {
    setSaving(true);
    const result = await cancelOrderAction(locale, orderId);
    setSaving(false);
    if ('errorKey' in result) {
      setError(t(`errors.${result.errorKey}`));
      return;
    }
    dialogRef.current?.close();
    setToast(t('canceledToast', { number: orderNumber }));
    router.refresh();
  };

  const followUpHref = (type: 'exchange' | 'return') => `/${locale}/orders/new?type=${type}&from=${orderNumber}`;

  return (
    <>
      <a className="btn" href={`/${locale}/orders/labels?ids=${orderId}`} target="_blank" rel="noopener" data-testid="print-label">
        <Icon name="print" size={16} /> {t('printLabel')}
      </a>
      {canCreateExchange ? (
        <a className="btn" href={followUpHref('exchange')} data-testid="create-exchange">
          <Icon name="undo" size={16} /> {t('createExchange')}
        </a>
      ) : null}
      {canCreateReturn ? (
        <a className="btn" href={followUpHref('return')} data-testid="create-return">
          <Icon name="back" size={16} /> {t('createReturn')}
        </a>
      ) : null}
      {canCancel ? (
        <Button variant="danger" onClick={openCancel} data-testid="cancel-order">
          <Icon name="x" size={16} /> {t('cancel')}
        </Button>
      ) : null}

      <dialog ref={dialogRef} className="modal" aria-labelledby="cancel-dialog-title">
        <div className="modal-h">
          <h2 id="cancel-dialog-title">{t('cancelTitle')}</h2>
        </div>
        <div className="modal-b">
          <p className="muted" style={{ margin: 0 }}>{t('cancelText', { number: orderNumber, name: customerName })}</p>
          {error ? <div className="alert" role="alert">{error}</div> : null}
        </div>
        <div className="modal-f">
          <Button onClick={() => dialogRef.current?.close()}>{t('keepOrder')}</Button>
          <Button variant="primary" className="danger-fill" onClick={() => void confirmCancel()} disabled={saving} data-testid="confirm-cancel">
            {t('cancelConfirm')}
          </Button>
        </div>
      </dialog>
      <Toast message={toast} />
    </>
  );
}
