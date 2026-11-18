import { expect, test, type Page } from '@playwright/test';

const OWNER_EMAIL = process.env.SEED_OWNER_EMAIL ?? '';
const OWNER_PASSWORD = process.env.SEED_OWNER_PASSWORD ?? '';
const SEEDED_NAME_AR = 'إيف شانتيل';
// A published example IBAN that passes the check-digit test.
const VALID_IBAN = 'EG380019000500000000263180002';

async function signIn(page: Page, identifier: string, password: string) {
  await page.goto('/ar/login');
  await page.getByTestId('identifier').fill(identifier);
  await page.getByTestId('password').fill(password);
  await page.getByTestId('sign-in').click();
  await expect(page).toHaveURL(/\/ar$/);
}

async function saveBusinessNameAr(page: Page, nameAr: string) {
  await page.goto('/ar/settings/business');
  await page.getByLabel('الاسم بالعربي').fill(nameAr);
  await page.getByRole('button', { name: 'حفظ التغييرات' }).click();
  await expect(page.getByRole('status')).toHaveText('تم الحفظ');
}

test('owner manages business, team and payouts in Arabic; a limited member is kept out', async ({ page }) => {
  const runId = Date.now();
  const memberEmail = `ops-${runId}@evechantelle.example`;

  await signIn(page, OWNER_EMAIL, OWNER_PASSWORD);

  // Business name round trip in Arabic, then put the seeded name back.
  await saveBusinessNameAr(page, `${SEEDED_NAME_AR} للأزياء`);
  await page.reload();
  await expect(page.getByLabel('الاسم بالعربي')).toHaveValue(`${SEEDED_NAME_AR} للأزياء`);
  await saveBusinessNameAr(page, SEEDED_NAME_AR);

  // Invite a member with orders & pickups access.
  await page.goto('/ar/settings/team');
  await page.getByLabel('الاسم', { exact: true }).fill('مسؤول التشغيل');
  await page.getByLabel('البريد الإلكتروني').fill(memberEmail);
  // Exact: rows of earlier members have their own "الصلاحية: <name>" selects.
  await page.getByLabel('الصلاحية', { exact: true }).selectOption('orders_pickups');
  await page.getByRole('button', { name: 'إنشاء الحساب' }).click();
  const oneTimePassword = (await page.getByTestId('one-time-password').textContent())?.trim() ?? '';
  expect(oneTimePassword.length).toBeGreaterThanOrEqual(12);
  await page.reload();
  await expect(page.getByRole('cell', { name: memberEmail })).toBeVisible();

  // Request a payout account change.
  await page.goto('/ar/settings/payouts');
  await page.getByLabel('اسم البنك').fill('البنك الأهلي المصري');
  await page.getByLabel('اسم صاحب الحساب').fill('Eve Chantelle LLC');
  await page.getByLabel('رقم الآيبان (IBAN)').fill(VALID_IBAN);
  await page.getByRole('button', { name: 'طلب تغيير' }).click();
  await expect(page.getByRole('status')).toHaveText('تم إرسال الطلب. فريق Shiply المالي هيراجعه.');
  await expect(page.getByText('EG•• •••• ••0002').first()).toBeVisible();
  await expect(page.getByText('في انتظار مراجعة Shiply').first()).toBeVisible();

  // The new member signs in and cannot see Team or Payouts.
  await page.getByTestId('sign-out').click();
  await signIn(page, memberEmail, oneTimePassword);
  await page.goto('/ar/settings');
  const tabs = page.getByRole('navigation', { name: 'الإعدادات' });
  await expect(tabs.getByRole('link', { name: 'التفضيلات' })).toBeVisible();
  await expect(tabs.getByRole('link', { name: 'الفريق' })).toHaveCount(0);
  await expect(tabs.getByRole('link', { name: 'التحويلات' })).toHaveCount(0);

  await page.goto('/ar/settings/payouts');
  await expect(page.getByRole('heading', { name: 'مش مسموح لك تدخل الصفحة دي' })).toBeVisible();
  await expect(page.getByLabel('رقم الآيبان (IBAN)')).toHaveCount(0);

  // Prices are for full access and finance only.
  await expect(tabs.getByRole('link', { name: 'الأسعار' })).toHaveCount(0);
  await page.goto('/ar/settings/pricing');
  await expect(page.getByRole('heading', { name: 'مش مسموح لك تدخل الصفحة دي' })).toBeVisible();
});
