import { expect, test, type Page } from '@playwright/test';

const OWNER_EMAIL = process.env.SEED_OWNER_EMAIL ?? '';
const OWNER_PASSWORD = process.env.SEED_OWNER_PASSWORD ?? '';
const UNKNOWN_CASH_OUT_ID = '00000000-0000-4000-8000-0000000000c0';
const NOT_FOUND = 404;

// The screens are checked here; delivered orders, closed cycles and paid cash-outs are not created from
// the UI yet, so their amounts are covered by the money unit tests (src/money/*.test.ts).

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

test('the owner sees the wallet balance, schedule, transactions and cash cycles in English', async ({ page }) => {
  await signIn(page);
  await page.goto('/en/wallet');
  await expect(page.getByRole('heading', { name: 'Wallet', level: 1 })).toBeVisible();

  const balanceCard = page.getByTestId('balance-card');
  await expect(balanceCard).toContainText(/Available balance|You owe Shiply/);
  await expect(page.getByTestId('balance-amount')).toContainText(/\d+\.\d{2}/);
  await expect(page.getByTestId('schedule-card')).toContainText('Cash-out schedule');
  await expect(page.getByTestId('next-cash-out')).toContainText('Next cash-out');
  await expect(page.getByTestId('transactions')).toContainText('Transactions');
  await expect(page.getByTestId('cash-outs')).toContainText('Cash-outs');

  await page.getByTestId('balance-breakdown').click();
  const breakdown = page.getByRole('dialog', { name: 'Balance breakdown' });
  await expect(breakdown).toContainText('Processing today');
  await expect(breakdown).toContainText('In the next cash-out');
  await page.keyboard.press('Escape');
  await expect(breakdown).toBeHidden();

  await page.getByTestId('how-cash-outs').click();
  const how = page.getByRole('dialog', { name: 'How cash-outs work' });
  await expect(how).toContainText('The cash cycle closes');
  await how.getByRole('button', { name: 'Got it' }).click();
  await expect(how).toBeHidden();

  await page.getByTestId('wallet-tab-cycles').click();
  await expect(page).toHaveURL(/\/en\/wallet\?tab=cycles$/);
  await expect(page.getByTestId('wallet-tab-cycles')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('cycles')).toContainText('Each cash cycle closes at 11:59 PM');
  // The seeded merchant may or may not have closed cycles, depending on which tests ran before.
  await expect(page.getByTestId('cycles')).toContainText(/No cash cycles yet|Cash collected/);
});

test('the wallet reads right to left in Arabic', async ({ page }) => {
  await signIn(page, 'ar');
  await page.goto('/ar/wallet');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('heading', { name: 'المحفظة', level: 1 })).toBeVisible();
  await expect(page.getByTestId('balance-card')).toContainText(/الرصيد المتاح|عليك لـ Shiply/);
  await expect(page.getByTestId('schedule-card')).toContainText('مواعيد التحويل');
  await page.getByTestId('wallet-tab-cycles').click();
  await expect(page.getByTestId('cycles')).toContainText('دورات التحصيل');
});

test('a proof of transfer that does not exist is not found', async ({ page }) => {
  await signIn(page);
  const unknown = await page.goto(`/en/wallet/proof/${UNKNOWN_CASH_OUT_ID}`);
  expect(unknown?.status()).toBe(NOT_FOUND);
  const malformed = await page.goto('/en/wallet/proof/not-an-id');
  expect(malformed?.status()).toBe(NOT_FOUND);
});
