import 'dotenv/config';
import { execSync } from 'node:child_process';
import pg from 'pg';

/**
 * Starts every local end-to-end run on a clean test database, so one run's
 * pickups and messages never change the next run's results. It only ever
 * touches a database named exactly "d2c_test" (CI starts from an empty one).
 */
export default async function setup() {
  const url = process.env.DATABASE_URL ?? '';
  const name = new URL(url).pathname.replace(/^\//, '');
  if (name !== 'd2c_test') return;
  const client = new pg.Client({ connectionString: url.replace(/\?.*$/, '') });
  await client.connect();
  const { rows } = await client.query<{ tablename: string }>(
    "select tablename from pg_tables where schemaname = 'public' and tablename <> '_prisma_migrations'",
  );
  if (rows.length) await client.query(`TRUNCATE ${rows.map((r) => `"${r.tablename}"`).join(', ')} CASCADE`);
  await client.end();
  execSync('pnpm exec prisma db seed', { stdio: 'ignore', env: { ...process.env, SEED_DEMO_HISTORY: 'false' } });
}
