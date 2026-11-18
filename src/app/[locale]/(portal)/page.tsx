import { getTranslations, setRequestLocale } from 'next-intl/server';
import { requireUser } from '@/accounts';
import { routing } from '@/i18n/routing';
import { ComingSoon } from '@/ui/shell/coming-soon';

// The real Home (today's summary) is built in Plan 8.
export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const safeLocale = routing.locales.find((known) => known === locale) ?? routing.defaultLocale;
  const user = await requireUser(safeLocale);
  const t = await getTranslations('shell');
  return <ComingSoon title={t('welcome', { name: user.name })} icon="home" />;
}
