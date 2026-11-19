import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { requireUser } from '@/accounts';
import { routing } from '@/i18n/routing';
import { canUseSection, listScheduledPickups } from '@/staff/staff-queues';
import { formatCalendarDate } from '../../(portal)/wallet/wallet-formatting';
import { CollectPickup } from './collect-pickup';

export default async function StaffPickupsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const safeLocale = routing.locales.find((known) => known === locale) ?? routing.defaultLocale;
  const user = await requireUser(safeLocale);
  if (!canUseSection(user, 'pickups')) notFound();
  const t = await getTranslations('staff.pickups');
  const pickups = await listScheduledPickups(user);

  return (
    <>
      <div className="page-head">
        <div className="grow">
          <h1>{t('title')}</h1>
          <span className="muted">{t('subtitle')}</span>
        </div>
      </div>
      {pickups.length === 0 ? (
        <section className="card"><div className="empty">{t('empty')}</div></section>
      ) : (
        <div className="grid">
          {pickups.map((pickup) => (
            <section key={pickup.id} className="card" data-testid="staff-pickup">
              <div className="card-h">
                <div className="grow cell2">
                  <h2><span className="mono">{pickup.number}</span> · {safeLocale === 'ar' ? pickup.merchantNameAr : pickup.merchantNameEn}</h2>
                  <span className="small muted">
                    {t('date')}: <b>{formatCalendarDate(pickup.pickupDate, safeLocale, true)}</b> · {t('expected')}: <bdi className="num">{pickup.expectedCount}</bdi>
                  </span>
                </div>
              </div>
              <div className="card-b grid" style={{ gap: 12 }}>
                <div className="kv">
                  <div><span className="muted">{t('address')}</span><bdi>{pickup.addressText}</bdi></div>
                  <div><span className="muted">{t('contact')}</span><span><bdi>{pickup.contactName}</bdi> · <bdi className="num">{pickup.contactMobile}</bdi></span></div>
                </div>
                <CollectPickup pickupId={pickup.id} number={pickup.number} orders={pickup.orders} />
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
