import { redirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getSessionUser, readSessionToken } from '@/accounts';
import { LanguageSwitch } from '@/ui/shell/language-switch';
import { ThemeToggle } from '@/ui/shell/theme-toggle';
import { LoginForm } from './login-form';

export default async function LoginPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const sessionToken = await readSessionToken();
  if (sessionToken && (await getSessionUser(sessionToken))) redirect(`/${locale}`);

  const t = await getTranslations('login');
  return (
    <main className="auth">
      <section className="auth-brand">
        <img src="/brand/shiply-logo-dark.png" alt="Shiply" width={99} height={36} />
        <p>{t('tagline')}</p>
      </section>
      <section className="auth-form">
        <div className="auth-tools">
          <LanguageSwitch />
          <ThemeToggle />
        </div>
        <LoginForm />
        <div className="spacer" />
      </section>
    </main>
  );
}
