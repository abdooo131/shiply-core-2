'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { THEME_STORAGE_KEY } from '@/ui/shell/theme-toggle';

export function ThemeOptions() {
  const t = useTranslations('settings');
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
  }, []);

  const choose = (next: 'light' | 'dark') => {
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Storage can be blocked; the choice still applies on this page.
    }
    setTheme(next);
  };

  return (
    <div className="g2" role="radiogroup" aria-label={t('theme')}>
      {(['light', 'dark'] as const).map((option) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={theme === option}
          className={theme === option ? 'opt on' : 'opt'}
          onClick={() => choose(option)}
        >
          <b>{option === 'light' ? t('themeLight') : t('themeDark')}</b>
        </button>
      ))}
    </div>
  );
}
