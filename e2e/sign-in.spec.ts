import { expect, test, type Page } from '@playwright/test';

const OWNER_EMAIL = process.env.SEED_OWNER_EMAIL ?? '';
const OWNER_PASSWORD = process.env.SEED_OWNER_PASSWORD ?? '';

const SIDEBAR_EN = [
  'Home', 'Orders', 'Pickups', 'Wallet', 'Packaging', 'Credits',
  'Products', 'Analytics', 'Applications', 'Capital', 'Support', 'Settings',
];

async function signInAsOwner(page: Page, locale: 'en' | 'ar' = 'en') {
  await page.goto(`/${locale}/login`);
  await page.getByTestId('identifier').fill(OWNER_EMAIL);
  await page.getByTestId('password').fill(OWNER_PASSWORD);
  await page.getByTestId('sign-in').click();
  await expect(page).toHaveURL(new RegExp(`/${locale}$`));
}

test.beforeEach(() => {
  expect(OWNER_EMAIL, 'SEED_OWNER_EMAIL must be set in .env').not.toBe('');
});

test('owner signs in and sees the portal shell', async ({ page }) => {
  await signInAsOwner(page);
  const sidebar = page.getByRole('complementary', { name: 'Main navigation' });
  for (const label of SIDEBAR_EN) {
    await expect(sidebar.getByRole('link', { name: label, exact: true })).toBeVisible();
  }
  await expect(sidebar.getByText('Insurance active')).toBeVisible();
});

test('language button switches to Arabic, right to left', async ({ page }) => {
  await signInAsOwner(page);
  await page.getByTestId('language-switch').click();
  await expect(page).toHaveURL(/\/ar$/);
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  const sidebar = page.getByRole('complementary');
  await expect(sidebar.getByRole('link', { name: 'الرئيسية', exact: true })).toBeVisible();
  await expect(sidebar.getByRole('link', { name: 'الطلبات', exact: true })).toBeVisible();
});

test('wrong password shows a translated error in both languages', async ({ page }) => {
  for (const [locale, message] of [
    ['en', 'The email, mobile number or password is not correct.'],
    ['ar', 'البريد الإلكتروني أو رقم الموبايل أو كلمة المرور غير صحيحة.'],
  ] as const) {
    await page.goto(`/${locale}/login`);
    await page.getByTestId('identifier').fill(OWNER_EMAIL);
    await page.getByTestId('password').fill('definitely-wrong');
    await page.getByTestId('sign-in').click();
    // Next.js adds its own empty route announcer with role="alert"; target ours.
    await expect(page.locator('form').getByRole('alert')).toHaveText(message);
  }
});

test('signing out returns to the sign-in page and protects the portal', async ({ page }) => {
  await signInAsOwner(page);
  await page.getByTestId('sign-out').click();
  await expect(page).toHaveURL(/\/en\/login$/);
  await page.goto('/en');
  await expect(page).toHaveURL(/\/en\/login$/);
});

test('unbuilt sections show the coming-soon page', async ({ page }) => {
  await signInAsOwner(page);
  await page.getByRole('complementary').getByRole('link', { name: 'Wallet', exact: true }).click();
  await expect(page).toHaveURL(/\/en\/wallet$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Wallet');
  await expect(page.getByText('Coming in a later step')).toBeVisible();
});

test('no sideways scrolling on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await signInAsOwner(page);
  for (const locale of ['en', 'ar']) {
    await page.goto(`/${locale}`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await expect(page.getByRole('navigation', { name: /Main navigation|التنقل الرئيسي/ })).toBeVisible();
  }
});
