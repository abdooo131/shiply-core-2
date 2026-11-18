import { expect, test, type Page } from '@playwright/test';

const OWNER_EMAIL = process.env.SEED_OWNER_EMAIL ?? '';
const OWNER_PASSWORD = process.env.SEED_OWNER_PASSWORD ?? '';

async function signInAsOwner(page: Page) {
  await page.goto('/ar/login');
  await page.getByTestId('identifier').fill(OWNER_EMAIL);
  await page.getByTestId('password').fill(OWNER_PASSWORD);
  await page.getByTestId('sign-in').click();
  await expect(page).toHaveURL(/\/ar$/);
}

async function openPickAndChoose(page: Page) {
  await page.goto('/ar/orders/new');
  await page.locator('label', { has: page.getByTestId('type-pick_and_choose') }).click();
  await expect(page.getByTestId('type-pick_and_choose')).toBeChecked();
}

test.beforeEach(() => {
  expect(OWNER_EMAIL, 'SEED_OWNER_EMAIL must be set in .env').not.toBe('');
});

test('owner adds, edits and hides a product in Arabic; a hidden product leaves Pick & Choose', async ({ page }) => {
  const runId = Date.now();
  const nameEn = `Linen shirt ${runId}`;
  const nameAr = `قميص كتان ${runId}`;

  await signInAsOwner(page);
  await page.goto('/ar/products');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('المنتجات');
  await expect(page.getByText('قريبًا في خطوة لاحقة')).toHaveCount(0);

  // Add, with the price typed in Arabic digits.
  await page.getByTestId('product-add').click();
  await page.getByTestId('product-name-en').fill(nameEn);
  await page.getByTestId('product-name-ar').fill(nameAr);
  await page.getByTestId('product-price').fill('٢٥٠');
  await page.getByTestId('product-save').click();
  await expect(page.getByRole('status')).toHaveText('تمت إضافة المنتج');
  const row = page.getByTestId('product-row').filter({ hasText: nameAr });
  await expect(row).toContainText(nameEn);
  await expect(row).toContainText('250.00 ج.م');
  await expect(row).toContainText('ظاهر');

  // Edit the price; the form opens with the saved values.
  await row.getByTestId('product-edit').click();
  await expect(page.getByTestId('product-name-ar')).toHaveValue(nameAr);
  await expect(page.getByTestId('product-price')).toHaveValue('250.00');
  await page.getByTestId('product-price').fill('175.50');
  await page.getByTestId('product-save').click();
  await expect(page.getByRole('status')).toHaveText('تم حفظ المنتج');
  await expect(row).toContainText('175.50 ج.م');

  // While active it is offered on Pick & Choose.
  await openPickAndChoose(page);
  await expect(page.getByRole('button', { name: nameAr })).toBeVisible();

  // Hide it.
  await page.goto('/ar/products');
  await row.getByTestId('product-toggle').click();
  await expect(row).toContainText('مخفي');
  await expect(row.getByTestId('product-toggle')).toHaveText('إظهار');

  await openPickAndChoose(page);
  await expect(page.getByText('اختار لحد 3 منتجات', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: nameAr })).toHaveCount(0);
});
