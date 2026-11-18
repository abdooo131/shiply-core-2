import { getTranslations } from 'next-intl/server';
import { Icon, type IconName } from '../icon';

export async function ComingSoon({ title, icon }: { title: string; icon: IconName }) {
  const t = await getTranslations('shell');
  return (
    <>
      <h1>{title}</h1>
      <section className="card soon">
        <span className="ic">
          <Icon name={icon} size={26} />
        </span>
        <h2>{t('comingSoonTitle')}</h2>
        <p className="muted" style={{ margin: 0, maxWidth: 420 }}>
          {t('comingSoonText')}
        </p>
      </section>
    </>
  );
}
