'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';

export function LanguageSwitch() {
  const t = useTranslations('shell');
  const locale = useLocale();
  const pathname = usePathname();
  const otherLocale = locale === 'ar' ? 'en' : 'ar';

  return (
    <Link
      href={pathname}
      locale={otherLocale}
      className="icon-btn"
      aria-label={t('switchLanguage')}
      data-testid="language-switch"
      lang={otherLocale}
    >
      {t('languageButton')}
    </Link>
  );
}
