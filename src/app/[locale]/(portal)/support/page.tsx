import { getTranslations, setRequestLocale } from 'next-intl/server';
import { requireUser } from '@/accounts';
import { routing } from '@/i18n/routing';
import { listTickets } from '@/support/tickets';
import { firstValue, PickTicket, SupportHead, SupportSplit, toPage, toSupportTab } from './support-view';

export default async function SupportPage({
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
  const t = await getTranslations('support');
  const merchantId = user.memberships[0]?.merchantId;
  if (!merchantId) return <SupportHead t={t} />;

  const tab = toSupportTab(firstValue(query.status));
  const list = await listTickets(user, merchantId, { status: tab, page: toPage(firstValue(query.page)) });

  return (
    <>
      <SupportHead t={t} />
      <SupportSplit t={t} tab={tab} list={list} selectedNumber={null}>
        <PickTicket t={t} />
      </SupportSplit>
    </>
  );
}
