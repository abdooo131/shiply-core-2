'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useActionState, useEffect, useRef, useState, useTransition } from 'react';
import type { ProductView } from '@/orders';
import { formatPiasters } from '@/shared/money';
import { Button } from '@/ui/button';
import { Field } from '@/ui/field';
import { Icon } from '@/ui/icon';
import { Pill } from '@/ui/pill';
import { Toast } from '@/ui/toast';
import { saveProductAction, setProductActiveAction, type ProductActionState } from './actions';

const IDLE: ProductActionState = { status: 'idle' };
const PIASTERS_PER_POUND = 100;

type Editing = { product: ProductView | null; formKey: number };

function priceText(pricePiasters: number): string {
  return (pricePiasters / PIASTERS_PER_POUND).toFixed(2);
}

function ProductForm({ product, onSaved, onCancel }: { product: ProductView | null; onSaved: () => void; onCancel: () => void }) {
  const t = useTranslations('products');
  const locale = useLocale();
  const [state, formAction, pending] = useActionState(saveProductAction.bind(null, locale), IDLE);
  // Each successful save is reported once, even when the parent re-renders.
  const reported = useRef<ProductActionState>(IDLE);

  useEffect(() => {
    if (state.status !== 'ok' || reported.current === state) return;
    reported.current = state;
    onSaved();
  }, [state, onSaved]);

  return (
    <form action={formAction}>
      <div className="modal-b">
        {state.status === 'error' && state.errorKey ? (
          <div className="alert" role="alert">{t(`errors.${state.errorKey}`)}</div>
        ) : null}
        {product ? <input type="hidden" name="id" value={product.id} /> : null}
        <div className="g2">
          <Field label={t('nameEn')} name="nameEn" required maxLength={120} dir="ltr" lang="en"
            defaultValue={product?.nameEn} data-testid="product-name-en" />
          <Field label={t('nameAr')} name="nameAr" required maxLength={120} dir="rtl" lang="ar"
            defaultValue={product?.nameAr} data-testid="product-name-ar" />
        </div>
        <Field label={t('price')} name="price" required inputMode="decimal" dir="ltr" className="num"
          placeholder={t('pricePlaceholder')} defaultValue={product ? priceText(product.pricePiasters) : undefined}
          data-testid="product-price" />
      </div>
      <div className="modal-f">
        <Button onClick={onCancel}>{t('cancel')}</Button>
        <Button type="submit" variant="primary" disabled={pending} data-testid="product-save">
          {product ? t('saveChanges') : t('add')}
        </Button>
      </div>
    </form>
  );
}

function ActiveButton({ product, onDone }: { product: ProductView; onDone: (message: string | null, errorKey?: string) => void }) {
  const t = useTranslations('products');
  const locale = useLocale();
  const [pending, startTransition] = useTransition();
  const name = locale === 'ar' ? product.nameAr : product.nameEn;

  const toggle = () =>
    startTransition(async () => {
      const result = await setProductActiveAction(locale, product.id, !product.isActive);
      if (result.status === 'error') onDone(null, result.errorKey);
      else onDone(product.isActive ? t('hiddenToast', { name }) : t('shownToast', { name }));
    });

  return (
    <Button small onClick={toggle} disabled={pending} data-testid="product-toggle"
      aria-label={product.isActive ? t('hideLabel', { name }) : t('showLabel', { name })}>
      {product.isActive ? t('hide') : t('show')}
    </Button>
  );
}

export function ProductsManager({ products }: { products: ProductView[] }) {
  const t = useTranslations('products');
  const locale = useLocale();
  const moneyLocale = locale === 'ar' ? 'ar' : 'en';
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [editing, setEditing] = useState<Editing>({ product: null, formKey: 0 });
  const [toast, setToast] = useState<{ message: string; key: number } | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const showToast = (message: string) => setToast((current) => ({ message, key: (current?.key ?? 0) + 1 }));
  const open = (product: ProductView | null) => {
    setEditing((current) => ({ product, formKey: current.formKey + 1 }));
    dialogRef.current?.showModal();
  };
  const close = () => dialogRef.current?.close();
  const onSaved = () => {
    close();
    showToast(editing.product ? t('savedToast') : t('addedToast'));
  };
  const onToggled = (message: string | null, failedKey?: string) => {
    setErrorKey(failedKey ?? null);
    if (message) showToast(message);
  };
  const activeCount = products.filter((product) => product.isActive).length;

  return (
    <>
      <div className="page-head">
        <div className="grow">
          <h1>{t('title')}</h1>
          <span className="muted">{t('summary', { count: products.length, active: activeCount })}</span>
        </div>
        <Button variant="primary" onClick={() => open(null)} data-testid="product-add">
          <Icon name="plus" size={16} strokeWidth={2.6} /> {t('add')}
        </Button>
      </div>

      {errorKey ? <div className="alert" role="alert">{t(`errors.${errorKey}`)}</div> : null}

      {products.length === 0 ? (
        <section className="card soon">
          <span className="ic"><Icon name="tag" size={26} /></span>
          <h2>{t('emptyTitle')}</h2>
          <p className="muted" style={{ margin: 0 }}>{t('emptyText')}</p>
        </section>
      ) : (
        <section className="card" style={{ overflow: 'hidden' }}>
          <div className="tbl-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('product')}</th>
                  <th style={{ textAlign: 'end' }}>{t('priceColumn')}</th>
                  <th>{t('status')}</th>
                  <th><span className="sr-only">{t('actions')}</span></th>
                </tr>
              </thead>
              <tbody>
                {products.map((product) => {
                  const [main, other, otherLang] =
                    locale === 'ar' ? [product.nameAr, product.nameEn, 'en'] : [product.nameEn, product.nameAr, 'ar'];
                  return (
                    <tr key={product.id} data-testid="product-row">
                      <td>
                        <div className="row" style={{ flexWrap: 'nowrap' }}>
                          <span className="thumb"><Icon name="tag" size={20} /></span>
                          <div className="cell2">
                            <b>{main}</b>
                            <span className="small muted" lang={otherLang}>{other}</span>
                          </div>
                        </div>
                      </td>
                      <td className="num" style={{ textAlign: 'end', whiteSpace: 'nowrap' }}>
                        <b>{formatPiasters(product.pricePiasters, moneyLocale)}</b>
                      </td>
                      <td>
                        <Pill tone={product.isActive ? 'ok' : 'grey'}>{product.isActive ? t('active') : t('hidden')}</Pill>
                      </td>
                      <td>
                        <div className="row" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap', gap: 6 }}>
                          <Button small onClick={() => open(product)} aria-label={t('editLabel', { name: main })} data-testid="product-edit">
                            {t('edit')}
                          </Button>
                          <ActiveButton product={product} onDone={onToggled} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <dialog ref={dialogRef} className="modal" aria-labelledby="product-dialog-title">
        <div className="modal-h">
          <h2 id="product-dialog-title">{editing.product ? t('editTitle') : t('addTitle')}</h2>
          <button type="button" className="icon-btn" onClick={close} aria-label={t('close')}>
            <Icon name="x" />
          </button>
        </div>
        <ProductForm key={editing.formKey} product={editing.product} onSaved={onSaved} onCancel={close} />
      </dialog>

      {toast ? <Toast key={toast.key} message={toast.message} /> : null}
    </>
  );
}
