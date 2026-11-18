import { expect, test, type Page } from '@playwright/test';

const OWNER_EMAIL = process.env.SEED_OWNER_EMAIL ?? '';
const OWNER_PASSWORD = process.env.SEED_OWNER_PASSWORD ?? '';
const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

async function signInAsOwner(page: Page) {
  await page.goto('/en/login');
  await page.getByTestId('identifier').fill(OWNER_EMAIL);
  await page.getByTestId('password').fill(OWNER_PASSWORD);
  await page.getByTestId('sign-in').click();
  await expect(page).toHaveURL(/\/en$/);
}

test.beforeEach(() => {
  expect(OWNER_EMAIL, 'SEED_OWNER_EMAIL must be set in .env').not.toBe('');
});

test('template download needs a signed-in user and returns the spreadsheet', async ({ page }) => {
  const anonymous = await page.request.get('/api/orders/bulk-template?locale=en');
  expect(anonymous.status()).toBe(401);

  await signInAsOwner(page);
  for (const locale of ['en', 'ar']) {
    const response = await page.request.get(`/api/orders/bulk-template?locale=${locale}`);
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toBe(XLSX_CONTENT_TYPE);
    expect(response.headers()['content-disposition']).toContain(`attachment; filename="shiply-bulk-orders-${locale}.xlsx"`);
    // An .xlsx file is a zip archive, which starts with "PK".
    expect((await response.body()).subarray(0, 2).toString()).toBe('PK');
  }
});

test('uploading a CSV creates the good row and explains the bad one', async ({ page }) => {
  const runId = Date.now();
  // Unique text per run makes a new file, so the good row is created again on the shared database.
  const csv = [
    'type,customer_name,mobile,address,area,size,cod_egp',
    `deliver,Bulk Test ${runId},01001234567,12 Makram Ebeid St,Nasr City,small,250`,
    `teleport,Bulk Bad ${runId},01001234567,1 Nowhere St,Nasr City,small,100`,
  ].join('\n');

  await signInAsOwner(page);
  await page.goto('/en/orders/new');
  await page.getByTestId('bulk-open').click();
  const dialog = page.getByRole('dialog', { name: 'Bulk upload orders' });
  await expect(dialog.getByText('.xlsx or .csv · up to 500 orders per file')).toBeVisible();
  await expect(dialog.getByTestId('bulk-template-ar')).toHaveAttribute('href', '/api/orders/bulk-template?locale=ar');

  await dialog.getByTestId('bulk-file').setInputFiles({
    name: `orders-${runId}.csv`,
    mimeType: 'text/csv',
    buffer: Buffer.from(csv, 'utf8'),
  });
  await dialog.getByTestId('bulk-submit').click();

  await expect(dialog.getByTestId('bulk-created')).toHaveText('1 order created');
  const failedRows = dialog.getByTestId('bulk-failed').locator('tbody tr');
  await expect(failedRows).toHaveCount(1);
  await expect(failedRows.locator('td').first()).toHaveText('3');
  await expect(failedRows).toContainText('Unknown order type');
  await expect(dialog.getByTestId('bulk-print')).toHaveAttribute('href', /^\/en\/orders\/labels\?ids=[0-9a-f-]{36}$/);
});
