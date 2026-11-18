import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { requireUser } from '@/accounts';
import { Link } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';
import { AppError } from '@/shared/app-error';
import { formatCairo } from '@/shared/cairo-time';
import { getTicketByNumber, listTickets, type TicketThread } from '@/support/tickets';
import { Icon } from '@/ui/icon';
import { firstValue, SupportHead, SupportSplit, toPage, toSupportTab } from '../support-view';
import { CloseTicketButton, TicketReplyForm } from '../ticket-actions';

const TICKET_NUMBER_PATTERN = /^T\d{6}$/;

async function findTicket(...args: Parameters<typeof getTicketByNumber>): Promise<TicketThread | null> {
  try {
    return await getTicketByNumber(...args);
  } catch (error) {
    if (error instanceof AppError && error.code === 'not_found') return null;
    throw error;
  }
}

export default async function SupportTicketPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; number: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, number } = await params;
  const query = await searchParams;
  setRequestLocale(locale);
  const safeLocale = routing.locales.find((known) => known === locale) ?? routing.defaultLocale;
  const user = await requireUser(safeLocale);
  const t = await getTranslations('support');
  const merchantId = user.memberships[0]?.merchantId;
  if (!merchantId || !TICKET_NUMBER_PATTERN.test(number)) notFound();

  const ticket = await findTicket(user, merchantId, number);
  if (!ticket) notFound();
  const isClosed = ticket.status === 'closed';
  const statusText = firstValue(query.status);
  const tab = statusText ? toSupportTab(statusText) : isClosed ? 'closed' : 'open';
  const list = await listTickets(user, merchantId, { status: tab, page: toPage(firstValue(query.page)) });

  return (
    <>
      <SupportHead t={t} />
      <SupportSplit t={t} tab={tab} list={list} selectedNumber={ticket.number}>
        <section className="card sp-thread" style={{ overflow: 'hidden' }} data-testid="ticket-thread">
          <div className="card-h b">
            <Link className="icon-btn sp-back" href={tab === 'open' ? '/support' : { pathname: '/support', query: { status: tab } }}
              aria-label={t('allTickets')}>
              <Icon name="back" />
            </Link>
            <div className="grow cell2" style={{ minWidth: 0 }}>
              <h2 className="sp-subject">{ticket.subject}</h2>
              <span className="sp-sub">
                {t('openedOn', { number: ticket.number, date: formatCairo(ticket.createdAt, safeLocale, 'date') })}
                {' · '}{t(`topics.${ticket.topic}`)}
                {ticket.orderNumber ? (
                  <>
                    {' · '}
                    <Link href={`/orders/${ticket.orderNumber}`} className="linkish">{t('aboutOrder', { number: ticket.orderNumber })}</Link>
                  </>
                ) : null}
              </span>
            </div>
            <CloseTicketButton ticketId={ticket.id} isClosed={isClosed} />
          </div>
          <ol className="chat" data-testid="ticket-messages">
            {ticket.messages.map((message) => {
              const isMine = message.authorKind === 'merchant';
              return (
                <li key={message.id} className={isMine ? 'sp-msg me' : 'sp-msg'} data-testid={isMine ? 'message-merchant' : 'message-staff'}>
                  <div className={isMine ? 'msg me' : 'msg'} dir="auto">{message.body}</div>
                  <span className="sp-msg-meta">
                    {isMine ? t('you') : t('shiply')} · <bdi className="num">{formatCairo(message.createdAt, safeLocale, 'dateTime')}</bdi>
                  </span>
                </li>
              );
            })}
          </ol>
          {isClosed ? (
            <p className="sp-closed" data-testid="ticket-closed-note">{t('closedNote')}</p>
          ) : (
            <TicketReplyForm ticketId={ticket.id} />
          )}
        </section>
      </SupportSplit>
    </>
  );
}
