/**
 * For the browser tests (apps/web/e2e): empties a TEST database, applies the
 * migrations and loads the demo data, so every run starts from the same state.
 *
 * It refuses to touch a database whose name does not end in "_test".
 *   DATABASE_URL=postgresql://lms:lms@localhost:5432/lms_test node dist/db/reset-test-db.js
 */
import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');
const dbName = new URL(url).pathname.replace(/^\//, '');
if (!dbName.endsWith('_test')) {
  throw new Error(
    `Refusing to wipe "${dbName}": only databases whose name ends in _test can be reset.`,
  );
}

const pool = new pg.Pool({ connectionString: url });
await pool.query(
  'drop schema if exists drizzle cascade; drop schema if exists public cascade; create schema public;',
);
await migrate(drizzle(pool), { migrationsFolder: './drizzle' });
await pool.end();
console.log(`Reset ${dbName}.`);

// The seed script runs when imported.
await import('./seed.js');
