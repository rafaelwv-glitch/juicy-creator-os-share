#!/usr/bin/env node
/**
 * Import a Juicy Lounge warehouse or backup JSON into the local / configured DB.
 *
 *   npm run db:import-warehouse -- ~/Downloads/juicy-lounge-warehouse-YYYYMMDD-HHMM.json
 *   npm run db:import-warehouse -- ./path.json --user-id <better-auth-user-id>
 *
 * Idempotent upserts into lounge_user_kv (+ legacy lounge_kv) and first-class
 * lounge_* tables. Never writes cookies / vouchers unless --allow-credentials.
 *
 * DATABASE_URL → node-postgres. Otherwise file-backed PGLite (user-data pglite/).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { databaseUrl, loadLocalEnv, pgliteDataDir } from "./local-env.mjs";
import { resolveLoungeDataDir } from "./lounge-home.mjs";

loadLocalEnv();

const WAREHOUSE_FORMAT = "juicy-lounge-warehouse";
const BACKUP_FORMAT = "juicy-lounge-backup";
const CREDENTIAL_FILES = new Set(["juicy-session.json", "grok-hook.json"]);
const SECRET_KEY = /^(cookie|yume_voucher|voucher|authorization)$/i;

const WAREHOUSE_FILES = [
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
  "exposure-performance.json",
  "audit15-queue.json",
  "tag-competition.json",
  "pull-schedule.json",
  "new-feed.json",
];

const FILE_SET = new Set(WAREHOUSE_FILES);

function usage(code = 1) {
  console.error(`Usage: node scripts/import-warehouse.mjs <warehouse.json> [options]

Options:
  --user-id <id>         Better Auth / lounge_user_kv user id (default: sole auth user, else "local")
  --allow-credentials    Also import session / grok-hook if the file contains them (private only)
  --force                Overwrite richer rows already in the DB
  --dry-run              Validate and print counts; do not write
  --no-files             Do not mirror JSON under ./data/users/<id>/
  --help                 Show this help
`);
  process.exit(code);
}

function parseArgs(argv) {
  const args = { path: "", userId: "", allowCredentials: false, force: false, dryRun: false, writeFiles: true };
  const rest = argv.slice(2);
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (a === "--help" || a === "-h") usage(0);
    else if (a === "--user-id") args.userId = String(rest[++i] || "").trim();
    else if (a === "--allow-credentials") args.allowCredentials = true;
    else if (a === "--force") args.force = true;
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--no-files") args.writeFiles = false;
    else if (a.startsWith("-")) {
      console.error(`Unknown flag: ${a}`);
      usage(1);
    } else if (!args.path) args.path = a;
    else {
      console.error(`Unexpected argument: ${a}`);
      usage(1);
    }
  }
  if (!args.path) usage(1);
  return args;
}

function stripSecrets(value, depth = 0) {
  if (depth > 14 || value == null) return value;
  if (Array.isArray(value)) return value.map((v) => stripSecrets(v, depth + 1));
  if (typeof value !== "object") return value;
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (SECRET_KEY.test(k)) continue;
    out[k] = stripSecrets(v, depth + 1);
  }
  return out;
}

function filesFromLegacy(data) {
  const files = {};
  if (data.snapshot) files["last-snapshot.json"] = data.snapshot;
  if (data.history && Array.isArray(data.history.days)) files["growth-history.json"] = data.history;
  const notifications =
    data.notifications ??
    (Array.isArray(data.events)
      ? {
          version: 1,
          timezone: "Europe/Madrid",
          events: data.events,
          lastScrapedAt: null,
          lastApiTotal: null,
          pagesFetched: 0,
          lookbackDays: 30,
        }
      : null);
  if (notifications && Array.isArray(notifications.events)) {
    files["notification-events.json"] = {
      version: 1,
      timezone: notifications.timezone || "Europe/Madrid",
      events: notifications.events,
      lastScrapedAt: notifications.lastScrapedAt ?? null,
      lastApiTotal: notifications.lastApiTotal ?? null,
      pagesFetched: notifications.pagesFetched ?? 0,
      lookbackDays: notifications.lookbackDays ?? 30,
    };
  }
  if (data.insights) files["creator-insights.json"] = data.insights;
  if (data.followers) files["followers-history.json"] = data.followers;
  if (data.rivals) files["rivals-track.json"] = data.rivals;
  if (data.forensics?.bots) files["bot-forensics.json"] = data.forensics;
  if (data.economy && Array.isArray(data.economy.days)) files["creator-economy.json"] = data.economy;
  if (Array.isArray(data.publishJobs)) files["publish-jobs.json"] = data.publishJobs;
  return files;
}

function validateWarehouse(raw) {
  if (!raw || typeof raw !== "object") {
    throw new Error("Invalid warehouse: not an object");
  }
  const data = raw;
  const isWarehouse = data.format === WAREHOUSE_FORMAT;
  const looksLike =
    isWarehouse ||
    data.format === BACKUP_FORMAT ||
    data.snapshot != null ||
    data.history != null ||
    data.notifications != null ||
    (data.files && typeof data.files === "object") ||
    Array.isArray(data.events);
  if (!looksLike) {
    throw new Error(
      `Not a Juicy Lounge warehouse or backup file (expected format ${WAREHOUSE_FORMAT} or ${BACKUP_FORMAT})`,
    );
  }
  if (data.credentials === true) {
    throw new Error("Refusing file marked credentials:true — strip secrets or export a warehouse");
  }

  let files = {};
  if (data.files && typeof data.files === "object") {
    files = { ...data.files };
  } else {
    files = filesFromLegacy(data);
  }

  const cleaned = {};
  let skippedSecrets = 0;
  for (const [name, value] of Object.entries(files)) {
    if (value == null) continue;
    if (CREDENTIAL_FILES.has(name)) {
      skippedSecrets += 1;
      continue;
    }
    if (!FILE_SET.has(name)) continue;
    cleaned[name] = stripSecrets(value);
  }

  return { data, files: cleaned, skippedSecrets, isWarehouse };
}

function forensicStats(v) {
  if (!v || typeof v !== "object") return { bots: 0, days: 0 };
  const bots = v.bots ? Object.keys(v.bots).length : 0;
  let days = 0;
  for (const b of Object.values(v.bots || {})) days += b.days?.length || 0;
  return { bots, days };
}

function countManifest(files) {
  const snap = files["last-snapshot.json"];
  const hist = files["growth-history.json"];
  const notif = files["notification-events.json"];
  const fol = files["followers-history.json"];
  const rivals = files["rivals-track.json"];
  const forensic = forensicStats(files["bot-forensics.json"]);
  const newFeed = files["new-feed.json"];
  const jobs = files["publish-jobs.json"];
  return {
    keys: Object.keys(files).length,
    bots: Array.isArray(snap?.bots) ? snap.bots.length : 0,
    snapshotAt: snap?.scrapedAt ?? null,
    historyDays: Array.isArray(hist?.days) ? hist.days.length : 0,
    events: Array.isArray(notif?.events) ? notif.events.length : 0,
    followerPoints: Array.isArray(fol?.points) ? fol.points.length : 0,
    forensicBots: forensic.bots,
    forensicDayRows: forensic.days,
    rivalCount: Array.isArray(rivals?.rivals) ? rivals.rivals.length : 0,
    rivalAlumni: Array.isArray(rivals?.alumni) ? rivals.alumni.length : 0,
    newFeedBots: newFeed?.catalog ? Object.keys(newFeed.catalog).length : 0,
    newFeedDays: Array.isArray(newFeed?.days) ? newFeed.days.length : 0,
    publishJobs: Array.isArray(jobs) ? jobs.length : 0,
    hasInsights: Boolean(files["creator-insights.json"]),
    hasDashboard: Boolean(files["creator-dashboard.json"]),
  };
}

function resolveAccountUserId(data, files) {
  const snap = files["last-snapshot.json"];
  return (
    data.account?.userId ||
    snap?.profile?.userId ||
    snap?.userId ||
    data.session?.userId ||
    data.session?.loungeUserId ||
    null
  );
}

function poorer(key, incoming, existing) {
  if (existing == null) return false;
  if (key === "last-snapshot.json" || key === "creator-dashboard.json") {
    const inBots = incoming?.bots?.length ?? incoming?.snapshot?.bots?.length ?? 0;
    const exBots = existing?.bots?.length ?? existing?.snapshot?.bots?.length ?? 0;
    if (inBots === 0 && exBots > 0) return true;
    return false;
  }
  if (key === "growth-history.json") {
    const idays = Array.isArray(incoming?.days) ? incoming.days.length : 0;
    const edays = Array.isArray(existing?.days) ? existing.days.length : 0;
    return idays === 0 && edays > 0;
  }
  if (key === "notification-events.json") {
    const ie = Array.isArray(incoming?.events) ? incoming.events.length : 0;
    const ee = Array.isArray(existing?.events) ? existing.events.length : 0;
    return ie === 0 && ee > 0;
  }
  if (key === "followers-history.json") {
    const ip = Array.isArray(incoming?.points) ? incoming.points.length : 0;
    const ep = Array.isArray(existing?.points) ? existing.points.length : 0;
    if (ip === 0 && ep > 0) return true;
    if (ep >= 4 && ip < Math.ceil(ep * 0.5)) return true;
    return false;
  }
  return false;
}

function jsonParam(value) {
  return JSON.stringify(value);
}

async function openDb() {
  const url = databaseUrl();
  if (url) {
    const { default: pg } = await import("pg");
    const pool = new pg.Pool({ connectionString: url, max: 1 });
    return {
      kind: "postgres",
      query: async (text, params = []) => {
        const res = await pool.query(text, params);
        return res.rows;
      },
      close: () => pool.end(),
    };
  }
  const dir = pgliteDataDir();
  mkdirSync(dir, { recursive: true });
  const { PGlite } = await import("@electric-sql/pglite");
  const pg = new PGlite(dir);
  await pg.waitReady;
  return {
    kind: "pglite",
    query: async (text, params = []) => {
      const res = await pg.query(text, params);
      return res.rows;
    },
    close: () => pg.close(),
  };
}

async function ensureMigrations(db) {
  const rows = await db.query("select to_regclass('lounge_user_kv') as t");
  if (rows[0]?.t) return;
  console.log("[import] schema missing — running migrations first");
  const { spawnSync } = await import("node:child_process");
  const script = join(dirname(fileURLToPath(import.meta.url)), "migrate.mjs");
  const r = spawnSync(process.execPath, [script], { stdio: "inherit", env: process.env });
  if (r.status !== 0) throw new Error("migrations failed");
}

async function listAuthUserIds(db) {
  try {
    const rows = await db.query(`select id from "user" order by "createdAt"`);
    return rows.map((r) => r.id).filter(Boolean);
  } catch {
    return [];
  }
}

async function upsertKv(db, userId, key, value, force) {
  const existing = await db.query(
    "select value from lounge_user_kv where user_id = $1 and key = $2",
    [userId, key],
  );
  if (!force && existing[0]?.value && poorer(key, value, existing[0].value)) {
    return "skipped-poorer";
  }
  await db.query(
    `insert into lounge_user_kv (user_id, key, value, updated_at)
     values ($1, $2, $3::jsonb, now())
     on conflict (user_id, key) do update set value = excluded.value, updated_at = now()`,
    [userId, key, jsonParam(value)],
  );
  await db.query(
    `insert into lounge_kv (key, value, updated_at)
     values ($1, $2::jsonb, now())
     on conflict (key) do update set value = excluded.value, updated_at = now()`,
    [key, jsonParam(value)],
  );
  return "upserted";
}

async function projectRelational(db, userId, files) {
  const tz = files["growth-history.json"]?.timezone || "Europe/Madrid";
  const snap = files["last-snapshot.json"];
  const hist = files["growth-history.json"];
  const fol = files["followers-history.json"];
  const notif = files["notification-events.json"];

  await db.query(
    `insert into lounge_account (
       user_id, juicy_user_id, juicy_user_name, juicy_user_no, timezone, updated_at
     ) values ($1,$2,$3,$4,$5, now())
     on conflict (user_id) do update set
       juicy_user_id = coalesce(excluded.juicy_user_id, lounge_account.juicy_user_id),
       juicy_user_name = coalesce(excluded.juicy_user_name, lounge_account.juicy_user_name),
       juicy_user_no = coalesce(excluded.juicy_user_no, lounge_account.juicy_user_no),
       timezone = excluded.timezone,
       updated_at = now()`,
    [
      userId,
      snap?.userId || snap?.profile?.userId || null,
      snap?.profile?.userName || null,
      snap?.profile?.userNo || null,
      tz,
    ],
  );

  try {
    await db.query(
      `insert into lounge_settings (user_id, timezone, payload, updated_at)
       values ($1, $2, '{}'::jsonb, now())
       on conflict (user_id) do update set timezone = excluded.timezone, updated_at = now()`,
      [userId, tz],
    );
  } catch {
    /* 0006 not applied */
  }

  if (snap && Array.isArray(snap.bots)) {
    const t = snap.totals || {};
    await db.query(
      `insert into lounge_snapshot (
         user_id, scraped_at, juicy_user_id, authenticated,
         bots, chats, likes, favorites, followers, interactions, payload, updated_at
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb, now())
       on conflict (user_id) do update set
         scraped_at = excluded.scraped_at,
         juicy_user_id = excluded.juicy_user_id,
         authenticated = excluded.authenticated,
         bots = excluded.bots,
         chats = excluded.chats,
         likes = excluded.likes,
         favorites = excluded.favorites,
         followers = excluded.followers,
         interactions = excluded.interactions,
         payload = excluded.payload,
         updated_at = now()`,
      [
        userId,
        snap.scrapedAt || new Date().toISOString(),
        snap.userId || snap.profile?.userId || null,
        Boolean(snap.authenticated),
        t.bots ?? snap.bots.length,
        t.chats ?? 0,
        t.likes ?? 0,
        t.favorites ?? 0,
        t.followers ?? 0,
        t.interactions ?? 0,
        jsonParam(snap),
      ],
    );
  }

  if (hist && Array.isArray(hist.days)) {
    const last = hist.days[hist.days.length - 1];
    await db.query(
      `insert into lounge_history (
         user_id, timezone, days, latest_day, chats, likes, favorites, followers, payload, updated_at
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb, now())
       on conflict (user_id) do update set
         timezone = excluded.timezone,
         days = excluded.days,
         latest_day = coalesce(excluded.latest_day, lounge_history.latest_day),
         chats = excluded.chats,
         likes = excluded.likes,
         favorites = excluded.favorites,
         followers = excluded.followers,
         payload = excluded.payload,
         updated_at = now()`,
      [
        userId,
        hist.timezone || tz,
        hist.days.length,
        last?.date || null,
        last?.totals?.chats ?? 0,
        last?.totals?.likes ?? 0,
        last?.totals?.favorites ?? 0,
        last?.totals?.followers ?? 0,
        jsonParam(hist),
      ],
    );
    for (const d of hist.days) {
      if (!d?.date) continue;
      const t = d.totals || {};
      try {
        await db.query(
          `insert into lounge_history_day (
             user_id, day, scraped_at, chats, likes, favorites, followers, interactions, bots, payload, updated_at
           ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb, now())
           on conflict (user_id, day) do update set
             scraped_at = excluded.scraped_at,
             chats = excluded.chats,
             likes = excluded.likes,
             favorites = excluded.favorites,
             followers = excluded.followers,
             interactions = excluded.interactions,
             bots = excluded.bots,
             payload = excluded.payload,
             updated_at = now()`,
          [
            userId,
            d.date,
            d.scrapedAt || null,
            t.chats ?? 0,
            t.likes ?? 0,
            t.favorites ?? 0,
            t.followers ?? 0,
            t.interactions ?? 0,
            t.bots ?? 0,
            jsonParam(d),
          ],
        );
      } catch {
        break;
      }
    }
  }

  if (fol && Array.isArray(fol.points)) {
    const last = fol.last || fol.points[fol.points.length - 1];
    await db.query(
      `insert into lounge_followers (user_id, last_count, last_at, points, payload, updated_at)
       values ($1,$2,$3,$4,$5::jsonb, now())
       on conflict (user_id) do update set
         last_count = excluded.last_count,
         last_at = excluded.last_at,
         points = excluded.points,
         payload = excluded.payload,
         updated_at = now()`,
      [userId, last?.count ?? null, last?.scrapedAt || null, fol.points.length, jsonParam(fol)],
    );
    for (const p of fol.points) {
      if (!p?.date) continue;
      try {
        await db.query(
          `insert into lounge_follower_point (user_id, day, scraped_at, count, source)
           values ($1, $2, $3, $4, $5)
           on conflict (user_id, day) do update set
             scraped_at = excluded.scraped_at,
             count = excluded.count,
             source = excluded.source`,
          [userId, p.date, p.scrapedAt || new Date().toISOString(), Number(p.count) || 0, p.source || ""],
        );
      } catch {
        break;
      }
    }
  }

  if (notif && Array.isArray(notif.events)) {
    const lastTs = notif.events.reduce((m, e) => Math.max(m, Number(e.ts) || 0), 0);
    await db.query(
      `insert into lounge_notifications (user_id, event_count, last_scraped_at, last_ts, payload, updated_at)
       values ($1,$2,$3,$4,$5::jsonb, now())
       on conflict (user_id) do update set
         event_count = excluded.event_count,
         last_scraped_at = coalesce(excluded.last_scraped_at, lounge_notifications.last_scraped_at),
         last_ts = coalesce(excluded.last_ts, lounge_notifications.last_ts),
         payload = excluded.payload,
         updated_at = now()`,
      [
        userId,
        notif.events.length,
        notif.lastScrapedAt || null,
        lastTs ? new Date(lastTs).toISOString() : null,
        jsonParam(notif),
      ],
    );
  }

  const jobs = files["publish-jobs.json"];
  if (Array.isArray(jobs) && jobs.length) {
    for (const j of jobs) {
      if (!j?.id || !j.characterId) continue;
      await db.query(
        `insert into lounge_publish_jobs (
           id, character_id, character_name, fire_at_ms, status, result_message, user_id, created_at
         ) values ($1,$2,$3,$4,$5,$6,$7, now())
         on conflict (id) do update set
           character_id = excluded.character_id,
           character_name = excluded.character_name,
           fire_at_ms = excluded.fire_at_ms,
           status = excluded.status,
           result_message = excluded.result_message,
           user_id = excluded.user_id`,
        [
          String(j.id),
          String(j.characterId),
          String(j.characterName || j.characterId),
          Number(j.fireAtMs) || 0,
          j.status || "scheduled",
          j.resultMessage ?? null,
          userId,
        ],
      );
    }
  }
}

function writeUserFiles(userId, files) {
  const root = process.env.JUICY_DATA_DIR?.trim() || resolveLoungeDataDir();
  const safe = userId.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80) || "user";
  const dir = join(root, "users", safe);
  mkdirSync(dir, { recursive: true });
  let n = 0;
  for (const [name, value] of Object.entries(files)) {
    writeFileSync(join(dir, name), JSON.stringify(value), "utf8");
    n += 1;
  }
  return { dir, n };
}

async function main() {
  const args = parseArgs(process.argv);
  const abs = resolve(args.path);
  if (!existsSync(abs)) {
    throw new Error(`File not found: ${abs}`);
  }
  let raw;
  try {
    raw = JSON.parse(readFileSync(abs, "utf8"));
  } catch (e) {
    throw new Error(`Invalid JSON: ${e instanceof Error ? e.message : e}`);
  }

  const { data, files, skippedSecrets, isWarehouse } = validateWarehouse(raw);
  const counts = countManifest(files);
  if (!counts.keys) {
    throw new Error("Warehouse has no recognized analytics files");
  }

  console.log(`[import] file     ${abs}`);
  console.log(`[import] format   ${data.format || "(legacy)"} v${data.version || "?"}`);
  console.log(`[import] exported ${data.exportedAt || "unknown"} ${data.timezone || ""}`);
  console.log(
    `[import] payload  bots=${counts.bots} historyDays=${counts.historyDays} events=${counts.events} followerPoints=${counts.followerPoints} forensicBots=${counts.forensicBots} keys=${counts.keys}`,
  );
  if (skippedSecrets) {
    console.log(`[import] skipped ${skippedSecrets} credential file(s) (use --allow-credentials to keep them off this path)`);
  }
  if (!isWarehouse && data.session?.cookie && !args.allowCredentials) {
    console.log("[import] backup contains a session cookie — not imported (warehouse-safe default)");
  }

  if (args.dryRun) {
    console.log("[import] dry-run — no writes");
    console.log(`[import] result ${JSON.stringify({ ok: true, dryRun: true, counts })}`);
    return;
  }

  const db = await openDb();
  try {
    await ensureMigrations(db);
    const authIds = await listAuthUserIds(db);
    const juicyId = resolveAccountUserId(data, files);
    const userId =
      args.userId ||
      process.env.JUICY_IMPORT_USER_ID?.trim() ||
      (authIds.length === 1 ? authIds[0] : "") ||
      "local";

    if (!args.userId && authIds.length === 1) {
      console.log(`[import] using sole Better Auth user ${userId}`);
    } else if (!args.userId && authIds.length > 1) {
      console.log(
        `[import] ${authIds.length} auth users — defaulting to "${userId}". Re-run with --user-id <id> to target one.`,
      );
    } else if (!args.userId) {
      console.log(
        `[import] no Better Auth user yet — storing as user_id="${userId}". After sign-up, re-run with --user-id <id> or sign in (empty accounts copy shared lounge_kv).`,
      );
    }
    if (juicyId) console.log(`[import] warehouse JuicyChat user ${juicyId}`);
    console.log(`[import] backend ${db.kind}${db.kind === "pglite" ? ` ${pgliteDataDir()}` : ""}`);

    let upserted = 0;
    let skipped = 0;
    for (const [key, value] of Object.entries(files)) {
      const result = await upsertKv(db, userId, key, value, args.force);
      if (result === "upserted") upserted += 1;
      else skipped += 1;
    }
    await projectRelational(db, userId, files);

    let fileMirror = null;
    if (args.writeFiles) {
      fileMirror = writeUserFiles(userId, files);
    }

    const kv = await db.query("select count(*)::int as n from lounge_user_kv where user_id = $1", [userId]);
    const snapRow = await db.query("select bots, scraped_at from lounge_snapshot where user_id = $1", [userId]);
    const histRow = await db.query("select days from lounge_history where user_id = $1", [userId]);

    const summary = {
      ok: true,
      userId,
      backend: db.kind,
      upserted,
      skippedPoorer: skipped,
      dbKeys: Number(kv[0]?.n || 0),
      snapshotBots: Number(snapRow[0]?.bots || 0),
      historyDays: Number(histRow[0]?.days || 0),
      counts,
      filesDir: fileMirror?.dir || null,
    };
    console.log(
      `[import] done     user=${userId} upserted=${upserted} skipped=${skipped} dbKeys=${summary.dbKeys} snapshotBots=${summary.snapshotBots} historyDays=${summary.historyDays}`,
    );
    if (fileMirror) console.log(`[import] mirrored ${fileMirror.n} files → ${fileMirror.dir}`);
    console.log(`[import] result ${JSON.stringify(summary)}`);
  } finally {
    await db.close();
  }
}

main().catch((err) => {
  console.error("[import] failed:", err?.message || err);
  process.exit(1);
});
