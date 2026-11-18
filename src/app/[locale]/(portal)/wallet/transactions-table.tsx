'use client';

import { useTranslations } from 'next-intl';
import { useRef, useState, type KeyboardEvent } from 'react';
import { Link } from '@/i18n/navigation';
import { Button } from '@/ui/button';
import { Icon } from '@/ui/icon';

export type TransactionReason = 'order_delivered' | 'order_returned' | 'cash_out_paid' | 'other';

export type TransactionRowView = {
  id: string;
  reason: TransactionReason;
  isOut: boolean;
  amountText: string;
  dateText: string;
  timeText: string;
  orderNumber: string | null;
  cashOutNumber: string | null;
  // Set only for a paid cash-out, whose proof of transfer can be opened.
  proofId: string | null;
};

function referenceOf(row: TransactionRowView): string {
  return row.orderNumber ?? row.cashOutNumber ?? '—';
}

// The transactions table; a row opens its details in a side drawer, like the mockup's txDetails.
export function TransactionsTable({ rows }: { rows: TransactionRowView[] }) {
  const t = useTranslations('wallet');
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [selected, setSelected] = useState<TransactionRowView | null>(null);

  const open = (row: TransactionRowView) => {
    setSelected(row);
    dialogRef.current?.showModal();
  };
  const onRowKey = (event: KeyboardEvent<HTMLTableRowElement>, row: TransactionRowView) => {
    if (event.key === 'Enter') open(row);
  };

  return (
    <>
      <div className="tbl-wrap">
        <table>
          <thead>
            <tr>
              <th>{t('table.transaction')}</th>
              <th>{t('table.date')}</th>
              <th>{t('table.category')}</th>
              <th style={{ textAlign: 'end' }}>{t('table.amount')}</th>
              <th style={{ textAlign: 'end' }}>{t('table.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.id}
                className="click"
                tabIndex={0}
                onClick={() => open(row)}
                onKeyDown={(event) => onRowKey(event, row)}
                data-testid="wallet-tx"
              >
                <td>
                  <span className={row.isOut ? 'tx-ic out' : 'tx-ic in'} aria-hidden="true">{row.isOut ? '−' : '+'}</span>
                  <span className="mono">{referenceOf(row)}</span>
                </td>
                <td>
                  <div className="cell2"><span>{row.dateText}</span><span>{row.timeText}</span></div>
                </td>
                <td>
                  <div className="cell2"><b>{t(`reasons.${row.reason}`)}</b><span>{t(`reasonHints.${row.reason}`)}</span></div>
                </td>
                <td className="num" style={{ fontWeight: 800, color: row.isOut ? 'var(--bad-fg)' : 'var(--ok-text)' }}>
                  <bdi>{row.amountText}</bdi>
                </td>
                <td style={{ textAlign: 'end' }}>
                  <span className="row-actions">
                    {row.proofId ? (
                      <Link className="btn sm" href={`/wallet/proof/${row.proofId}`} onClick={(event) => event.stopPropagation()}>
                        <Icon name="doc" size={13} /> {t('proofShort')}
                      </Link>
                    ) : null}
                    <span className="btn sm">{t('details')}</span>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <dialog ref={dialogRef} className="modal drawer" aria-labelledby="tx-title" onClose={() => setSelected(null)}>
        {selected ? <TransactionDetails row={selected} onClose={() => dialogRef.current?.close()} /> : null}
      </dialog>
    </>
  );
}

function TransactionDetails({ row, onClose }: { row: TransactionRowView; onClose: () => void }) {
  const t = useTranslations('wallet');
  return (
    <>
      <div className="modal-h">
        <h2 id="tx-title">{t(`reasons.${row.reason}`)}</h2>
        <button type="button" className="icon-btn" onClick={onClose} aria-label={t('close')}>
          <Icon name="x" size={18} />
        </button>
      </div>
      <div className="modal-b">
        <div className="dt-head">
          <span className="eyebrow"><span className="mono">{referenceOf(row)}</span></span>
          <div className={row.isOut ? 'dt-amt num neg' : 'dt-amt num pos'}><bdi>{row.amountText}</bdi></div>
          <span className="muted small">{row.dateText}, {row.timeText}</span>
        </div>
        <p className="small muted" style={{ margin: 0 }}>{t(`reasonExplain.${row.reason}`)}</p>
        <h3>{t('drawer.details')}</h3>
        <div className="lines small">
          <div><span className="muted">{t('drawer.type')}</span><span>{t(`reasons.${row.reason}`)}</span></div>
          <div><span className="muted">{t('drawer.when')}</span><span>{row.dateText}, {row.timeText}</span></div>
          {row.orderNumber ? (
            <div>
              <span className="muted">{t('drawer.order')}</span>
              <Link className="oid" href={`/orders/${row.orderNumber}`}>{row.orderNumber}</Link>
            </div>
          ) : null}
          {row.cashOutNumber ? (
            <div><span className="muted">{t('drawer.cashOut')}</span><span className="mono">{row.cashOutNumber}</span></div>
          ) : null}
        </div>
        {row.proofId ? (
          <>
            <h3>{t('proof.title')}</h3>
            <Link className="proof-thumb" href={`/wallet/proof/${row.proofId}`}>
              <span className="pt-doc"><Icon name="doc" size={22} /></span>
              <span className="cell2" style={{ flex: 1 }}>
                <b>{t('drawer.proofTitle')}</b>
                <span>{t('drawer.proofHint')}</span>
              </span>
              <span className="btn sm">{t('drawer.view')}</span>
            </Link>
          </>
        ) : null}
      </div>
      <div className="modal-f">
        {row.orderNumber ? (
          <Link className="btn" href={`/orders/${row.orderNumber}`}>
            <Icon name="box" size={15} /> {t('drawer.openOrder')}
          </Link>
        ) : null}
        {row.proofId ? (
          <Link className="btn" href={`/wallet/proof/${row.proofId}`}>
            <Icon name="doc" size={15} /> {t('proof.title')}
          </Link>
        ) : null}
        <Button variant="primary" onClick={onClose}>{t('drawer.done')}</Button>
      </div>
    </>
  );
}
