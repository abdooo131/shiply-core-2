import { getTranslations, setRequestLocale } from 'next-intl/server';
import { requireUser } from '@/accounts';
import { Link } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';
import { countStaffQueues, type StaffQueueCounts } from '@/staff/staff-queues';

const CARDS: { key: keyof StaffQueueCounts; href: string }[] = [
  { key: 'ordersOpen', href: '/staff/orders' },
  { key: 'pickupsScheduled', href: '/staff/pickups' },
  { key: 'bankPending', href: '/staff/approvals' },
  { key: 'priceListsPending', href: '/staff/approvals' },
  { key: 'cashOutsOpen', href: '/staff/money' },
  { key: 'ticketsOpen', href: '/staff/support' },
];

export default async function StaffOverviewPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const safeLocale = routing.locales.find((known) => known === locale) ?? routing.defaultLocale;
  const user = await requireUser(safeLocale);
  const t = await getTranslations('staff.overview');
  const counts = await countStaffQueues(user);

  return (
    <>
      <div className="page-head">
        <div className="grow">
          <h1>{t('title')}</h1>
          <span className="muted">{t('subtitle')}</span>
        </div>
      </div>
      <div className="staff-cards">
        {CARDS.filter((card) => counts[card.key] !== null).map((card) => (
          <Link key={card.key} className="card stat" href={card.href} data-testid={`staff-count-${card.key}`}>
            <span className="k">{t(card.key)}</span>
            <span className="v"><bdi className="num">{counts[card.key]}</bdi></span>
            <span className="foot">{t('open')}</span>
          </Link>
        ))}
      </div>
    </>
  );
}
