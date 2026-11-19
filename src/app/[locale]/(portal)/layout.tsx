import { redirect } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import type { ReactNode } from 'react';
import { requireUser } from '@/accounts';
import { routing } from '@/i18n/routing';
import { db } from '@/shared/db';
import { isStaff } from '@/staff/staff-queues';
import { Sidebar } from '@/ui/shell/sidebar';
import { SupportChatButton } from '@/ui/shell/support-chat-button';
import { TabBar } from '@/ui/shell/tab-bar';
import { TopBar } from '@/ui/shell/top-bar';

const MERCHANT_NUMBER_LENGTH = 8;

export default async function PortalLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const safeLocale = routing.locales.find((known) => known === locale) ?? routing.defaultLocale;
  const user = await requireUser(safeLocale);
  // Shiply's own team without a merchant of their own work in the staff area.
  if (user.memberships.length === 0 && isStaff(user)) redirect(`/${safeLocale}/staff`);

  const merchantId = user.memberships[0]?.merchantId;
  const merchant = merchantId
    ? await db.merchant.findUnique({ where: { id: merchantId }, select: { id: true, nameEn: true, nameAr: true } })
    : null;
  const storeName = merchant ? (safeLocale === 'ar' ? merchant.nameAr : merchant.nameEn) : user.name;
  const merchantNumber = merchant ? merchant.id.slice(0, MERCHANT_NUMBER_LENGTH).toUpperCase() : '—';

  return (
    <>
      <div className="app">
        <Sidebar />
        <div className="main">
          <TopBar storeName={storeName} merchantNumber={merchantNumber} showStaffLink={isStaff(user)} />
          <main className="page">{children}</main>
        </div>
      </div>
      <TabBar />
      <SupportChatButton />
    </>
  );
}
