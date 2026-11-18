import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

// Tests always run against the separate test database, never the development one.
if (existsSync('.env')) process.loadEnvFile('.env');
const testDatabaseUrl = process.env.DATABASE_URL_TEST;
if (!testDatabaseUrl) throw new Error('DATABASE_URL_TEST is missing from .env');
process.env.DATABASE_URL = testDatabaseUrl;

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  // Components are written for React's automatic JSX runtime (no React import).
  esbuild: { jsx: 'automatic' },
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'prisma/**/*.test.ts'],
    globalSetup: ['./src/shared/test-global-setup.ts'],
    fileParallelism: false,
    testTimeout: 20000,
    env: { DATABASE_URL: testDatabaseUrl },
  },
});
