import { getTranslations, setRequestLocale } from 'next-intl/server';
import { requireMerchantAccess, requireUser, type SessionUser } from '@/accounts';
import { routing } from '@/i18n/routing';
import { listProducts } from '@/orders';
import { Icon } from '@/ui/icon';
import { ProductsManager } from './products-manager';

function canManageProducts(user: SessionUser, merchantId: string | undefined): merchantId is string {
  if (!merchantId) return false;
  try {
    requireMerchantAccess(user, merchantId, 'orders');
    return true;
  } catch {
    return false;
  }
}

export default async function ProductsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const safeLocale = routing.locales.find((known) => known === locale) ?? routing.defaultLocale;
  const user = await requireUser(safeLocale);
  const merchantId = user.memberships[0]?.merchantId;
  const t = await getTranslations('products');

  if (!canManageProducts(user, merchantId)) {
    return (
      <>
        <h1>{t('title')}</h1>
        <section className="card soon">
          <span className="ic"><Icon name="shield" size={26} /></span>
          <h2>{t('noAccessTitle')}</h2>
          <p className="muted" style={{ margin: 0 }}>{t('noAccessText')}</p>
        </section>
      </>
    );
  }

  const products = await listProducts(user, merchantId, { includeInactive: true });
  return <ProductsManager products={products} />;
}
