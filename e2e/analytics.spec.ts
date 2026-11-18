import { expect, test, type Page } from '@playwright/test';

const OWNER_EMAIL = process.env.SEED_OWNER_EMAIL ?? '';
const OWNER_PASSWORD = process.env.SEED_OWNER_PASSWORD ?? '';
const PHONE = { width: 375, height: 812 };

// Delivered and returned orders are not created from the UI, so the numbers themselves are covered by
// src/analytics/merchant-analytics.test.ts. Here: the screen, the period switch, empty states and layout.

test.beforeEach(() => {
  expect(OWNER_EMAIL, 'SEED_OWNER_EMAIL must be set in .env').not.toBe('');
});

async function signIn(page: Page, locale: 'en' | 'ar' = 'en') {
  await page.goto(`/${locale}/login`);
  await page.getByTestId('identifier').fill(OWNER_EMAIL);
  await page.getByTestId('password').fill(OWNER_PASSWORD);
  await page.getByTestId('sign-in').click();
  await expect(page).toHaveURL(new RegExp(`/${locale}$`));
}

async function hasSidewaysScroll(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
}

test('the owner sees analytics for 30 days and can switch to 7 days', async ({ page }) => {
  await signIn(page);
  await page.goto('/en/analytics');
  await expect(page.getByRole('heading', { name: 'Analytics', level: 1 })).toBeVisible();
  await expect(page.getByText('How your deliveries performed over the last 30 days')).toBeVisible();

  const periods = page.getByRole('navigation', { name: 'Period' });
  await expect(periods.getByRole('link')).toHaveText(['Last 7 days', 'Last 30 days', 'Last 90 days']);
  await expect(page.getByTestId('period-30')).toHaveAttribute('aria-current', 'page');

  await expect(page.getByTestId('kpi-completed')).toContainText('Completed orders');
  await expect(page.getByTestId('kpi-delivered')).toContainText('Delivered');
  await expect(page.getByTestId('kpi-not-delivered')).toContainText('Not delivered');
  await expect(page.getByTestId('kpi-cash')).toContainText('Cash collected');

  await page.getByTestId('period-7').click();
  await expect(page).toHaveURL(/\/en\/analytics\?days=7$/);
  await expect(page.getByTestId('period-7')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByText('How your deliveries performed over the last 7 days')).toBeVisible();
});

test('a period with no completed orders shows calm empty states', async ({ page }) => {
  await signIn(page);
  await page.goto('/en/analytics?days=7');
  // The seeded merchant normally has no delivered or returned orders; if it does, the cards show data instead.
  const completed = (await page.getByTestId('kpi-completed').locator('.v').innerText()).trim();
  test.skip(completed !== '0', 'the seeded merchant has completed orders in this period');

  await expect(page.getByTestId('analytics-success')).toContainText('Nothing completed yet');
  await expect(page.getByTestId('analytics-attempts')).toContainText('No deliveries yet');
  await expect(page.getByTestId('analytics-time')).toContainText('No deliveries yet');
  await expect(page.getByTestId('analytics-governorates')).toContainText('No completed orders yet');
  await expect(page.getByTestId('analytics-cash')).toContainText('No cash collected in this period');
  await expect(page.getByTestId('kpi-delivered')).toContainText('No completed orders yet');
  await expect(page.locator('main')).not.toContainText('NaN');
  await expect(page.getByTestId('open-wallet')).toHaveAttribute('href', '/en/wallet');
});

test('analytics reads right to left in Arabic', async ({ page }) => {
  await signIn(page, 'ar');
  await page.goto('/ar/analytics');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('heading', { name: 'التحليلات', level: 1 })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'الفترة' }).getByRole('link')).toHaveText(['آخر 7 أيام', 'آخر 30 يوم', 'آخر 90 يوم']);
  await expect(page.getByTestId('kpi-completed')).toContainText('الطلبات المكتملة');
  await page.getByTestId('period-90').click();
  await expect(page).toHaveURL(/\/ar\/analytics\?days=90$/);
  await expect(page.getByText('أداء الشحنات بتاعتك في آخر 90 يوم')).toBeVisible();
});

for (const locale of ['en', 'ar'] as const) {
  test(`no sideways scrolling on a phone (${locale})`, async ({ page }) => {
    await page.setViewportSize(PHONE);
    await signIn(page, locale);
    for (const days of [7, 30, 90]) {
      await page.goto(`/${locale}/analytics?days=${days}`);
      await expect(page.getByTestId('kpi-completed')).toBeVisible();
      expect(await hasSidewaysScroll(page)).toBe(false);
    }
  });
}
