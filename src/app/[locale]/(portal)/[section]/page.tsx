import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ALL_NAV, COMING_SOON_SECTIONS } from '@/ui/shell/nav-items';
import { ComingSoon } from '@/ui/shell/coming-soon';

// Menu items whose screens are built in later plans.
export default async function SectionPage({ params }: { params: Promise<{ locale: string; section: string }> }) {
  const { locale, section } = await params;
  setRequestLocale(locale);
  if (!COMING_SOON_SECTIONS.has(section)) notFound();

  const item = ALL_NAV.find((navItem) => navItem.href === `/${section}`);
  if (!item) notFound();
  const t = await getTranslations('shell');
  return <ComingSoon title={t(item.key)} icon={item.icon} />;
}
