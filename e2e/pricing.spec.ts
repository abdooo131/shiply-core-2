import { expect, test, type Page } from '@playwright/test';

const OWNER_EMAIL = process.env.SEED_OWNER_EMAIL ?? '';
const OWNER_PASSWORD = process.env.SEED_OWNER_PASSWORD ?? '';

async function signIn(page: Page, locale: 'en' | 'ar') {
  await page.goto(`/${locale}/login`);
  await page.getByTestId('identifier').fill(OWNER_EMAIL);
  await page.getByTestId('password').fill(OWNER_PASSWORD);
  await page.getByTestId('sign-in').click();
  await expect(page).toHaveURL(new RegExp(`/${locale}$`));
}

function cell(page: Page, size: string, column: string) {
  return page.getByTestId(`price-${size}-${column}`);
}

test('owner sees the sample prices by zone, with and without VAT', async ({ page }) => {
  await signIn(page, 'en');
  await page.goto('/en/settings/pricing');

  const zones = page.getByRole('group', { name: 'Pricing zone' }).getByRole('button');
  await expect(zones).toHaveText(['Cairo & Giza', 'Alexandria', 'Delta', 'Canal', 'Upper Egypt', 'Red Sea & Sinai']);
  await expect(zones.first()).toHaveAttribute('aria-pressed', 'true');

  await expect(cell(page, 'small', 'deliver')).toHaveText('68.00');
  await expect(cell(page, 'small', 'exchange')).toHaveText('80.00');
  await expect(cell(page, 'small', 'return')).toHaveText('64.00');
  await expect(cell(page, 'small', 'cash_collection')).toHaveText('55.00');

  await zones.filter({ hasText: 'Upper Egypt' }).click();
  await expect(cell(page, 'small', 'deliver')).toHaveText('94.00');

  await zones.filter({ hasText: 'Cairo & Giza' }).click();
  await page.getByLabel('Include VAT').check();
  await expect(cell(page, 'small', 'deliver')).toHaveText('77.52');

  await expect(page.getByText('Twice a week')).toBeVisible();
  await expect(page.getByText('collection fee')).toContainText('1%');
  await expect(page.getByText('Applies to cash above EGP 3,000 per order.')).toBeVisible();
  await expect(page.getByText('EGP 7.00 when customers may check the item first.')).toBeVisible();
});

test('the Pricing tab reads right to left in Arabic with the same prices', async ({ page }) => {
  await signIn(page, 'ar');
  await page.goto('/ar/settings/pricing');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('group', { name: 'منطقة التسعير' }).getByRole('button').first()).toHaveText('القاهرة والجيزة');
  await expect(cell(page, 'small', 'deliver')).toHaveText('68.00');
  await expect(page.getByLabel('شامل الضريبة')).toBeVisible();
});
