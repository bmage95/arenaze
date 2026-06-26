// Migration runner.
//   npm -w @arenaze/db run migrate           -> apply pending db/migrations/*.sql
//   npm -w @arenaze/db run migrate -- --fresh -> drop & recreate public schema, then apply all
//
// Each migration runs in its own transaction and is recorded in schema_migrations.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { ENV_PATH, MIGRATIONS_DIR, requireDatabaseUrl } from './env.js';

const databaseUrl = requireDatabaseUrl();
const fresh = process.argv.includes('--fresh');

function dbUserFrom(url: string): string {
  try {
    const u = new URL(url).username;
    return u ? decodeURIComponent(u) : 'arenaze';
  } catch {
    return 'arenaze';
  }
}

async function main(): Promise<void> {
  console.log(`[migrate] env: ${ENV_PATH}`);
  console.log(`[migrate] migrations dir: ${MIGRATIONS_DIR}`);
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    if (fresh) {
      const user = dbUserFrom(databaseUrl);
      console.log('[migrate] --fresh: DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ...');
      await client.query(
        `DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO "${user}";`,
      );
    }

    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         filename   text PRIMARY KEY,
         applied_at timestamptz NOT NULL DEFAULT now()
       )`,
    );

    const appliedRes = await client.query<{ filename: string }>(
      'SELECT filename FROM schema_migrations',
    );
    const applied = new Set(appliedRes.rows.map((r) => r.filename));

    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    if (files.length === 0) {
      console.warn('[migrate] no .sql files found in migrations dir.');
    }

    let appliedCount = 0;
    for (const file of files) {
      if (applied.has(file)) {
        console.log(`[migrate] skip    ${file} (already applied)`);
        continue;
      }
      const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
      console.log(`[migrate] apply   ${file} ...`);
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
        await client.query('COMMIT');
        appliedCount += 1;
        console.log(`[migrate] applied ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration failed: ${file}\n${(err as Error).message}`);
      }
    }

    console.log(
      `[migrate] done. ${appliedCount} migration(s) applied, ${files.length - appliedCount} already up to date.`,
    );
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('[migrate] ERROR:', err instanceof Error ? err.message : err);
  process.exit(1);
});
