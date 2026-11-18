import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Bulk order upload accepts files up to 5 MB (checked in the action); the default limit is 1 MB.
  experimental: { serverActions: { bodySizeLimit: '6mb' } },
};

export default withNextIntl(nextConfig);
