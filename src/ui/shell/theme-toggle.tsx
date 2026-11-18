'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useLayoutEffect, useState } from 'react';
import { Icon } from '../icon';

export const THEME_STORAGE_KEY = 'shiply-theme';

// Runs before first paint (inlined in the root layout) so the page never flashes the wrong theme.
export const THEME_INIT_SCRIPT = `try{var t=localStorage.getItem('${THEME_STORAGE_KEY}');if(t==='dark'||t==='light')document.documentElement.dataset.theme=t}catch(e){}`;

function readStoredTheme(): 'light' | 'dark' | null {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return stored === 'light' || stored === 'dark' ? stored : null;
  } catch {
    return null;
  }
}

// Switching language re-renders <html> without a full page load, which drops the
// data-theme attribute set by THEME_INIT_SCRIPT. Re-apply it before paint on each switch.
export function ThemeSync() {
  const locale = useLocale();
  useLayoutEffect(() => {
    const stored = readStoredTheme();
    if (stored) document.documentElement.dataset.theme = stored;
  }, [locale]);
  return null;
}

function currentTheme(): 'light' | 'dark' {
  const chosen = document.documentElement.dataset.theme;
  if (chosen === 'dark' || chosen === 'light') return chosen;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function ThemeToggle() {
  const t = useTranslations('shell');
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  useEffect(() => setTheme(currentTheme()), []);

  const toggle = () => {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Storage can be blocked (private mode); the theme still applies for this page.
    }
    setTheme(next);
  };

  return (
    <button type="button" className="icon-btn" onClick={toggle} aria-label={theme === 'dark' ? t('lightMode') : t('darkMode')}>
      <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={20} />
    </button>
  );
}
