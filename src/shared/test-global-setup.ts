import { execFileSync } from 'node:child_process';

// Bring the test database up to the latest schema once before the test run,
// then load reference data (governorates, zones, areas, default prices) with the seed.
export default function setup(): void {
  const env = { ...process.env, DATABASE_URL: process.env.DATABASE_URL };
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], { stdio: 'pipe', env });
  execFileSync('pnpm', ['db:seed'], { stdio: 'pipe', env });
}
