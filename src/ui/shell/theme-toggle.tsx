'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Icon } from '../icon';

export const THEME_STORAGE_KEY = 'shiply-theme';

// Runs before first paint (inlined in the root layout) so the page never flashes the wrong theme.
export const THEME_INIT_SCRIPT = `try{var t=localStorage.getItem('${THEME_STORAGE_KEY}');if(t==='dark'||t==='light')document.documentElement.dataset.theme=t}catch(e){}`;

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
