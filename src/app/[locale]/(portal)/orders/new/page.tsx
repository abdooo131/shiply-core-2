import { getTranslations, setRequestLocale } from 'next-intl/server';
import { requireUser } from '@/accounts';
import { routing } from '@/i18n/routing';
import { listProducts } from '@/orders';
import { BulkUploadDialog } from './bulk-upload-dialog';
import { CreateOrderForm } from './create-order-form';

// Only follow-up types can be opened from another order's page (?type=exchange&from=<number>).
const PREFILL_TYPES = ['exchange', 'return'] as const;
const ORDER_NUMBER_PATTERN = /^\d{10}$/;

function firstValue(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? '';
}

export default async function CreateOrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const query = await searchParams;
  const initialType = PREFILL_TYPES.find((type) => type === firstValue(query.type));
  const from = firstValue(query.from);
  const initialLinkedOrderNumber = initialType && ORDER_NUMBER_PATTERN.test(from) ? from : '';
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
      <CreateOrderForm
        products={products.map(({ id, nameEn, nameAr, pricePiasters }) => ({ id, nameEn, nameAr, pricePiasters }))}
        initialType={initialType}
        initialLinkedOrderNumber={initialLinkedOrderNumber}
      />
    </>
  );
}
