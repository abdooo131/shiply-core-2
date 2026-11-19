import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { requireUser } from '@/accounts';
import { Link } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';
import { formatCairo } from '@/shared/cairo-time';
import { canUseSection, listStaffTickets } from '@/staff/staff-queues';
import { firstValue, StaffPager, toPage } from '../staff-pager';

const TABS = ['open', 'answered', 'closed'] as const;

export default async function StaffSupportPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const query = await searchParams;
  setRequestLocale(locale);
  const safeLocale = routing.locales.find((known) => known === locale) ?? routing.defaultLocale;
  const user = await requireUser(safeLocale);
  if (!canUseSection(user, 'support')) notFound();
  const t = await getTranslations('staff.support');
  const tSupport = await getTranslations('support');
  const tab = TABS.find((candidate) => candidate === firstValue(query.status)) ?? 'open';
  const list = await listStaffTickets(user, { status: tab, page: toPage(firstValue(query.page)) });

  return (
    <>
      <div className="page-head">
        <div className="grow">
          <h1>{t('title')}</h1>
          <span className="muted">{t('subtitle')}</span>
        </div>
      </div>
      <section className="card">
        <nav className="tabs" aria-label={t('title')} style={{ padding: '0 16px' }}>
          {TABS.map((candidate) => (
            <Link
              key={candidate}
              className={candidate === tab ? 'tab on' : 'tab'}
              href={{ pathname: '/staff/support', query: { status: candidate } }}
              aria-current={candidate === tab ? 'page' : undefined}
            >
              {t(`tabs.${candidate}`)}
            </Link>
          ))}
        </nav>
        {list.rows.length === 0 ? (
          <div className="empty">{t('empty')}</div>
        ) : (
          <div className="tbl-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('number')}</th>
                  <th>{t('merchant')}</th>
                  <th>{t('subject')}</th>
                  <th>{t('topic')}</th>
                  <th>{t('updated')}</th>
                </tr>
              </thead>
              <tbody>
                {list.rows.map((ticket) => (
                  <tr key={ticket.id} data-testid="staff-ticket">
                    <td><Link className="oid mono" href={`/staff/support/${ticket.id}`}>{ticket.number}</Link></td>
                    <td>{safeLocale === 'ar' ? ticket.merchantNameAr : ticket.merchantNameEn}</td>
                    <td><bdi>{ticket.subject}</bdi></td>
                    <td className="small">{tSupport(`topics.${ticket.topic}`)}</td>
                    <td className="small">{formatCairo(ticket.updatedAt, safeLocale, 'dateTime')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <StaffPager pathname="/staff/support" query={{ status: tab }} info={list} />
      </section>
    </>
  );
}
