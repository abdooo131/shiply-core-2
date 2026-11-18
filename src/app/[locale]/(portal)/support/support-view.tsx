import type { SupportTicketStatus } from '@prisma/client';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { Link } from '@/i18n/navigation';
import { SUPPORT_PAGE_SIZE, type TicketListResult } from '@/support/tickets';
import { Icon } from '@/ui/icon';
import { Pill, type PillTone } from '@/ui/pill';
import { NewTicketButton } from './ticket-actions';

export type SupportTab = 'open' | 'closed';
type Translate = Awaited<ReturnType<typeof getTranslations<'support'>>>;

const STATUS_TONES: Record<SupportTicketStatus, PillTone> = { open: 'warn', answered: 'info', closed: 'ok' };
const PAGE_PATTERN = /^\d{1,6}$/;

export function firstValue(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? '';
}

export function toSupportTab(value: string): SupportTab {
  return value === 'closed' ? 'closed' : 'open';
}

export function toPage(value: string): number {
  return PAGE_PATTERN.test(value) ? Math.max(1, Number(value)) : 1;
}

function listQuery(tab: SupportTab, page: number): Record<string, string> {
  return { ...(tab === 'open' ? {} : { status: tab }), ...(page === 1 ? {} : { page: String(page) }) };
}

export function SupportHead({ t }: { t: Translate }) {
  return (
    <div className="page-head">
      <div className="grow">
        <h1>{t('title')}</h1>
        <span className="muted">{t('subtitle')}</span>
      </div>
      <div className="row">
        <NewTicketButton withIcon testId="new-ticket-open" />
      </div>
    </div>
  );
}

function Pager({ t, tab, list }: { t: Translate; tab: SupportTab; list: TicketListResult }) {
  const from = (list.page - 1) * SUPPORT_PAGE_SIZE + 1;
  const to = Math.min(list.total, list.page * SUPPORT_PAGE_SIZE);
  const hrefFor = (target: number) => ({ pathname: '/support', query: listQuery(tab, target) });
  return (
    <nav className="pager" aria-label={t('pages')}>
      <span className="grow" style={{ textAlign: 'start' }}><bdi className="num">{t('range', { from, to, total: list.total })}</bdi></span>
      {list.page > 1 ? (
        <Link className="btn sm" href={hrefFor(list.page - 1)} scroll={false}>{t('prev')}</Link>
      ) : (
        <button type="button" className="btn sm" disabled>{t('prev')}</button>
      )}
      <span className="small" aria-label={t('pageNumber', { page: list.page })}><bdi className="num">{list.page} / {list.pageCount}</bdi></span>
      {list.page < list.pageCount ? (
        <Link className="btn sm" href={hrefFor(list.page + 1)} scroll={false}>{t('next')}</Link>
      ) : (
        <button type="button" className="btn sm" disabled>{t('next')}</button>
      )}
    </nav>
  );
}

function TicketList({ t, tab, list, selectedNumber }: { t: Translate; tab: SupportTab; list: TicketListResult; selectedNumber: string | null }) {
  if (list.rows.length === 0) {
    return (
      <div className="empty" data-testid="support-empty">
        <h3>{tab === 'open' ? t('emptyOpenTitle') : t('emptyClosedTitle')}</h3>
        <p>{tab === 'open' ? t('emptyOpenText') : t('emptyClosedText')}</p>
        {tab === 'open' ? <NewTicketButton testId="new-ticket-empty" /> : null}
      </div>
    );
  }
  return (
    <>
      <ul className="sp-items" data-testid="support-list">
        {list.rows.map((row) => {
          const isSelected = row.number === selectedNumber;
          return (
            <li key={row.id}>
              <Link
                href={{ pathname: `/support/${row.number}`, query: listQuery(tab, list.page) }}
                className={isSelected ? 'tick-item on' : 'tick-item'}
                aria-current={isSelected ? 'page' : undefined}
                data-testid="support-ticket"
              >
                <b>{row.subject}</b>
                <span className="row small muted sp-meta">
                  <span className="mono" style={{ flex: 1 }}>{row.number}</span>
                  <Pill tone={STATUS_TONES[row.status]}>{t(`statuses.${row.status}`)}</Pill>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      {list.pageCount > 1 ? <Pager t={t} tab={tab} list={list} /> : null}
    </>
  );
}

// The mockup's tickets view: the list on the start side, the conversation beside it.
// On a phone only one shows: the list on /support, the conversation on a ticket's page.
export function SupportSplit({
  t,
  tab,
  list,
  selectedNumber,
  children,
}: {
  t: Translate;
  tab: SupportTab;
  list: TicketListResult;
  selectedNumber: string | null;
  children: ReactNode;
}) {
  return (
    <>
      <nav className={selectedNumber ? 'tabs sp-tabs has-thread' : 'tabs sp-tabs'} aria-label={t('tabsLabel')}>
        {(['open', 'closed'] as const).map((candidate) => (
          <Link
            key={candidate}
            href={candidate === 'open' ? '/support' : { pathname: '/support', query: { status: candidate } }}
            className={candidate === tab ? 'tab on' : 'tab'}
            aria-current={candidate === tab ? 'page' : undefined}
            data-testid={`support-tab-${candidate}`}
          >
            {t(`tabs.${candidate}`)}
          </Link>
        ))}
      </nav>
      <div className={selectedNumber ? 'split sp-split has-thread' : 'split sp-split'}>
        <section className="card sp-list" style={{ overflow: 'hidden' }}>
          <TicketList t={t} tab={tab} list={list} selectedNumber={selectedNumber} />
        </section>
        {children}
      </div>
    </>
  );
}

export function PickTicket({ t }: { t: Translate }) {
  return (
    <section className="card sp-pick">
      <div className="empty">
        <span className="sp-pick-ic"><Icon name="help" size={24} /></span>
        <h3>{t('pickTicketTitle')}</h3>
        <p>{t('pickTicketText')}</p>
      </div>
    </section>
  );
}
