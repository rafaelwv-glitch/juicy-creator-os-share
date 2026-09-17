#!/usr/bin/env node
/**
 * Database migrator (node-postgres, `pg`) + local PGLite file fallback.
 *
 * - `DATABASE_URL` set → apply pending `migrations/*.sql` to that Postgres
 *   (Vercel/Neon build, or local docker-compose). Safe to re-run.
 * - No `DATABASE_URL` and not serverless → apply the same files to file-backed
 *   PGLite (`PGLITE_DATA_DIR` or `./data/pglite`). The app also migrates at
 *   startup; this lets `npm run db:migrate` succeed before `npm run dev`.
 * - Serverless preview without DATABASE_URL → skip (PGLite is in-memory and
 *   migrates itself in `src/lib/db.ts`).
 */
import { mkdir, readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { databaseUrl, isServerless, loadLocalEnv, pgliteDataDir } from "./local-env.mjs";

loadLocalEnv();

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

async function listMigrationFiles() {
  try {
    return (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();
  } catch {
    return [];
  }
}

async function migratePostgres(url) {
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({ connectionString: url, max: 1 });
  const client = await pool.connect();
  try {
    await client.query(
      "CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())",
    );
    const applied = new Set(
      (await client.query("SELECT name FROM _migrations")).rows.map((r) => r.name),
    );
    const files = await listMigrationFiles();
    if (!files.length) {
      console.log("[migrate] no migrations/ directory — nothing to do.");
      return;
    }

    let count = 0;
    for (const name of files) {
      if (applied.has(name)) continue;
      const text = await readFile(join(migrationsDir, name), "utf8");
      try {
        await client.query("BEGIN");
        await client.query(text);
        await client.query("INSERT INTO _migrations (name) VALUES ($1)", [name]);
        await client.query("COMMIT");
      } catch (err) {
        console.error(`[migrate] error applying ${name}`);
        try {
          await client.query("ROLLBACK");
        } catch {
          /* keep original */
        }
        throw err;
      }
      console.log(`[migrate] applied ${name}`);
      count += 1;
    }
    console.log(count ? `[migrate] done — ${count} migration(s) applied.` : "[migrate] up to date.");
  } finally {
    client.release();
    await pool.end();
  }
}

async function migratePglite(dir) {
  await mkdir(dir, { recursive: true });
  const { PGlite } = await import("@electric-sql/pglite");
  const pg = new PGlite(dir);
  await pg.waitReady;
  await pg.exec(
    "create table if not exists _migrations (name text primary key, applied_at timestamptz not null default now())",
  );
  const doneRows = await pg.query("select name from _migrations");
  const applied = new Set(doneRows.rows.map((r) => r.name));
  const files = await listMigrationFiles();
  if (!files.length) {
    console.log("[migrate] no migrations/ directory — nothing to do.");
    await pg.close();
    return;
  }

  let count = 0;
  for (const name of files) {
    if (applied.has(name)) continue;
    const text = await readFile(join(migrationsDir, name), "utf8");
    await pg.transaction(async (tx) => {
      await tx.exec(text);
      await tx.query("insert into _migrations (name) values ($1)", [name]);
    });
    console.log(`[migrate] applied ${name} (pglite)`);
    count += 1;
  }
  console.log(
    count
      ? `[migrate] pglite done — ${count} migration(s) applied at ${dir}`
      : `[migrate] pglite up to date at ${dir}`,
  );
  await pg.close();
}

async function main() {
  const url = databaseUrl();
  if (url) {
    await migratePostgres(url);
    return;
  }
  if (isServerless()) {
    console.log(
      "[migrate] DATABASE_URL not set — skipping (the PGLite fallback migrates itself).",
    );
    return;
  }
  await migratePglite(pgliteDataDir());
}

main().catch((err) => {
  console.error("[migrate] failed:", err?.message || err);
  for (const key of ["code", "detail", "hint", "position", "where"]) {
    if (err?.[key] != null) console.error(`[migrate]   ${key}: ${err[key]}`);
  }
  process.exit(1);
});
