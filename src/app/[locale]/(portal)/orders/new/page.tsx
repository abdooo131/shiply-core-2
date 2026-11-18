import { getTranslations, setRequestLocale } from 'next-intl/server';
import { requireUser } from '@/accounts';
import { routing } from '@/i18n/routing';
import { listProducts } from '@/orders';
import { BulkUploadDialog } from './bulk-upload-dialog';
import { CreateOrderForm } from './create-order-form';

export default async function CreateOrderPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const safeLocale = routing.locales.find((known) => known === locale) ?? routing.defaultLocale;
  const user = await requireUser(safeLocale);
  const merchantId = user.memberships[0]?.merchantId;
  const t = await getTranslations('createOrder');
  const products = merchantId ? await listProducts(user, merchantId).catch(() => []) : [];

  return (
    <>
      <div className="page-head">
        <div className="grow"><h1>{t('title')}</h1></div>
        <BulkUploadDialog />
      </div>
      <CreateOrderForm products={products.map(({ id, nameEn, nameAr, pricePiasters }) => ({ id, nameEn, nameAr, pricePiasters }))} />
    </>
  );
}
