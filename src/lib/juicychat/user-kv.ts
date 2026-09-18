import { getSql, dbSource, localPostgres, pglitePersistent } from "@/lib/db";
import { loungeHomeInfo } from "@/lib/lounge-home";
import { LOUNGE_KV_FILES } from "./durable-io";
import { loungeUserAls, userDataPath } from "./paths";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { openJson, sealJson } from "./secret-box";
import { pullUserBackupFromGitHub, pushUserBackupToGitHub } from "./github-kv";

const SESSION_KEY = "juicy-session.json";
const PURGE_EPOCH = 1;
const PURGE_MARK = "lounge-purge-epoch.json";

function onShareableVercel(): boolean {
  return (
    (process.env.VERCEL === "1" || process.env.VERCEL === "true") &&
    process.env.VITE_AUTH_ENABLED !== "true"
  );
}

/** Drop a live JuicyChat session that leaked onto the public shareable isolate. */
export async function purgeShareableLiveIfStale(userId: string): Promise<void> {
  if (!onShareableVercel() || !userId) return;
  const markPath = userDataPath(userId, PURGE_MARK);
  try {
    const cur = JSON.parse(readFileSync(markPath, "utf8")) as { epoch?: number };
    if (Number(cur.epoch) >= PURGE_EPOCH) return;
  } catch {
    /* first wipe */
  }
  const { loadSession } = await import("./session");
  const { isSampleSnapshot, seedSampleWarehouseIfEmpty } = await import("./dashboard");
  const session = loadSession();
  let snap: { userId?: string; profile?: { userId?: string; userName?: string } } | null = null;
  try {
    const p = userDataPath(userId, "last-snapshot.json");
    if (existsSync(p)) snap = JSON.parse(readFileSync(p, "utf8"));
  } catch {
    /* */
  }
  const live = sessionLooksValid(session) || Boolean(snap && !isSampleSnapshot(snap));
  if (live) {
    for (const name of LOUNGE_KV_FILES) {
      const p = userDataPath(userId, name);
      if (existsSync(p)) {
        try {
          unlinkSync(p);
        } catch {
          /* */
        }
      }
    }
    try {
      const sql = await getSql();
      await sql.query("delete from lounge_user_kv where user_id = $1", [userId]);
      await sql.query("delete from lounge_kv where key = any($1::text[])", [
        [...LOUNGE_KV_FILES],
      ]);
    } catch (e) {
      console.warn("[lounge] shareable kv wipe failed", e);
    }
    seedSampleWarehouseIfEmpty();
    console.warn("[lounge] purged live shareable session for", userId.slice(0, 8));
  }
  try {
    writeFileSync(markPath, JSON.stringify({ epoch: PURGE_EPOCH, at: new Date().toISOString() }));
  } catch {
    /* */
  }
}

export async function listLoungeUserIds(): Promise<string[]> {
  try {
    const sql = await getSql();
    const rows = await sql.query<{ user_id: string }>(
      "select distinct user_id from lounge_user_kv order by user_id",
    );
    return rows.map((r) => r.user_id).filter(Boolean);
  } catch (e) {
    console.warn("[lounge] list users failed", e);
    return [];
  }
}

/** Accounts that actually hold a JuicyChat cookie — skip empty pair clones. */
export async function listLoungeUserIdsWithSession(): Promise<string[]> {
  const ids = await listLoungeUserIds();
  const out: string[] = [];
  for (const id of ids) {
    try {
      const sql = await getSql();
      const rows = await sql.query<{ value: unknown }>(
        "select value from lounge_user_kv where user_id = $1 and key = $2",
        [id, SESSION_KEY],
      );
      if (sessionLooksValid(openJson(rows[0]?.value))) out.push(id);
    } catch {
      /* */
    }
  }
  return out;
}

function sessionLooksValid(v: unknown): boolean {
  if (!v || typeof v !== "object") return false;
  const cookie = (v as { cookie?: unknown }).cookie;
  return typeof cookie === "string" && cookie.length > 8;
}

function botCount(v: unknown): number {
  if (!v || typeof v !== "object") return 0;
  const o = v as { snapshot?: { bots?: unknown[] }; bots?: unknown[] };
  const n = o.snapshot?.bots?.length ?? o.bots?.length ?? 0;
  return typeof n === "number" ? n : 0;
}

function sampleish(v: unknown): boolean {
  if (!v || typeof v !== "object") return false;
  const o = v as {
    userId?: string;
    profile?: { userId?: string; userName?: string };
    snapshot?: { userId?: string; profile?: { userId?: string; userName?: string } };
  };
  const id = String(o.userId || o.profile?.userId || o.snapshot?.userId || o.snapshot?.profile?.userId || "");
  const name = String(o.profile?.userName || o.snapshot?.profile?.userName || "");
  return id === "sample-juicy-user" || id.toLowerCase().startsWith("sample-") || name === "SampleCreator";
}

/** True when `incoming` would destroy durable data already in Postgres. */
function isPoorer(key: string, incoming: unknown, existing: unknown): boolean {
  if (key === SESSION_KEY) {
    const inc = openJson(incoming) as { cookie?: string };
    const ex = openJson(existing) as { cookie?: string };
    return !(inc?.cookie && inc.cookie.length > 8) && Boolean(ex?.cookie && ex.cookie.length > 8);
  }
  if (key === "grok-hook.json") {
    const iu = String((incoming as { url?: string } | null)?.url || "");
    const eu = String((existing as { url?: string } | null)?.url || "");
    return !iu && Boolean(eu);
  }
  if (key === "creator-dashboard.json" || key === "last-snapshot.json") {
    if (sampleish(existing) && !sampleish(incoming)) return false;
    const inBots = botCount(incoming);
    const exBots = botCount(existing);
    if (inBots === 0 && exBots > 0 && !sampleish(existing)) return true;
    const inAt = Date.parse(String((incoming as { scrapedAt?: string })?.scrapedAt || (incoming as { snapshot?: { scrapedAt?: string } })?.snapshot?.scrapedAt || ""));
    const exAt = Date.parse(String((existing as { scrapedAt?: string })?.scrapedAt || (existing as { snapshot?: { scrapedAt?: string } })?.snapshot?.scrapedAt || ""));
    if (Number.isFinite(inAt) && Number.isFinite(exAt) && inAt + 5000 < exAt && inBots <= exBots) {
      return true;
    }
    return false;
  }
  if (key === "growth-history.json") {
    const idays = Array.isArray((incoming as { days?: unknown[] })?.days)
      ? (incoming as { days: unknown[] }).days.length
      : 0;
    const edays = Array.isArray((existing as { days?: unknown[] })?.days)
      ? (existing as { days: unknown[] }).days.length
      : 0;
    return idays === 0 && edays > 0;
  }
  if (key === "notification-events.json") {
    const ie = uniqueCount((incoming as { events?: Array<{ messageId?: string }> })?.events, (e) => e?.messageId);
    const ee = uniqueCount((existing as { events?: Array<{ messageId?: string }> })?.events, (e) => e?.messageId);
    return ie === 0 && ee > 0;
  }
  if (key === "followers-history.json") {
    const ip = Array.isArray((incoming as { points?: unknown[] })?.points)
      ? (incoming as { points: unknown[] }).points.length
      : 0;
    const ep = Array.isArray((existing as { points?: unknown[] })?.points)
      ? (existing as { points: unknown[] }).points.length
      : 0;
    if (ip === 0 && ep > 0) return true;
    // A 2-day isolate must not wipe a month of levels.
    if (ep >= 4 && ip < Math.ceil(ep * 0.5)) return true;
    return false;
  }
  if (key === "bot-forensics.json") {
    const countDays = (v: unknown) => {
      if (!v || typeof v !== "object") return 0;
      const bots = (v as { bots?: Record<string, { days?: unknown[] }> }).bots || {};
      let n = 0;
      for (const b of Object.values(bots)) n += Array.isArray(b?.days) ? b.days.length : 0;
      return n;
    };
    const countFans = (v: unknown) => {
      if (!v || typeof v !== "object") return 0;
      const bots = (v as { bots?: Record<string, { fans?: Record<string, unknown> }> }).bots || {};
      let n = 0;
      for (const b of Object.values(bots)) n += b?.fans ? Object.keys(b.fans).length : 0;
      return n;
    };
    const inD = countDays(incoming);
    const exD = countDays(existing);
    if (inD === 0 && exD > 0) return true;
    if (inD < exD) return true;
    const inF = countFans(incoming);
    const exF = countFans(existing);
    if (inF === 0 && exF > 0 && inD <= exD) return true;
    return false;
  }
  if (key === "creator-economy.json") {
    const idays = Array.isArray((incoming as { days?: unknown[] })?.days)
      ? (incoming as { days: unknown[] }).days.length
      : 0;
    const edays = Array.isArray((existing as { days?: unknown[] })?.days)
      ? (existing as { days: unknown[] }).days.length
      : 0;
    return idays === 0 && edays > 0;
  }
  if (key === "exposure-performance.json" || key === "audit15-queue.json") {
    const idays = Array.isArray((incoming as { days?: unknown[] })?.days)
      ? (incoming as { days: unknown[] }).days.length
      : 0;
    const edays = Array.isArray((existing as { days?: unknown[] })?.days)
      ? (existing as { days: unknown[] }).days.length
      : 0;
    if (idays === 0 && edays > 0) return true;
    if (edays >= 4 && idays < Math.ceil(edays * 0.5)) return true;
    return false;
  }
  if (key === "tag-competition.json") {
    const count = (v: unknown) => {
      if (!v || typeof v !== "object") return 0;
      const tags = Array.isArray(v)
        ? v
        : Array.isArray((v as { tags?: unknown[] }).tags)
          ? (v as { tags: unknown[] }).tags
          : [];
      return tags.length;
    };
    const inN = count(incoming);
    const exN = count(existing);
    return inN === 0 && exN > 0;
  }
  if (key === "rivals-track.json") {
    const signal = (v: unknown) => {
      if (!v || typeof v !== "object") return 0;
      const f = v as {
        rivals?: Array<{ mrtLog?: unknown[]; history?: unknown[]; mrt?: unknown }>;
        alumni?: Array<{ mrtLog?: unknown[]; history?: unknown[]; mrt?: unknown }>;
      };
      let n = 0;
      for (const r of [...(f.rivals || []), ...(f.alumni || [])]) {
        n += 1;
        n += Array.isArray(r.mrtLog) ? r.mrtLog.length : 0;
        n += Array.isArray(r.history) ? r.history.length : 0;
        if (r.mrt) n += 2;
      }
      return n;
    };
    const ir = signal(incoming);
    const er = signal(existing);
    if (ir === 0 && er > 0) return true;
    if (er >= 8 && ir < Math.ceil(er * 0.5)) return true;
    return false;
  }
  if (key === "new-feed.json") {
    const size = (v: unknown) => {
      if (!v || typeof v !== "object") return 0;
      const f = v as { catalog?: Record<string, unknown>; days?: unknown[] };
      return Object.keys(f.catalog || {}).length + (Array.isArray(f.days) ? f.days.length : 0);
    };
    const incomingSize = size(incoming);
    const existingSize = size(existing);
    if (incomingSize === 0 && existingSize > 0) return true;
    if (existingSize >= 8 && incomingSize < Math.ceil(existingSize * 0.5)) return true;
    return false;
  }
  return false;
}

function uniqueCount<T>(arr: T[] | undefined, key: (t: T) => string | undefined): number {
  if (!Array.isArray(arr) || !arr.length) return 0;
  const s = new Set<string>();
  for (const item of arr) {
    const k = key(item);
    if (k) s.add(k);
  }
  return s.size;
}

function writeKvFile(userId: string, key: string, value: unknown): boolean {
  if (!(LOUNGE_KV_FILES as readonly string[]).includes(key)) return false;
  let next = value;
  if (key === SESSION_KEY) {
    next = openJson(value);
    if (!sessionLooksValid(next)) return false;
  }
  writeFileSync(userDataPath(userId, key), JSON.stringify(next), "utf8");
  return true;
}

async function hydrateFromRows(
  userId: string,
  rows: Array<{ key: string; value: unknown }>,
): Promise<number> {
  let n = 0;
  for (const row of rows) {
    if (writeKvFile(userId, row.key, row.value)) n += 1;
  }
  return n;
}

async function copyLegacySharedKv(userId: string): Promise<number> {
  try {
    const sql = await getSql();
    const rows = await sql.query<{ key: string; value: unknown }>(
      "select key, value from lounge_kv",
    );
    if (!rows.length) return 0;
    for (const row of rows) {
      if (!(LOUNGE_KV_FILES as readonly string[]).includes(row.key)) continue;
      await sql.query(
        `insert into lounge_user_kv (user_id, key, value, updated_at)
         values ($1, $2, $3::jsonb, now())
         on conflict (user_id, key) do nothing`,
        [userId, row.key, JSON.stringify(row.value)],
      );
    }
    console.warn("[lounge] copied", rows.length, "legacy lounge_kv rows into", userId.slice(0, 8));
    return rows.length;
  } catch (e) {
    console.warn("[lounge] legacy lounge_kv copy failed", e);
    return 0;
  }
}

async function adoptRichestOtherUser(userId: string): Promise<number> {
  try {
    const sql = await getSql();
    const others = await sql.query<{ user_id: string; n: number }>(
      `select user_id, count(*)::int as n from lounge_user_kv
       where user_id <> $1 group by user_id order by n desc limit 1`,
      [userId],
    );
    const donor = others[0];
    if (!donor?.user_id || donor.n < 1) return 0;
    const copied = await sql.query<{ key: string }>(
      `insert into lounge_user_kv (user_id, key, value, updated_at)
       select $1, key, value, now() from lounge_user_kv where user_id = $2
       on conflict (user_id, key) do nothing
       returning key`,
      [userId, donor.user_id],
    );
    console.warn(
      "[lounge] adopted",
      copied.length,
      "keys from",
      donor.user_id.slice(0, 8),
      "→",
      userId.slice(0, 8),
    );
    return copied.length;
  } catch (e) {
    console.warn("[lounge] adopt other user failed", e);
    return 0;
  }
}

export async function kvKeyCount(userId: string): Promise<number> {
  if (!userId) return 0;
  try {
    const sql = await getSql();
    const rows = await sql.query<{ n: number }>(
      "select count(*)::int as n from lounge_user_kv where user_id = $1",
      [userId],
    );
    return Number(rows[0]?.n || 0);
  } catch {
    return 0;
  }
}

export async function pickUserWithData(ids: string[]): Promise<string | null> {
  const uniq = [...new Set(ids.filter(Boolean))];
  if (!uniq.length) return null;
  let best = uniq[0];
  let bestN = -1;
  for (const id of uniq) {
    const n = await kvKeyCount(id);
    if (n > bestN) {
      best = id;
      bestN = n;
    }
  }
  return best;
}

export async function persistHealth(userId: string | null) {
  const { inventory } = await import("./relational");
  const inv = await inventory(userId);
  let vault = false;
  try {
    const { loadSession } = await import("./session");
    const { loadGrokHook } = await import("./grok-hook");
    vault = Boolean(loadSession()?.cookie || loadGrokHook().url);
  } catch {
    /* */
  }
  const home = loungeHomeInfo();
  return {
    db: inv.source,
    ok: inv.ok,
    latencyMs: inv.latencyMs,
    error: inv.error,
    userId: userId ? userId.slice(0, 8) : null,
    keys: inv.kvKeys,
    durable: (inv.source === "neon" && inv.ok) || (pglitePersistent && inv.ok),
    local: localPostgres || pglitePersistent,
    browserScoped: Boolean(userId?.startsWith("browser-")),
    vault,
    hasSession: inv.hasSession || vault,
    webhook: inv.webhook,
    webhookLastOk: inv.webhookLastOk,
    webhookLastAt: inv.webhookLastAt,
    snapshotAt: inv.snapshotAt,
    bots: inv.bots,
    growthDays: inv.growthDays,
    followerDays: inv.followerDays,
    notifications: inv.notifications,
    scheduledJobs: inv.scheduledJobs,
    schema: inv.schema,
    schemaSolid: inv.schemaSolid,
    timezone: inv.timezone,
    lastPullAt: inv.lastPullAt,
    lastPullOk: inv.lastPullOk,
    lastPullMessage: inv.lastPullMessage,
    lastPullKind: inv.lastPullKind,
    lastOkPullAt: inv.lastOkPullAt,
    lastOkPullMessage: inv.lastOkPullMessage,
    dataDir: home.serverless ? null : home.lounge,
    pgliteDir: home.pglite,
    clientHome: home.serverless ? null : home.home,
  };
}

export async function pullUserKv(userId: string): Promise<boolean> {
  if (!userId) return false;
  let found = 0;
  try {
    const sql = await getSql();
    const rows = await sql.query<{ key: string; value: unknown }>(
      "select key, value from lounge_user_kv where user_id = $1",
      [userId],
    );
    found = await hydrateFromRows(userId, rows);
    console.warn("[lounge] pull", userId.slice(0, 8), "rows", rows.length, "files", found, "db", dbSource);
  } catch (e) {
    console.warn("[lounge] pull user kv failed", e);
  }

  if (found < 3) {
    if (!onShareableVercel() && !userId.startsWith("browser-")) {
      await copyLegacySharedKv(userId);
      try {
        const sql = await getSql();
        const rows = await sql.query<{ key: string; value: unknown }>(
          "select key, value from lounge_user_kv where user_id = $1",
          [userId],
        );
        found = await hydrateFromRows(userId, rows);
      } catch (e) {
        console.warn("[lounge] rehydrate after recover failed", e);
      }
    }
  }

  if (found < 2) {
    if (!onShareableVercel() && !userId.startsWith("browser-")) {
      try {
        found += (await pullUserBackupFromGitHub(userId)) ? 1 : 0;
      } catch (e) {
        console.warn("[lounge] github hydrate failed", e);
      }
    }
  }

  try {
    const { hydrateFilesFromTables } = await import("./relational");
    found += await hydrateFilesFromTables(userId);
  } catch (e) {
    console.warn("[lounge] relational hydrate failed", e);
  }

  try {
    const { repairLoungeFiles } = await import("./repair");
    repairLoungeFiles();
  } catch (e) {
    console.warn("[lounge] repair files failed", e);
  }

  return found > 0;
}

export async function pushUserKv(userId: string): Promise<void> {
  if (!userId) return;
  try {
    const sql = await getSql();
    for (const name of LOUNGE_KV_FILES) {
      const p = userDataPath(userId, name);
      if (!existsSync(p)) continue;
      let value: unknown;
      try {
        value = JSON.parse(readFileSync(p, "utf8"));
      } catch {
        continue;
      }
      if (name === SESSION_KEY && !sessionLooksValid(value)) continue;
      const existing = await sql.query<{ value: unknown }>(
        "select value from lounge_user_kv where user_id = $1 and key = $2",
        [userId, name],
      );
      const prev = existing[0]?.value;
      if (prev && isPoorer(name, name === SESSION_KEY ? value : value, prev)) {
        console.warn("[lounge] skip poorer push", name, userId.slice(0, 8));
        continue;
      }
      const stored = name === SESSION_KEY ? sealJson(value) : value;
      await sql.query(
        `insert into lounge_user_kv (user_id, key, value, updated_at)
         values ($1, $2, $3::jsonb, now())
         on conflict (user_id, key) do update set value = excluded.value, updated_at = now()`,
        [userId, name, JSON.stringify(stored)],
      );
    }
    const { projectFilesToTables } = await import("./relational");
    await projectFilesToTables(userId);
  } catch (e) {
    console.warn("[lounge] push user kv failed", e);
  }
  try {
    await pushUserBackupToGitHub(userId);
  } catch (e) {
    console.warn("[lounge] github persist failed", e);
  }
}

export async function upsertSessionKv(userId: string, session: unknown): Promise<void> {
  if (!userId || !sessionLooksValid(session)) return;
  try {
    const sql = await getSql();
    const existing = await sql.query<{ value: unknown }>(
      "select value from lounge_user_kv where user_id = $1 and key = $2",
      [userId, SESSION_KEY],
    );
    if (existing[0]?.value && isPoorer(SESSION_KEY, session, existing[0].value)) return;
    await sql.query(
      `insert into lounge_user_kv (user_id, key, value, updated_at)
       values ($1, $2, $3::jsonb, now())
       on conflict (user_id, key) do update set value = excluded.value, updated_at = now()`,
      [userId, SESSION_KEY, JSON.stringify(sealJson(session))],
    );
  } catch (e) {
    console.warn("[lounge] upsert session failed", e);
  }
}

export async function deleteSessionKv(userId: string): Promise<void> {
  if (!userId) return;
  try {
    const sql = await getSql();
    await sql.query("delete from lounge_user_kv where user_id = $1 and key = $2", [
      userId,
      SESSION_KEY,
    ]);
  } catch (e) {
    console.warn("[lounge] delete session failed", e);
  }
}

export async function withUserStore<T>(userId: string | null, fn: () => Promise<T>): Promise<T> {
  if (!userId) return fn();
  await pullUserKv(userId);
  return loungeUserAls.run(userId, async () => {
    try {
      await purgeShareableLiveIfStale(userId);
      const result = await fn();
      await pushUserKv(userId);
      return result;
    } catch (e) {
      try {
        await pushUserKv(userId);
      } catch {
        /* */
      }
      throw e;
    }
  });
}
