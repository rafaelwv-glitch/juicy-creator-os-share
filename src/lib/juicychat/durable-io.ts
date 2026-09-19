/**
 * Server-only lounge JSON files ↔ Postgres. Do not import from client components.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { getSql } from "@/lib/db";
import { dataPath, ensureDataDir } from "./paths";

export const LOUNGE_KV_FILES = [
  "juicy-session.json",
  "last-snapshot.json",
  "growth-history.json",
  "notification-events.json",
  "creator-insights.json",
  "followers-history.json",
  "creator-dashboard.json",
  "creator-ranklist.json",
  "bot-forensics.json",
  "creator-economy.json",
  "rivals-track.json",
  "publish-jobs.json",
  "grok-hook.json",
  "exposure-performance.json",
  "audit15-queue.json",
  "tag-competition.json",
  "pull-schedule.json",
  "timezone.json",
  "new-feed.json",
  "followed-bots.json",
] as const;

const FILE_SET = new Set<string>(LOUNGE_KV_FILES);

export async function pullDbToFiles(): Promise<void> {
  try {
    const sql = await getSql();
    const rows = await sql.query<{ key: string; value: unknown }>(
      "select key, value from lounge_kv",
    );
    ensureDataDir();
    for (const row of rows) {
      if (!FILE_SET.has(row.key)) continue;
      writeFileSync(dataPath(row.key), JSON.stringify(row.value), "utf8");
    }
  } catch (e) {
    console.warn("[lounge] hydrate from db failed", e);
  }
}

export async function pushFilesToDb(): Promise<void> {
  try {
    const sql = await getSql();
    const present = new Set<string>();
    try {
      for (const name of readdirSync(ensureDataDir())) {
        if (FILE_SET.has(name)) present.add(name);
      }
    } catch {
      /* */
    }
    for (const name of LOUNGE_KV_FILES) {
      const p = dataPath(name);
      if (!present.has(name) || !existsSync(p)) {
        // Missing in this isolate ≠ delete. Same bug as lounge_user_kv.
        continue;
      }
      let raw = "";
      try {
        raw = readFileSync(p, "utf8");
      } catch {
        continue;
      }
      let value: unknown;
      try {
        value = JSON.parse(raw);
      } catch {
        continue;
      }
      await sql.query(
        `insert into lounge_kv (key, value, updated_at)
         values ($1, $2::jsonb, now())
         on conflict (key) do update set value = excluded.value, updated_at = now()`,
        [name, JSON.stringify(value)],
      );
    }
  } catch (e) {
    console.warn("[lounge] persist to db failed", e);
  }
}

export async function withDurableStore<T>(fn: () => Promise<T>): Promise<T> {
  await pullDbToFiles();
  try {
    const result = await fn();
    await pushFilesToDb();
    return result;
  } catch (e) {
    try {
      await pushFilesToDb();
    } catch {
      /* */
    }
    throw e;
  }
}

export function deleteLoungeFile(name: string) {
  try {
    const p = dataPath(name);
    if (existsSync(p)) unlinkSync(p);
  } catch {
    /* */
  }
}
