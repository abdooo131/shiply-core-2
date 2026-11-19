import { test } from '@playwright/test';

// Manual design check only: run with CAPTURE_DIR set to save screenshots.
const CAPTURE_DIR = process.env.CAPTURE_DIR;

test.skip(!CAPTURE_DIR, 'set CAPTURE_DIR to capture screenshots');

for (const [label, width, height] of [['laptop', 1440, 900], ['phone', 375, 812]] as const) {
  test(`capture portal on ${label}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto('/en/login');
    await page.getByTestId('identifier').fill(process.env.CAPTURE_AS_STAFF ? (process.env.SEED_STAFF_EMAIL ?? '') : (process.env.SEED_OWNER_EMAIL ?? ''));
    await page.getByTestId('password').fill(process.env.CAPTURE_AS_STAFF ? (process.env.SEED_STAFF_PASSWORD ?? '') : (process.env.SEED_OWNER_PASSWORD ?? ''));
    await page.getByTestId('sign-in').click();
    await page.waitForLoadState('networkidle');
    // CAPTURE_PATHS="staff,staff/orders" picks the screens; the default is the Create order screen.
    for (const path of (process.env.CAPTURE_PATHS ?? 'orders/new').split(',')) {
      for (const locale of ['en', 'ar']) {
        for (const theme of ['light', 'dark']) {
          await page.goto(`/${locale}/${path}`);
          await page.evaluate((chosen) => {
            document.documentElement.dataset.theme = chosen;
          }, theme);
          const name = path.replaceAll('/', '-');
          await page.screenshot({ path: `${CAPTURE_DIR}/${label}-${name}-${locale}-${theme}.png`, fullPage: true });
        }
      }
    }
  });
}
