import { existsSync } from 'node:fs';
import { defineConfig } from '@playwright/test';

if (existsSync('.env')) process.loadEnvFile('.env');

export default defineConfig({
  testDir: './e2e',
  // Tests share the seeded owner account, so they run one at a time.
  workers: 1,
  use: {
    baseURL: 'http://localhost:3000',
    // The installed Google Chrome, so no browser download is needed.
    channel: 'chrome',
  },
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3000/en/login',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
