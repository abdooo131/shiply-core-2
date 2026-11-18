import { expect, test, type Page } from '@playwright/test';

const OWNER_EMAIL = process.env.SEED_OWNER_EMAIL ?? '';
const OWNER_PASSWORD = process.env.SEED_OWNER_PASSWORD ?? '';
const PHONE_WIDTH = 375;

async function signIn(page: Page, locale: 'en' | 'ar' = 'en') {
  await page.goto(`/${locale}/login`);
  await page.getByTestId('identifier').fill(OWNER_EMAIL);
  await page.getByTestId('password').fill(OWNER_PASSWORD);
  await page.getByTestId('sign-in').click();
  await expect(page).toHaveURL(new RegExp(`/${locale}$`));
}

// Creates a cash-on-delivery order in Nasr City through the Create order screen; returns its number.
async function createOrder(page: Page, customerName: string): Promise<string> {
  await page.goto('/en/orders/new');
  await page.getByLabel('Phone number').fill('01001234567');
  await page.getByLabel('Full name', { exact: true }).fill(customerName);
  await page.getByLabel('Street address', { exact: true }).fill('12 Abbas El Akkad St, building 4');
  await page.getByRole('combobox', { name: 'Area' }).fill('nasr');
  await page.getByRole('option', { name: /Nasr City/ }).first().click();
  await page.getByLabel('Cash to collect').fill('1500');
  await expect(page.getByTestId('total-fee')).not.toHaveText('—');
  await page.getByTestId('create-order').click();
  const heading = page.getByRole('heading', { name: /Order \d{10} created/ });
  await expect(heading).toBeVisible();
  const number = (await heading.textContent())?.match(/\d{10}/)?.[0];
  expect(number).toBeTruthy();
  return number ?? '';
}

// Each run uses its own customer names, so tests sharing the dev database never see each other's orders.
function runTag(): string {
  return String(Date.now());
}

test.beforeEach(() => {
  expect(OWNER_EMAIL, 'SEED_OWNER_EMAIL must be set in .env').not.toBe('');
});

test('tabs show counts and search finds an order by Arabic name, in English and Arabic', async ({ page }) => {
  const tag = runTag();
  await signIn(page);
  const number = await createOrder(page, `منى ${tag}`);

  await page.goto('/en/orders');
  for (const tab of ['all', 'needs_action', 'new', 'in_progress', 'out_for_delivery', 'coming_back', 'delivered', 'returned', 'canceled', 'not_printed']) {
    await expect(page.getByTestId(`tab-${tab}`).locator('.count')).toHaveText(/^\d+$/);
  }

  await page.getByTestId('orders-search').fill(`منى ${tag}`);
  await expect(page).toHaveURL(/[?&]q=/);
  await expect(page.getByTestId('order-row')).toHaveCount(1);
  await expect(page.getByTestId('order-row')).toContainText(number);
  await expect(page.getByTestId('tab-new').locator('.count')).toHaveText('1');
  await expect(page.getByTestId('tab-delivered').locator('.count')).toHaveText('0');

  await page.goto(`/ar/orders?q=${encodeURIComponent(`منى ${tag}`)}`);
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByTestId('tab-all')).toContainText('الكل');
  await expect(page.getByTestId('order-row')).toHaveCount(1);
  await expect(page.getByTestId('order-row')).toContainText('جديد');
});

test('a filter pill narrows the list, shows in the URL, and Clear all removes it', async ({ page }) => {
  const tag = runTag();
  await signIn(page);
  await createOrder(page, `Filter test ${tag}`);

  await page.goto(`/en/orders?q=${tag}`);
  await expect(page.getByTestId('order-row')).toHaveCount(1);

  await page.getByTestId('filter-gov').click();
  await page.getByRole('searchbox', { name: 'Search Governorate' }).fill('cai');
  await page.getByRole('checkbox', { name: 'Cairo' }).check();
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page).toHaveURL(/[?&]gov=C(&|$)/);
  await expect(page.getByTestId('filter-gov')).toContainText('Governorate: Cairo');
  await expect(page.getByTestId('order-row')).toHaveCount(1);

  await page.getByTestId('filter-pay').click();
  await page.getByRole('option', { name: 'Prepaid' }).click();
  await expect(page).toHaveURL(/[?&]pay=prepaid/);
  await expect(page.getByText('No orders match')).toBeVisible();

  await page.getByTestId('clear-all').click();
  await expect(page).not.toHaveURL(/pay=|gov=|q=/);
  await expect(page.getByTestId('filter-summary')).toHaveCount(0);
});

test('saves the current view and applies it again from the Views menu', async ({ page }) => {
  const tag = runTag();
  const viewName = `Tried three ${tag}`.slice(0, 40);
  await signIn(page);

  await page.goto('/en/orders?tries=3&sort=cash');
  await page.getByTestId('views-button').click();
  await page.getByTestId('save-current-view').click();
  await page.getByTestId('view-name').fill(viewName);
  await page.getByTestId('save-view').click();
  await expect(page.getByRole('status').filter({ hasText: `View “${viewName}” saved` })).toBeVisible();

  await page.goto('/en/orders');
  await page.getByTestId('views-button').click();
  await page.getByRole('button', { name: viewName, exact: true }).click();
  await expect(page).toHaveURL(/tries=3/);
  await expect(page).toHaveURL(/sort=cash/);
  await expect(page.getByTestId('filter-tries')).toContainText('Tries: 3 tries');

  await page.getByTestId('views-button').click();
  await page.getByRole('button', { name: `Delete view ${viewName}` }).click();
  await expect(page.getByRole('status').filter({ hasText: `View “${viewName}” deleted` })).toBeVisible();
});

test('two selected orders open the label page with both labels', async ({ page }) => {
  const tag = runTag();
  await signIn(page);
  await createOrder(page, `Label one ${tag}`);
  await createOrder(page, `Label two ${tag}`);

  await page.goto(`/en/orders?q=${tag}`);
  const rows = page.getByTestId('order-row');
  await expect(rows).toHaveCount(2);
  await rows.nth(0).getByRole('checkbox').check();
  await rows.nth(1).getByRole('checkbox').check();
  await expect(page.getByTestId('bulk-bar')).toContainText('2 selected');
  await expect(page.getByTestId('orders-export')).toHaveAttribute('href', /\/api\/orders\/export\?ids=[^,]+,[^,]+$/);

  await page.getByTestId('bulk-print').click();
  await page.getByTestId('print-a4').click();
  await expect(page).toHaveURL(/\/en\/orders\/labels\?ids=[^&]+&format=a4/);
  await expect(page.getByTestId('awb-label')).toHaveCount(2);
});

test('bulk cancel cancels what it can and reports the rest', async ({ page }) => {
  const tag = runTag();
  await signIn(page);
  await createOrder(page, `Cancel one ${tag}`);
  await createOrder(page, `Cancel two ${tag}`);

  await page.goto(`/en/orders?q=${encodeURIComponent(`Cancel one ${tag}`)}`);
  await page.getByTestId('order-row').getByRole('checkbox').check();
  await page.getByTestId('bulk-cancel').click();
  await page.getByTestId('confirm-cancel').click();
  await expect(page.getByRole('status').filter({ hasText: '1 order canceled' })).toBeVisible();
  await expect(page.getByTestId('order-row')).toContainText('Canceled');

  await page.goto(`/en/orders?q=${tag}`);
  await expect(page.getByTestId('order-row')).toHaveCount(2);
  await page.getByRole('checkbox', { name: 'Select all on this page' }).check();
  await page.getByTestId('bulk-cancel').click();
  await page.getByTestId('confirm-cancel').click();
  await expect(page.getByRole('status').filter({ hasText: '1 canceled, 1 could not be canceled' })).toBeVisible();
  await expect(page.getByTestId('tab-canceled').locator('.count')).toHaveText('2');
});

test('the CSV export downloads for a signed-in merchant only', async ({ page, request }) => {
  const anonymous = await request.get('/api/orders/export');
  expect(anonymous.status()).toBe(401);

  const tag = runTag();
  await signIn(page);
  await createOrder(page, `Export ${tag}`);
  await page.goto(`/en/orders?q=${tag}`);
  await page.getByTestId('order-row').getByRole('checkbox').check();
  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('orders-export').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('shiply-orders.csv');
});

test('phone width shows order cards without sideways scrolling, in Arabic', async ({ page }) => {
  const tag = runTag();
  await signIn(page);
  await createOrder(page, `منى هاتف ${tag}`);

  await page.setViewportSize({ width: PHONE_WIDTH, height: 812 });
  await page.goto(`/ar/orders?q=${tag}`);
  await expect(page.getByTestId('order-card')).toHaveCount(1);
  await expect(page.getByTestId('order-card')).toContainText(`منى هاتف ${tag}`);
  await expect(page.locator('.tbl-wrap.orders')).toBeHidden();
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth).toBeLessThanOrEqual(PHONE_WIDTH);
});
