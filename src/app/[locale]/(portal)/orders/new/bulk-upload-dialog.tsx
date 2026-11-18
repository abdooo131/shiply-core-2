'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useActionState, useEffect, useRef, useState, type DragEvent } from 'react';
import { Button } from '@/ui/button';
import { Icon } from '@/ui/icon';
import { uploadOrdersAction, type BulkUploadState } from './bulk-upload-actions';

const IDLE: BulkUploadState = { status: 'idle' };
const MAX_ORDERS_PER_FILE = 500;
// Row error codes that have their own message; anything else shows the general one.
const ROW_ERROR_CODES = new Set([
  'type_not_allowed', 'invalid_type', 'missing_type', 'missing_customer_name', 'missing_mobile', 'missing_address',
  'missing_area', 'area_unknown', 'invalid_size', 'invalid_open_package', 'invalid_cash_direction',
  'missing_cash_direction', 'invalid_amount', 'invalid_mobile', 'area_not_found', 'area_not_served', 'price_missing',
  'invalid_input', 'not_found', 'forbidden',
]);

function UploadResult({ state }: { state: Extract<BulkUploadState, { status: 'ok' }> }) {
  const t = useTranslations('bulkUpload');
  const locale = useLocale();
  const rowError = (code: string) => t(`rowErrors.${ROW_ERROR_CODES.has(code) ? code : 'unexpected'}`);

  return (
    <div className="cell2" style={{ gap: 12 }} data-testid="bulk-result">
      <div className="found" role="status">
        <Icon name="check" />
        <b className="grow" data-testid="bulk-created">{t('createdCount', { count: state.created.length })}</b>
        {state.orderIds.length > 0 ? (
          <a className="btn sm" href={`/${locale}/orders/labels?ids=${state.orderIds.join(',')}`} target="_blank" rel="noopener"
            data-testid="bulk-print">
            {t('printAll')}
          </a>
        ) : null}
      </div>
      {state.created.length > 0 ? (
        <p className="small muted" style={{ margin: 0 }}>
          {t('createdNumbers')} <span className="mono" dir="ltr">{state.created.map((row) => row.orderNumber).join(', ')}</span>
        </p>
      ) : null}
      {state.failed.length > 0 ? (
        <>
          <b>{t('failedCount', { count: state.failed.length })}</b>
          <div className="tbl-wrap card" style={{ overflow: 'auto', maxHeight: 260 }}>
            <table data-testid="bulk-failed">
              <thead>
                <tr><th>{t('row')}</th><th>{t('problem')}</th></tr>
              </thead>
              <tbody>
                {state.failed.map((row) => (
                  <tr key={row.rowNumber}>
                    <td className="num">{row.rowNumber}</td>
                    <td>{row.errors.map(rowError).join(' · ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="small muted" style={{ margin: 0 }}>{t('fixAndRetry')}</p>
        </>
      ) : null}
    </div>
  );
}

export function BulkUploadDialog() {
  const t = useTranslations('bulkUpload');
  const locale = useLocale();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [state, formAction, pending] = useActionState(uploadOrdersAction.bind(null, locale), IDLE);

  // React clears the file input after each upload, so the shown file name is cleared too.
  useEffect(() => setFileName(''), [state]);

  const close = () => dialogRef.current?.close();
  const onDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setIsDragging(false);
    const input = inputRef.current;
    if (!input || event.dataTransfer.files.length === 0) return;
    input.files = event.dataTransfer.files;
    setFileName(event.dataTransfer.files[0]?.name ?? '');
  };

  return (
    <>
      <Button onClick={() => dialogRef.current?.showModal()} data-testid="bulk-open">
        <Icon name="upload" size={16} /> {t('open')}
      </Button>
      <dialog ref={dialogRef} className="modal" aria-labelledby="bulk-dialog-title">
        <div className="modal-h">
          <h2 id="bulk-dialog-title">{t('title')}</h2>
          <button type="button" className="icon-btn" onClick={close} aria-label={t('close')}>
            <Icon name="x" />
          </button>
        </div>
        <form action={formAction}>
          <div className="modal-b">
            {state.status === 'error' ? (
              <div className="alert" role="alert">{t(`errors.${state.errorKey}`)}</div>
            ) : null}
            <label
              className={isDragging ? 'drop over' : 'drop'}
              onDragOver={(event) => { event.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={onDrop}
            >
              <Icon name="upload" size={30} />
              <b style={{ fontSize: 15 }}>{fileName || t('dropHere')}</b>
              <span className="small muted">{t('limit', { max: MAX_ORDERS_PER_FILE })}</span>
              <span className="btn sm" style={{ marginTop: 6 }}>{t('chooseFile')}</span>
              <input
                ref={inputRef}
                type="file"
                name="file"
                accept=".xlsx,.csv"
                required
                className="sr-only"
                onChange={(event) => setFileName(event.target.files?.[0]?.name ?? '')}
                data-testid="bulk-file"
              />
            </label>
            <div className="row small">
              <span className="muted grow">{t('templateHint')}</span>
              <a className="btn sm" href="/api/orders/bulk-template?locale=en" download data-testid="bulk-template-en">
                <Icon name="download" size={14} /> {t('templateEnglish')}
              </a>
              <a className="btn sm" href="/api/orders/bulk-template?locale=ar" download data-testid="bulk-template-ar">
                <Icon name="download" size={14} /> {t('templateArabic')}
              </a>
            </div>
            {state.status === 'ok' ? <UploadResult state={state} /> : null}
          </div>
          <div className="modal-f">
            <Button onClick={close}>{t('cancel')}</Button>
            <Button type="submit" variant="primary" disabled={pending} data-testid="bulk-submit">
              {pending ? t('uploading') : t('upload')}
            </Button>
          </div>
        </form>
      </dialog>
    </>
  );
}
