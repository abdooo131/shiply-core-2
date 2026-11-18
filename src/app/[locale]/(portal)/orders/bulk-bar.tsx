'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useRef, useState, useTransition } from 'react';
import { Link, useRouter } from '@/i18n/navigation';
import { Button } from '@/ui/button';
import { Icon } from '@/ui/icon';
import { cancelOrdersAction } from './actions';
import { PopoverMenu } from './popover-menu';

const LABEL_FORMATS = ['a6', 'a4'] as const;

// Shown while orders are ticked: print their labels, cancel them, or clear the selection.
export function BulkBar({
  orderIds,
  onClear,
  onDone,
}: {
  orderIds: string[];
  onClear: () => void;
  onDone: (message: string) => void;
}) {
  const t = useTranslations('ordersList');
  const tLabels = useTranslations('labels');
  const locale = useLocale();
  const router = useRouter();
  const printRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [isPrintOpen, setIsPrintOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const closePrint = useCallback(() => setIsPrintOpen(false), []);
  const count = orderIds.length;

  const cancelSelected = () =>
    startTransition(async () => {
      const result = await cancelOrdersAction(locale, orderIds);
      dialogRef.current?.close();
      if (result.status === 'error') {
        onDone(t(`errors.${result.errorKey}`));
        return;
      }
      onClear();
      router.refresh();
      onDone(
        result.refused === 0
          ? t('canceledAll', { canceled: result.canceled })
          : t('canceledSome', { canceled: result.canceled, refused: result.refused }),
      );
    });

  return (
    <>
      <div className="bulkbar" role="toolbar" aria-label={t('selectedOrders')} data-testid="bulk-bar">
        <b>{t('selected', { count })}</b>
        <button
          ref={printRef}
          type="button"
          className="btn sm"
          aria-haspopup="true"
          aria-expanded={isPrintOpen}
          data-testid="bulk-print"
          onClick={() => setIsPrintOpen((open) => !open)}
        >
          <Icon name="print" size={14} /> {t('printLabels')}
        </button>
        <Button small onClick={() => dialogRef.current?.showModal()} data-testid="bulk-cancel">
          {t('cancelOrders')}
        </Button>
        <button type="button" className="icon-btn sm" onClick={onClear} aria-label={t('clearSelection')}>
          <Icon name="x" size={16} />
        </button>
      </div>

      {isPrintOpen && printRef.current ? (
        <PopoverMenu anchor={printRef.current} onClose={closePrint} label={tLabels('formatLabel')}>
          <div className="fp-title">{tLabels('formatLabel')}</div>
          {LABEL_FORMATS.map((format) => (
            <Link
              key={format}
              className="menu-item"
              href={{ pathname: '/orders/labels', query: { ids: orderIds.join(','), format } }}
              data-testid={`print-${format}`}
            >
              <Icon name="print" size={16} /> {tLabels(`formats.${format}`)}
            </Link>
          ))}
        </PopoverMenu>
      ) : null}

      <dialog ref={dialogRef} className="modal" aria-labelledby="cancel-orders-title">
        <div className="modal-h">
          <h2 id="cancel-orders-title">{t('cancelTitle', { count })}</h2>
          <button type="button" className="icon-btn" onClick={() => dialogRef.current?.close()} aria-label={t('close')}>
            <Icon name="x" />
          </button>
        </div>
        <div className="modal-b">
          <p style={{ margin: 0 }}>{t('cancelText')}</p>
        </div>
        <div className="modal-f">
          <Button onClick={() => dialogRef.current?.close()}>{t('keepOrders')}</Button>
          <Button variant="danger" disabled={pending} onClick={cancelSelected} data-testid="confirm-cancel">
            {t('cancelOrders')}
          </Button>
        </div>
      </dialog>
    </>
  );
}
