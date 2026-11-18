'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link } from '@/i18n/navigation';
import type { CreateOrderInput } from '@/orders';
import type { FeeQuote } from '@/pricing';
import { AppError } from '@/shared/app-error';
import { formatPiasters, parseEgpToPiasters } from '@/shared/money';
import { Button } from '@/ui/button';
import { Field } from '@/ui/field';
import { Icon, type IconName } from '@/ui/icon';
import { Toast } from '@/ui/toast';
import { createOrderAction, lookupCustomerAction, quoteAction, type CustomerLookup } from './actions';

type OrderType = CreateOrderInput['type'];
type PackageSize = CreateOrderInput['size'];
type Product = { id: string; nameEn: string; nameAr: string; pricePiasters: number };
type AreaOption = { id: string; nameEn: string; nameAr: string; governorateNameEn: string; governorateNameAr: string };

const TYPES: { type: OrderType; icon: IconName }[] = [
  { type: 'deliver', icon: 'truck' },
  { type: 'pick_and_choose', icon: 'tag' },
  { type: 'exchange', icon: 'box' },
  { type: 'return', icon: 'logout' },
  { type: 'sign_and_return', icon: 'check' },
  { type: 'cash_collection', icon: 'coin' },
];
const SIZES: PackageSize[] = ['small', 'medium', 'large', 'light_bulky', 'heavy_bulky'];
const MAX_PICKS = 3;
const AREA_SEARCH_DELAY_MS = 200;
const QUOTE_DELAY_MS = 300;
const EGYPTIAN_MOBILE_DIGITS = 11;

type FormState = {
  type: OrderType;
  mobile: string;
  name: string;
  address: string;
  extra: string;
  areaId: string;
  areaText: string;
  size: PackageSize;
  description: string;
  amount: string;
  cashDirection: 'collect' | 'give';
  itemValue: string;
  insure: boolean;
  open: boolean;
  deposit: boolean;
  productIds: string[];
  linkedOrderNumber: string;
  reference: string;
  courierNote: string;
};

const emptyForm = (type: OrderType): FormState => ({
  type,
  mobile: '',
  name: '',
  address: '',
  extra: '',
  areaId: '',
  areaText: '',
  size: 'small',
  description: '',
  amount: '',
  cashDirection: 'collect',
  itemValue: '',
  insure: false,
  open: false,
  deposit: false,
  productIds: [],
  linkedOrderNumber: '',
  reference: '',
  courierNote: '',
});

function piastersOrNull(text: string): number | null {
  if (!text.trim()) return 0;
  try {
    return parseEgpToPiasters(text);
  } catch (error) {
    if (error instanceof AppError) return null;
    throw error;
  }
}

function toInput(form: FormState): CreateOrderInput | null {
  const amount = piastersOrNull(form.amount);
  const itemValue = form.insure ? piastersOrNull(form.itemValue) : 0;
  if (amount === null || itemValue === null) return null;
  return {
    type: form.type,
    customerName: form.name,
    customerMobile: form.mobile,
    addressText: form.address,
    addressExtra: form.extra || undefined,
    areaId: form.areaId,
    size: form.size,
    description: form.description || undefined,
    codAmountPiasters: amount,
    cashDirection: form.type === 'cash_collection' ? form.cashDirection : undefined,
    allowOpenPackage: form.open,
    depositRequired: form.deposit,
    insuredValuePiasters: itemValue,
    productIds: form.type === 'pick_and_choose' ? form.productIds : undefined,
    linkedOrderNumber: (form.type === 'exchange' || form.type === 'return') && form.linkedOrderNumber ? form.linkedOrderNumber : undefined,
    merchantReference: form.reference || undefined,
    courierNote: form.courierNote || undefined,
  };
}

export function CreateOrderForm({
  products,
  initialType = 'deliver',
  initialLinkedOrderNumber = '',
}: {
  products: Product[];
  initialType?: OrderType;
  initialLinkedOrderNumber?: string;
}) {
  const t = useTranslations('createOrder');
  const locale = useLocale() as 'en' | 'ar';
  const [form, setForm] = useState<FormState>(() => ({ ...emptyForm(initialType), linkedOrderNumber: initialLinkedOrderNumber }));
  const [errors, setErrors] = useState<Partial<Record<keyof FormState | 'form', string>>>({});
  const [quote, setQuote] = useState<FeeQuote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [known, setKnown] = useState<CustomerLookup>(null);
  const [areaOptions, setAreaOptions] = useState<AreaOption[]>([]);
  const [areaOpen, setAreaOpen] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState<{ id: string; number: string; name: string } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const areaListId = useId();
  const areaRequest = useRef(0);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined, form: undefined }));
  };

  const isCash = form.type === 'cash_collection';
  const hasParcel = !isCash && form.type !== 'sign_and_return';
  const canOpen = form.type === 'deliver' || form.type === 'exchange' || form.type === 'pick_and_choose';
  const canDeposit = canOpen;
  const isPickAndChoose = form.type === 'pick_and_choose';

  // Live fee summary, using the same pricing as the stored order.
  const quoteInput = useMemo(() => (form.areaId ? toInput(form) : null), [form]);
  useEffect(() => {
    if (!quoteInput) {
      setQuote(null);
      return;
    }
    const timer = setTimeout(async () => {
      const result = await quoteAction(locale, quoteInput);
      if ('quote' in result) {
        setQuote(result.quote);
        setQuoteError(null);
      } else {
        setQuote(null);
        setQuoteError(result.errorKey);
      }
    }, QUOTE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [quoteInput, locale]);

  const searchArea = (text: string) => {
    setForm((current) => ({ ...current, areaText: text, areaId: '' }));
    setErrors((current) => ({ ...current, areaId: undefined }));
    const requestId = (areaRequest.current += 1);
    if (!text.trim()) {
      setAreaOptions([]);
      return;
    }
    setTimeout(async () => {
      if (requestId !== areaRequest.current) return;
      const response = await fetch(`/api/areas?q=${encodeURIComponent(text)}`);
      if (!response.ok || requestId !== areaRequest.current) return;
      const body = (await response.json()) as { areas: AreaOption[] };
      setAreaOptions(body.areas);
      setAreaOpen(true);
    }, AREA_SEARCH_DELAY_MS);
  };

  const areaLabel = (area: AreaOption) =>
    locale === 'ar' ? `${area.nameAr}، ${area.governorateNameAr}` : `${area.nameEn}, ${area.governorateNameEn}`;

  const chooseArea = (area: AreaOption) => {
    setForm((current) => ({ ...current, areaId: area.id, areaText: areaLabel(area) }));
    setAreaOpen(false);
  };

  const checkMobile = async () => {
    if (form.mobile.replace(/\D/g, '').length < EGYPTIAN_MOBILE_DIGITS) return;
    setKnown(await lookupCustomerAction(locale, form.mobile));
  };

  const useKnownCustomer = () => {
    if (!known) return;
    setForm((current) => ({
      ...current,
      name: known.name,
      address: known.addressText,
      areaId: known.areaId ?? current.areaId,
      areaText: known.areaLabel ?? current.areaText,
    }));
    setKnown(null);
  };

  const togglePick = (productId: string) => {
    setForm((current) => {
      const chosen = current.productIds.includes(productId);
      if (!chosen && current.productIds.length >= MAX_PICKS) return current;
      return { ...current, productIds: chosen ? current.productIds.filter((id) => id !== productId) : [...current.productIds, productId] };
    });
  };

  const validate = (): boolean => {
    const next: typeof errors = {};
    if (form.mobile.replace(/\D/g, '').length < EGYPTIAN_MOBILE_DIGITS) next.mobile = t('errors.mobile');
    if (!form.name.trim()) next.name = t('errors.name');
    if (form.address.trim().length < 3) next.address = t('errors.address');
    if (!form.areaId) next.areaId = t('errors.area');
    if (piastersOrNull(form.amount) === null) next.amount = t('errors.amount');
    if (isCash && !(Number(piastersOrNull(form.amount)) > 0)) next.amount = t('errors.cashAmount');
    if (form.insure && piastersOrNull(form.itemValue) === null) next.itemValue = t('errors.amount');
    if (isPickAndChoose && form.productIds.length === 0) next.form = t('errors.products');
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const save = async (addAnother: boolean) => {
    if (!validate()) return;
    const input = toInput(form);
    if (!input) return;
    setSaving(true);
    const result = await createOrderAction(locale, input, idempotencyKey);
    setSaving(false);
    if ('errorKey' in result) {
      setErrors({ form: t(`errors.${result.errorKey}`) });
      return;
    }
    setIdempotencyKey(crypto.randomUUID());
    const createdOrder = { ...result.order, name: form.name };
    setForm(emptyForm(form.type));
    setQuote(null);
    setKnown(null);
    if (addAnother) {
      setToast(t('createdToast', { number: createdOrder.number, name: createdOrder.name }));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      setCreated(createdOrder);
    }
  };

  if (created) {
    return (
      <section className="card soon" role="status">
        <span className="ic"><Icon name="check" size={26} /></span>
        <h2>{t('createdTitle', { number: created.number })}</h2>
        <p className="muted" style={{ margin: 0 }}>{t('createdText', { name: created.name })}</p>
        <div className="row" style={{ justifyContent: 'center' }}>
          <a className="btn primary" href={`/${locale}/orders/labels?ids=${created.id}`} target="_blank" rel="noopener" data-testid="print-label">
            {t('printLabel')}
          </a>
          <Button onClick={() => setCreated(null)}>{t('createAnother')}</Button>
        </div>
      </section>
    );
  }

  const amountLabel =
    form.type === 'return' ? t('refundAmount') : isCash ? (form.cashDirection === 'give' ? t('cashToGive') : t('cashToCollect')) : t('cashToCollect');
  const receive = quote && !isCash && form.type !== 'return' ? (piastersOrNull(form.amount) ?? 0) - quote.totalPiasters : null;
  const takenFromWallet = quote && (form.type === 'return' || (isCash && form.cashDirection === 'give')) ? (piastersOrNull(form.amount) ?? 0) + quote.totalPiasters : null;
  const money = (piasters: number) => formatPiasters(piasters, locale);

  return (
    <>
      <div className="grid g3 type-grid" role="radiogroup" aria-label={t('typeGroup')}>
        {TYPES.map(({ type, icon }) => (
          <label key={type} className={form.type === type ? 'opt on' : 'opt'}>
            <input type="radio" name="orderType" value={type} checked={form.type === type} onChange={() => set('type', type)} data-testid={`type-${type}`} />
            <span className="type-ic"><Icon name={icon} /></span>
            <span className="cell2">
              <b>{t(`types.${type}.name`)}</b>
              <span className="small muted">{t(`types.${type}.hint`)}</span>
            </span>
          </label>
        ))}
      </div>

      <form className="split" noValidate onSubmit={(event) => { event.preventDefault(); void save(false); }}>
        <div className="grid">
          <section className="card">
            <div className="card-h"><span className="sec-num">1</span><h2 className="grow">{t('customer')}</h2></div>
            <div className="card-b g2" style={{ paddingTop: 0 }}>
              <Field label={t('mobile')} name="mobile" type="tel" inputMode="tel" dir="ltr" placeholder="01x xxxx xxxx" value={form.mobile}
                onChange={(event) => set('mobile', event.target.value)} onBlur={checkMobile} error={errors.mobile} autoComplete="off" />
              <Field label={t('name')} name="name" value={form.name} dir="auto" onChange={(event) => set('name', event.target.value)} error={errors.name} />
              {known && known.name !== form.name ? (
                <div className="found" style={{ gridColumn: '1 / -1' }}>
                  <Icon name="check" />
                  <span style={{ flex: 1 }}><b>{t('returningCustomer', { name: known.name })}</b> · {t('pastOrders', { count: known.orderCount })}</span>
                  <Button small onClick={useKnownCustomer}>{t('useDetails')}</Button>
                </div>
              ) : null}
              <div style={{ gridColumn: '1 / -1' }}>
                <Field label={t('address')} name="address" dir="auto" placeholder={t('addressPlaceholder')} value={form.address}
                  onChange={(event) => set('address', event.target.value)} error={errors.address} />
              </div>
              <div className="field" style={{ position: 'relative' }}>
                <label htmlFor={`${areaListId}-input`}>{t('area')}</label>
                <input
                  id={`${areaListId}-input`}
                  className={errors.areaId ? 'input err' : 'input'}
                  role="combobox"
                  aria-expanded={areaOpen && areaOptions.length > 0}
                  aria-controls={areaListId}
                  aria-autocomplete="list"
                  autoComplete="off"
                  placeholder={t('areaPlaceholder')}
                  value={form.areaText}
                  onChange={(event) => searchArea(event.target.value)}
                  onFocus={() => setAreaOpen(true)}
                  onBlur={() => setTimeout(() => setAreaOpen(false), 150)}
                />
                {areaOpen && areaOptions.length > 0 ? (
                  <ul id={areaListId} role="listbox" className="card suggest">
                    {areaOptions.map((area) => (
                      <li key={area.id} role="option" aria-selected={area.id === form.areaId} onMouseDown={() => chooseArea(area)}>
                        {areaLabel(area)}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {errors.areaId ? <span className="err-msg">{errors.areaId}</span> : null}
              </div>
              <Field label={t('extra')} name="extra" dir="auto" placeholder={t('extraPlaceholder')} value={form.extra} onChange={(event) => set('extra', event.target.value)} />
            </div>
          </section>

          <section className="card">
            <div className="card-h"><span className="sec-num">2</span><h2 className="grow">{t(`packageTitle.${form.type}`)}</h2></div>
            <div className="card-b grid" style={{ paddingTop: 0 }}>
              {isCash ? (
                <>
                  <div className="seg" role="radiogroup" aria-label={t('cashDirection')}>
                    {(['collect', 'give'] as const).map((direction) => (
                      <button key={direction} type="button" role="radio" aria-checked={form.cashDirection === direction}
                        className={form.cashDirection === direction ? 'on' : undefined} onClick={() => set('cashDirection', direction)}>
                        {t(`cashDirections.${direction}`)}
                      </button>
                    ))}
                  </div>
                  <p className="small muted" style={{ margin: 0 }}>{t(`cashDirectionHint.${form.cashDirection}`)}</p>
                </>
              ) : null}
              {form.type === 'sign_and_return' ? <p className="small muted" style={{ margin: 0 }}>{t('signHint')}</p> : null}
              {form.type === 'exchange' || form.type === 'return' ? (
                <Field label={t('linkedOrder')} name="linkedOrderNumber" inputMode="numeric" dir="ltr" placeholder="1234567890" hint={t('linkedOrderHint')}
                  value={form.linkedOrderNumber} onChange={(event) => set('linkedOrderNumber', event.target.value.replace(/\D/g, '').slice(0, 10))} />
              ) : null}
              {isPickAndChoose ? (
                <>
                  <p className="small muted" style={{ margin: 0 }}>{t('picksHint')}</p>
                  <div className="pick-grid">
                    {products.map((product) => {
                      const chosen = form.productIds.includes(product.id);
                      return (
                        <button key={product.id} type="button" className={chosen ? 'pick on' : 'pick'} aria-pressed={chosen}
                          disabled={!chosen && form.productIds.length >= MAX_PICKS} onClick={() => togglePick(product.id)}>
                          <span className="thumb"><Icon name="tag" /></span>
                          <span className="cell2">
                            <b>{locale === 'ar' ? product.nameAr : product.nameEn}</b>
                            <span className="small muted">{money(product.pricePiasters)}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  {products.length === 0 ? <Link href="/products" className="btn sm">{t('addProducts')}</Link> : null}
                  <span className="hint">{t('picksCount', { count: form.productIds.length, max: MAX_PICKS })}</span>
                </>
              ) : null}
              {hasParcel && !isPickAndChoose ? (
                <div className="size-grid" role="radiogroup" aria-label={t('size')}>
                  {SIZES.map((size) => (
                    <label key={size} className={form.size === size ? 'opt on' : 'opt'}>
                      <input type="radio" name="size" value={size} checked={form.size === size} onChange={() => set('size', size)} />
                      <span className="cell2"><b>{t(`sizes.${size}`)}</b><span className="small muted">{t(`sizeHints.${size}`)}</span></span>
                    </label>
                  ))}
                </div>
              ) : null}
              {!isCash && !isPickAndChoose ? (
                <Field label={form.type === 'sign_and_return' ? t('documents') : t('whatsInside')} name="description" dir="auto"
                  placeholder={t('whatsInsidePlaceholder')} value={form.description} onChange={(event) => set('description', event.target.value)} />
              ) : null}
            </div>
          </section>

          <section className="card">
            <div className="card-h"><span className="sec-num">3</span><h2 className="grow">{isCash ? t('amountTitle') : t('paymentTitle')}</h2></div>
            <div className="card-b grid" style={{ paddingTop: 0 }}>
              <div className="g2">
                <Field label={amountLabel} name="amount" inputMode="decimal" dir="ltr" placeholder={t('amountPlaceholder')} value={form.amount}
                  onChange={(event) => set('amount', event.target.value)} error={errors.amount} hint={form.type === 'return' ? t('refundHint') : undefined} />
                {!isCash ? (
                  <Field label={t('itemValue')} name="itemValue" inputMode="decimal" dir="ltr" placeholder="EGP" value={form.itemValue}
                    onChange={(event) => set('itemValue', event.target.value)} error={errors.itemValue} disabled={!form.insure} />
                ) : null}
              </div>
              {canOpen ? (
                <label className="opt">
                  <span className="toggle"><input type="checkbox" checked={form.open || isPickAndChoose} disabled={isPickAndChoose} onChange={(event) => set('open', event.target.checked)} /><span /></span>
                  <span className="cell2"><b>{t('openPackage')}</b><span className="small muted">{isPickAndChoose ? t('openPackageForced') : t('openPackageHint')}</span></span>
                </label>
              ) : null}
              {canDeposit ? (
                <label className="opt">
                  <span className="toggle"><input type="checkbox" checked={form.deposit} onChange={(event) => set('deposit', event.target.checked)} /><span /></span>
                  <span className="cell2"><b>{t('deposit')}</b><span className="small muted">{t('depositHint')}</span></span>
                </label>
              ) : null}
              {!isCash ? (
                <label className="opt">
                  <span className="toggle"><input type="checkbox" checked={form.insure} onChange={(event) => set('insure', event.target.checked)} /><span /></span>
                  <span className="cell2"><b>{t('insure')}</b><span className="small muted">{t('insureHint')}</span></span>
                </label>
              ) : null}
              <div className="g2">
                <Field label={t('reference')} name="reference" dir="auto" placeholder={t('referencePlaceholder')} value={form.reference} onChange={(event) => set('reference', event.target.value)} />
                <Field label={t('courierNote')} name="courierNote" dir="auto" placeholder={t('courierNotePlaceholder')} value={form.courierNote} onChange={(event) => set('courierNote', event.target.value)} />
              </div>
            </div>
          </section>
        </div>

        <aside className="sumbar">
          <div className="card" style={{ overflow: 'hidden' }}>
            <div className="card-b sum-head">
              <span className="eyebrow">{t('summary')}</span>
              <b style={{ fontSize: 18 }}>{t(`types.${form.type}.name`)}{hasParcel && !isPickAndChoose ? ` · ${t(`sizes.${form.size}`)}` : ''}</b>
              <span className="small">{form.areaText || t('pickArea')}</span>
            </div>
            <div className="card-b lines small" data-testid="fee-summary">
              <div><span className="muted">{t('shipping')}</span><span>{quote ? money(quote.shippingPiasters) : '—'}</span></div>
              {quote && quote.openPackagePiasters ? <div><span className="muted">{t('openPackageFee')}</span><span>{money(quote.openPackagePiasters)}</span></div> : null}
              {quote && quote.codFeePiasters ? <div><span className="muted">{t('codFee')}</span><span>{money(quote.codFeePiasters)}</span></div> : null}
              {quote && quote.insurancePiasters ? <div><span className="muted">{t('insuranceFee')}</span><span>{money(quote.insurancePiasters)}</span></div> : null}
              <div><span className="muted">{t('vat')}</span><span>{quote ? money(quote.vatPiasters) : '—'}</span></div>
              <div className="total"><span>{t('shiplyFee')}</span><span data-testid="total-fee">{quote ? money(quote.totalPiasters) : '—'}</span></div>
              {receive !== null && (piastersOrNull(form.amount) ?? 0) > 0 ? (
                <div><span className="muted">{t('youReceive')}</span><b className="ok-text">{money(receive)}</b></div>
              ) : null}
              {takenFromWallet !== null && (piastersOrNull(form.amount) ?? 0) > 0 ? (
                <div><span className="muted">{t('takenFromWallet')}</span><b>{money(takenFromWallet)}</b></div>
              ) : null}
              {quoteError ? <div className="alert" role="alert">{t(`errors.${quoteError}`)}</div> : null}
            </div>
            <div className="card-b grid" style={{ gap: 8, paddingTop: 0 }}>
              {errors.form ? <div className="alert" role="alert">{errors.form}</div> : null}
              <Button type="submit" variant="primary" block disabled={saving} data-testid="create-order">{t('create')}</Button>
              <Button block disabled={saving} onClick={() => void save(true)} data-testid="create-another">{t('createAndAdd')}</Button>
            </div>
          </div>
        </aside>
      </form>
      <Toast message={toast} />
    </>
  );
}
