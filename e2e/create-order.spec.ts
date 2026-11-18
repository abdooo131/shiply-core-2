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

async function fillCustomer(page: Page, labels: { mobile: string; name: string; address: string; area: string }, areaQuery: string, areaOption: RegExp) {
  await page.getByLabel(labels.mobile).fill('01001234567');
  await page.getByLabel(labels.name, { exact: true }).fill('منى علي');
  await page.getByLabel(labels.address, { exact: true }).fill('١٢ شارع عباس العقاد، عمارة ٤');
  await page.getByRole('combobox', { name: labels.area }).fill(areaQuery);
  await page.getByRole('option', { name: areaOption }).first().click();
}

const EN = { mobile: 'Phone number', name: 'Full name', address: 'Street address', area: 'Area' };
const AR = { mobile: 'رقم الموبايل', name: 'الاسم بالكامل', address: 'العنوان', area: 'المنطقة' };

test('creates a delivery in English with the live fee summary and prints its label', async ({ page }) => {
  await signIn(page, 'en');
  await page.goto('/en/orders/new');
  await fillCustomer(page, EN, 'nasr', /Nasr City/);
  await page.getByLabel('Cash to collect').fill('1500');

  const summary = page.getByTestId('fee-summary');
  await expect(summary).toContainText('EGP 68.00');
  await expect(summary).toContainText('EGP 9.52');
  await expect(page.getByTestId('total-fee')).toHaveText('EGP 77.52');
  await expect(summary).toContainText('EGP 1,422.48');

  await page.getByTestId('create-order').click();
  await expect(page.getByRole('heading', { name: /Order \d{10} created/ })).toBeVisible();

  const labelHref = await page.getByTestId('print-label').getAttribute('href');
  expect(labelHref).toMatch(/\/en\/orders\/labels\?ids=/);
  await page.goto(labelHref ?? '');
  await expect(page.locator('svg').first()).toBeVisible();
  await expect(page.getByText('منى علي')).toBeVisible();
});

test('finds the area by Arabic spelling and creates each order type in Arabic', async ({ page }) => {
  await signIn(page, 'ar');
  await page.goto('/ar/orders/new');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

  for (const type of ['deliver', 'exchange', 'return', 'sign_and_return', 'cash_collection', 'pick_and_choose'] as const) {
    await page.getByTestId(`type-${type}`).check();
    await fillCustomer(page, AR, 'مدينه نصر', /مدينة نصر/);
    if (type === 'cash_collection') await page.getByLabel('المبلغ المطلوب تحصيله').fill('٥٠٠');
    if (type === 'pick_and_choose') {
      const firstProduct = page.locator('.pick-grid .pick').first();
      await expect(firstProduct).toBeVisible();
      await firstProduct.click();
    }
    await expect(page.getByTestId('total-fee')).not.toHaveText('—');
    await page.getByTestId('create-another').click();
    await expect(page.getByRole('status').filter({ hasText: 'تم إنشاء الطلب' })).toBeVisible();
    await expect(page.getByLabel(AR.mobile)).toHaveValue('');
  }
});

test('offers a returning customer’s details by mobile', async ({ page }) => {
  await signIn(page, 'en');
  await page.goto('/en/orders/new');
  await page.getByLabel(EN.mobile).fill('+20 100 123 4567');
  await page.getByLabel(EN.name, { exact: true }).click();
  await expect(page.getByText(/Returning customer: منى علي/)).toBeVisible();
  await page.getByRole('button', { name: 'Use details' }).click();
  await expect(page.getByLabel(EN.name, { exact: true })).toHaveValue('منى علي');
});

test('shows a message next to each missing field', async ({ page }) => {
  await signIn(page, 'en');
  await page.goto('/en/orders/new');
  await page.getByTestId('create-order').click();
  await expect(page.getByText('Enter an 11-digit Egyptian mobile number.')).toBeVisible();
  await expect(page.getByText('Pick an area from the list.')).toBeVisible();
});
