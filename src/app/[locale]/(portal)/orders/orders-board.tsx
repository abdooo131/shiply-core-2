'use client';

import type { OrderStatus } from '@prisma/client';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState, useTransition, type MouseEvent, type ReactNode } from 'react';
import { Link, useRouter } from '@/i18n/navigation';
import { Button } from '@/ui/button';
import { Icon } from '@/ui/icon';
import { Pill, type PillTone } from '@/ui/pill';
import { Toast } from '@/ui/toast';
import { BulkBar } from './bulk-bar';
import { FilterPill, filterValueText, type FilterDef } from './filter-pill';
import { OrderRoute } from './order-route';
import { ordersHref, type ParamChanges } from './orders-url';
import { SaveViewDialog, SavedViewsMenu, type SaveViewDialogHandle, type ViewChoice } from './saved-views-menu';

const SEARCH_DELAY_MS = 350;
const MAX_ATTEMPTS = 3;
const SORTS = ['updated', 'new', 'old', 'cash'] as const;

// Display-ready: the server translates and formats, so this file never imports server-only code.
export type OrderRowView = {
  id: string;
  number: string;
  status: OrderStatus;
  tone: PillTone;
  statusLabel: string;
  typeName: string;
  customerName: string;
  customerMobile: string;
  areaName: string;
  governorateName: string;
  cashText: string | null;
  attempts: number;
  createdDate: string;
  createdTime: string;
};

export type BoardQuery = {
  q: string;
  date: string;
  gov: string[];
  type: string[];
  pay: string;
  tries: string;
  sort: string;
};

type Filters = Pick<BoardQuery, 'date' | 'gov' | 'type' | 'pay' | 'tries'>;

function isInteractive(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('a, button, input, label, select') !== null;
}

function useOrderNavigation(currentSearch: string) {
  const router = useRouter();
  const [isNavigating, startTransition] = useTransition();
  const go = (changes: ParamChanges, replace = false) =>
    startTransition(() => {
      const href = ordersHref(currentSearch, changes);
      if (replace) router.replace(href, { scroll: false });
      else router.push(href, { scroll: false });
    });
  return { go, isNavigating, push: (href: string) => router.push(href) };
}

function SearchBox({ value, onSearch }: { value: string; onSearch: (q: string) => void }) {
  const t = useTranslations('ordersList');
  const [text, setText] = useState(value);
  const lastSent = useRef(value);
  const onSearchRef = useRef(onSearch);
  onSearchRef.current = onSearch;

  // A search cleared or set elsewhere (Clear all, a saved view) shows up in the box.
  useEffect(() => {
    if (value === lastSent.current) return;
    lastSent.current = value;
    setText(value);
  }, [value]);

  useEffect(() => {
    if (text.trim() === lastSent.current) return;
    const timer = setTimeout(() => {
      lastSent.current = text.trim();
      onSearchRef.current(text.trim());
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [text]);

  return (
    <div className="search" style={{ flex: '1 1 420px', maxWidth: 420 }}>
      <Icon name="search" size={16} />
      <input
        type="search"
        className="input"
        placeholder={t('searchPlaceholder')}
        aria-label={t('searchLabel')}
        value={text}
        onChange={(event) => setText(event.target.value)}
        data-testid="orders-search"
      />
    </div>
  );
}

function EmptyState({ isFiltered, onClearAll }: { isFiltered: boolean; onClearAll: () => void }) {
  const t = useTranslations('ordersList');
  if (!isFiltered) {
    return (
      <div className="empty">
        <h3>{t('noOrdersTitle')}</h3>
        <p>{t('noOrdersText')}</p>
        <Link className="btn primary" href="/orders/new">
          <Icon name="plus" size={16} strokeWidth={2.6} /> {t('createOrder')}
        </Link>
      </div>
    );
  }
  return (
    <div className="empty">
      <h3>{t('emptyTitle')}</h3>
      <p>{t('emptyText')}</p>
      <Button onClick={onClearAll}>{t('clearAllFilters')}</Button>
    </div>
  );
}

function AttemptsNote({ order }: { order: OrderRowView }) {
  const t = useTranslations('ordersList');
  if (order.attempts === 0) return null;
  const isLastTry = order.attempts >= MAX_ATTEMPTS && order.status !== 'delivered';
  return <span className={isLastTry ? 'att x' : 'att'}>{t('tries', { count: order.attempts })}</span>;
}

export function OrdersBoard({
  rows,
  query,
  currentSearch,
  viewQuery,
  total,
  isFiltered,
  filterDefs,
  presets,
  views,
  pager,
}: {
  rows: OrderRowView[];
  query: BoardQuery;
  currentSearch: string;
  viewQuery: string;
  total: number;
  isFiltered: boolean;
  filterDefs: FilterDef[];
  presets: ViewChoice[];
  views: ViewChoice[];
  pager: ReactNode;
}) {
  const t = useTranslations('ordersList');
  const listSeparator = useLocale() === 'ar' ? '، ' : ', ';
  const { go, isNavigating, push } = useOrderNavigation(currentSearch);
  const saveDialog = useRef<SaveViewDialogHandle>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [toast, setToast] = useState<{ message: string; key: number } | null>(null);

  const notify = (message: string) => setToast((current) => ({ message, key: (current?.key ?? 0) + 1 }));

  // A new list (another page, filter or tab) starts with nothing selected, as in the mockup.
  useEffect(() => setSelected(new Set()), [currentSearch]);

  const filters: Filters = { date: query.date, gov: query.gov, type: query.type, pay: query.pay, tries: query.tries };
  const suggestedName =
    filterDefs.map((def) => filterValueText(def, filters[def.key as keyof Filters])).filter(Boolean).join(' · ') || query.q;
  const visibleIds = rows.map((order) => order.id);
  const isAllSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  const selectedIds = visibleIds.filter((id) => selected.has(id));
  const exportHref = selectedIds.length > 0 ? `/api/orders/export?ids=${selectedIds.join(',')}` : '/api/orders/export';

  const toggle = (id: string, isOn: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (isOn) next.add(id);
      else next.delete(id);
      return next;
    });
  const toggleAll = (isOn: boolean) => setSelected(isOn ? new Set(visibleIds) : new Set());
  const applyFilter = (key: string, value: string | string[]) => go({ [key]: Array.isArray(value) ? value.join(',') : value });
  const clearAll = () => go({ q: null, date: null, gov: null, type: null, pay: null, tries: null });
  const openOrder = (event: MouseEvent, number: string) => {
    if (isInteractive(event.target)) return;
    push(`/orders/${number}`);
  };

  return (
    <>
      <section className="card" style={{ overflow: 'hidden' }} aria-busy={isNavigating}>
        <div className="fbar2">
          <div className="row" style={{ flexWrap: 'nowrap', gap: 10 }}>
            <SearchBox value={query.q} onSearch={(q) => go({ q }, true)} />
            <div className="grow" />
            <SavedViewsMenu
              presets={presets}
              views={views}
              canSaveCurrent={isFiltered}
              onSaveCurrent={() => saveDialog.current?.open()}
              notify={notify}
            />
            <label className="sel sm">
              <Icon name="filter" size={14} />
              <select
                aria-label={t('sortLabel')}
                value={query.sort}
                onChange={(event) => go({ sort: event.target.value === 'updated' ? null : event.target.value })}
                data-testid="orders-sort"
              >
                {SORTS.map((sort) => (
                  <option key={sort} value={sort}>{t(`sorts.${sort}`)}</option>
                ))}
              </select>
            </label>
            <a className="btn sm" href={exportHref} download data-testid="orders-export">
              <Icon name="download" size={15} />{' '}
              {selectedIds.length > 0 ? t('exportSelected', { count: selectedIds.length }) : t('export')}
            </a>
          </div>
          <div className="fpills">
            {filterDefs.map((def) => (
              <FilterPill key={def.key} def={def} value={filters[def.key as keyof Filters]} onApply={applyFilter} />
            ))}
          </div>
        </div>

        {isFiltered ? (
          <div className="fsum" data-testid="filter-summary">
            <span>{t.rich('matching', { count: total, b: (chunks) => <b className="num">{chunks}</b> })}</span>
            {query.q ? (
              <span className="pill p-blue">
                “{query.q}”
                <button type="button" className="linkbtn" onClick={() => go({ q: null })} aria-label={t('clearSearch')}>
                  <Icon name="x" size={12} strokeWidth={2.6} />
                </button>
              </span>
            ) : null}
            <span className="grow" />
            <button type="button" className="linkbtn" onClick={() => saveDialog.current?.open()} data-testid="save-as-view">
              <Icon name="plus" size={13} strokeWidth={2.6} /> {t('saveAsView')}
            </button>
            <button type="button" className="linkbtn" onClick={clearAll} data-testid="clear-all">{t('clearAll')}</button>
          </div>
        ) : null}

        {rows.length === 0 ? (
          <EmptyState isFiltered={isFiltered} onClearAll={clearAll} />
        ) : (
          <>
            <div className="tbl-wrap orders">
              <table>
                <thead>
                  <tr>
                    <th className="sticky" style={{ width: 44 }}>
                      <input
                        type="checkbox"
                        className="cb"
                        checked={isAllSelected}
                        onChange={(event) => toggleAll(event.target.checked)}
                        aria-label={t('selectAll')}
                      />
                    </th>
                    <th>{t('columns.order')}</th>
                    <th>{t('columns.customer')}</th>
                    <th>{t('columns.destination')}</th>
                    <th style={{ textAlign: 'end' }}>{t('columns.cash')}</th>
                    <th>{t('columns.progress')}</th>
                    <th>{t('columns.created')}</th>
                    <th><span className="sr-only">{t('columns.actions')}</span></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((order) => {
                    const isSelected = selected.has(order.id);
                    return (
                      <tr
                        key={order.id}
                        className={isSelected ? 'click sel-on' : 'click'}
                        onClick={(event) => openOrder(event, order.number)}
                        data-testid="order-row"
                      >
                        <td className="sticky">
                          <input
                            type="checkbox"
                            className="cb"
                            checked={isSelected}
                            onChange={(event) => toggle(order.id, event.target.checked)}
                            aria-label={t('selectOrder', { number: order.number })}
                          />
                        </td>
                        <td>
                          <div className="cell2">
                            <Link className="oid" href={`/orders/${order.number}`}>{order.number}</Link>
                            <span><span className="typ">{order.typeName}</span></span>
                          </div>
                        </td>
                        <td style={{ maxWidth: 220 }}>
                          <div className="cell2">
                            <b className="ell"><bdi>{order.customerName}</bdi></b>
                            <span><bdi dir="ltr">{order.customerMobile}</bdi></span>
                          </div>
                        </td>
                        <td>
                          <div className="cell2">
                            <span>{order.areaName}</span>
                            <span>{order.governorateName}</span>
                          </div>
                        </td>
                        <td style={{ textAlign: 'end' }}>
                          <div className="cell2">
                            <b className="num">{order.cashText ?? '—'}</b>
                            <span>{order.cashText ? t('cod') : t('prepaid')}</span>
                          </div>
                        </td>
                        <td>
                          <div className="prog">
                            <OrderRoute status={order.status} />
                            <span className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
                              <Pill tone={order.tone}>{order.statusLabel}</Pill>
                              <AttemptsNote order={order} />
                            </span>
                          </div>
                        </td>
                        <td>
                          <div className="cell2">
                            <span>{order.createdDate}</span>
                            <span>{order.createdTime}</span>
                          </div>
                        </td>
                        <td>
                          <div className="row-acts">
                            <Link
                              className="icon-btn sm hov"
                              href={{ pathname: '/orders/labels', query: { ids: order.id } }}
                              aria-label={t('printLabel', { number: order.number })}
                            >
                              <Icon name="print" size={16} />
                            </Link>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="ocards">
              {rows.map((order) => (
                <Link key={order.id} className="ocard" href={`/orders/${order.number}`} data-testid="order-card">
                  <div className="cell2">
                    <b className="ell"><bdi>{order.customerName}</bdi></b>
                    <span>{order.areaName}{listSeparator}{order.governorateName}</span>
                  </div>
                  <b className="num">{order.cashText ?? t('prepaid')}</b>
                  <div className="row" style={{ gap: 8 }}>
                    <Pill tone={order.tone}>{order.statusLabel}</Pill>
                    <span className="oid">{order.number}</span>
                  </div>
                  <div style={{ justifySelf: 'end' }}>
                    <OrderRoute status={order.status} />
                  </div>
                </Link>
              ))}
            </div>
          </>
        )}

        {pager}
      </section>

      <SaveViewDialog ref={saveDialog} currentQuery={viewQuery} suggestedName={suggestedName} notify={notify} />
      {selectedIds.length > 0 ? (
        <BulkBar orderIds={selectedIds} onClear={() => setSelected(new Set())} onDone={notify} />
      ) : null}
      {toast ? <Toast key={toast.key} message={toast.message} /> : null}
    </>
  );
}
