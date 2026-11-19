import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { requireUser } from '@/accounts';
import { Link } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';
import { AppError } from '@/shared/app-error';
import { formatCairo } from '@/shared/cairo-time';
import { canUseSection, getStaffTicket } from '@/staff/staff-queues';
import { StaffReplyForm } from './staff-reply-form';

async function loadTicket(user: Awaited<ReturnType<typeof requireUser>>, ticketId: string) {
  try {
    return await getStaffTicket(user, ticketId);
  } catch (error) {
    if (error instanceof AppError && error.code === 'not_found') notFound();
    throw error;
  }
}

export default async function StaffTicketPage({ params }: { params: Promise<{ locale: string; ticketId: string }> }) {
  const { locale, ticketId } = await params;
  setRequestLocale(locale);
  const safeLocale = routing.locales.find((known) => known === locale) ?? routing.defaultLocale;
  const user = await requireUser(safeLocale);
  if (!canUseSection(user, 'support')) notFound();
  const t = await getTranslations('staff.support');
  const tSupport = await getTranslations('support');
  const ticket = await loadTicket(user, ticketId);

  return (
    <>
      <div className="page-head">
        <div className="grow">
          <Link className="small" href="/staff/support">{t('back')}</Link>
          <h1><span className="mono">{ticket.number}</span> · <bdi>{ticket.subject}</bdi></h1>
          <span className="muted">
            {safeLocale === 'ar' ? ticket.merchantNameAr : ticket.merchantNameEn} · {tSupport(`topics.${ticket.topic}`)}
            {ticket.orderNumber ? <> · {t('order')} <bdi className="mono">{ticket.orderNumber}</bdi></> : null}
          </span>
        </div>
      </div>
      <section className="card card-b grid" style={{ gap: 16 }}>
        <div className="staff-thread">
          {ticket.messages.map((message) => (
            <article key={message.id} className={message.authorKind === 'staff' ? 'staff-msg from-staff' : 'staff-msg'} data-testid="staff-thread-message">
              <div className="small muted">
                <b>{message.authorKind === 'staff' ? t('fromShiply') : t('fromMerchant')}</b> · {formatCairo(message.createdAt, safeLocale, 'dateTime')}
              </div>
              <p style={{ margin: '6px 0 0', whiteSpace: 'pre-wrap' }}><bdi>{message.body}</bdi></p>
            </article>
          ))}
        </div>
        {ticket.status === 'closed' ? <p className="muted">{t('closedNote')}</p> : <StaffReplyForm ticketId={ticket.id} />}
      </section>
    </>
  );
}
