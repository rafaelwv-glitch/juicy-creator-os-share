/**
 * First-class Postgres tables for webhook, settings, snapshot, history,
 * followers, notifications, scheduled publishes.
 *
 * Files under getDataDir() stay a working cache. Neon (or PGLite) is the
 * durable source of truth. Dual-write never overwrites a richer history.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { getSql, dbSource } from "@/lib/db";
import { currentLoungeUserId, dataPath, ensureDataDir, userDataPath } from "./paths";
import type { GrokHook } from "./grok-hook";
import type { HistoryDay, HistoryFile, LoungeSnapshot } from "./types";
import type { JuicySession } from "./session";

export type DbInventory = {
  source: "neon" | "pglite";
  ok: boolean;
  latencyMs: number;
  error: string | null;
  schema: boolean;
  schemaSolid: boolean;
  hasSession: boolean;
  webhook: boolean;
  webhookLastOk: boolean | null;
  webhookLastAt: string | null;
  snapshotAt: string | null;
  bots: number;
  growthDays: number;
  followerDays: number;
  notifications: number;
  scheduledJobs: number;
  kvKeys: number;
  timezone: string;
  lastPullAt: string | null;
  lastPullOk: boolean | null;
  lastPullMessage: string | null;
  lastPullKind: string | null;
  lastOkPullAt: string | null;
  lastOkPullMessage: string | null;
};

const TZ = "Europe/Madrid";

function readJson(file: string): unknown | null {
  try {
    const p = dataPath(file);
    if (!existsSync(p)) return null;
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function writeJson(file: string, value: unknown) {
  try {
    ensureDataDir();
    writeFileSync(dataPath(file), JSON.stringify(value), "utf8");
  } catch {
    /* */
  }
}

function iso(v: unknown): string | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

async function tableName(name: string): Promise<boolean> {
  try {
    const sql = await getSql();
    const reg = await sql.query<{ t: string | null }>("select to_regclass($1) as t", [name]);
    return Boolean(reg[0]?.t);
  } catch {
    return false;
  }
}

export async function pingDb(): Promise<{
  ok: boolean;
  latencyMs: number;
  error: string | null;
  schema?: boolean;
  schemaSolid?: boolean;
}> {
  const t0 = Date.now();
  try {
    const sql = await getSql();
    await sql.query("select 1 as ok");
    const [account, days] = await Promise.all([
      sql.query<{ t: string | null }>("select to_regclass('lounge_account') as t"),
      sql.query<{ t: string | null }>("select to_regclass('lounge_history_day') as t"),
    ]);
    return {
      ok: true,
      latencyMs: Date.now() - t0,
      error: null,
      schema: Boolean(account[0]?.t),
      schemaSolid: Boolean(days[0]?.t),
    };
  } catch (e) {
    return {
      ok: false,
      latencyMs: Date.now() - t0,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

function emptyInventory(ping: Awaited<ReturnType<typeof pingDb>>): DbInventory {
  return {
    source: dbSource,
    ok: ping.ok,
    latencyMs: ping.latencyMs,
    error: ping.error,
    schema: ping.schema === true,
    schemaSolid: ping.schemaSolid === true,
    hasSession: false,
    webhook: false,
    webhookLastOk: null,
    webhookLastAt: null,
    snapshotAt: null,
    bots: 0,
    growthDays: 0,
    followerDays: 0,
    notifications: 0,
    scheduledJobs: 0,
    kvKeys: 0,
    timezone: TZ,
    lastPullAt: null,
    lastPullOk: null,
    lastPullMessage: null,
    lastPullKind: null,
    lastOkPullAt: null,
    lastOkPullMessage: null,
  };
}

type CronPullRow = {
  kind: string;
  started_at: string | Date;
  finished_at: string | Date | null;
  ok: boolean | null;
  message: string | null;
};

function pullFromRow(r: CronPullRow | undefined) {
  if (!r) {
    return {
      lastPullAt: null as string | null,
      lastPullOk: null as boolean | null,
      lastPullMessage: null as string | null,
      lastPullKind: null as string | null,
    };
  }
  return {
    lastPullAt: iso(r.finished_at || r.started_at),
    lastPullOk: r.ok,
    lastPullMessage: r.message || null,
    lastPullKind: r.kind || null,
  };
}

async function attachPulls<T extends DbInventory>(inv: T): Promise<T> {
  if (!inv.ok) return inv;
  try {
    const sql = await getSql();
    const [last, lastOk] = await Promise.all([
      sql.query<CronPullRow>(
        `select kind, started_at, finished_at, ok, message
         from lounge_cron_log
         where kind in ('pull','manual')
         order by started_at desc
         limit 1`,
      ),
      sql.query<CronPullRow>(
        `select kind, started_at, finished_at, ok, message
         from lounge_cron_log
         where kind in ('pull','manual') and ok = true
         order by coalesce(finished_at, started_at) desc
         limit 1`,
      ),
    ]);
    const lastP = pullFromRow(last[0]);
    const okP = pullFromRow(lastOk[0]);
    return {
      ...inv,
      ...lastP,
      lastOkPullAt: okP.lastPullAt,
      lastOkPullMessage: okP.lastPullMessage,
    };
  } catch {
    return inv;
  }
}

export async function inventory(userId: string | null): Promise<DbInventory> {
  const ping = await pingDb();
  const empty = emptyInventory(ping);
  if (!ping.ok) return empty;
  if (!userId) return attachPulls(empty);
  try {
    const sql = await getSql();
    const [acct, snap, hist, fol, notif, jobs, kv] = await Promise.all([
      sql.query<{
        has_session: boolean;
        grok_hook_enabled: boolean;
        grok_hook_url: string;
        grok_last_ok: boolean | null;
        grok_last_at: string | Date | null;
        timezone: string | null;
      }>(
        `select has_session, grok_hook_enabled, grok_hook_url, grok_last_ok, grok_last_at, timezone
         from lounge_account where user_id = $1`,
        [userId],
      ),
      sql.query<{ scraped_at: string | Date; bots: number }>(
        `select scraped_at, bots from lounge_snapshot where user_id = $1`,
        [userId],
      ),
      sql.query<{ days: number }>(`select days from lounge_history where user_id = $1`, [userId]),
      sql.query<{ points: number }>(`select points from lounge_followers where user_id = $1`, [userId]),
      sql.query<{ event_count: number }>(
        `select event_count from lounge_notifications where user_id = $1`,
        [userId],
      ),
      sql.query<{ n: number }>(
        `select count(*)::int as n from lounge_publish_jobs
         where user_id = $1 and status = 'scheduled'`,
        [userId],
      ),
      sql.query<{ n: number }>(
        `select count(*)::int as n from lounge_user_kv where user_id = $1`,
        [userId],
      ),
    ]);

    let growthDays = Number(hist[0]?.days || 0);
    let followerDays = Number(fol[0]?.points || 0);
    let timezone = acct[0]?.timezone || TZ;
    let webhookLastAt = acct[0]?.grok_last_at ? iso(acct[0].grok_last_at) : null;

    if (await tableName("lounge_history_day")) {
      const dayRows = await sql.query<{ n: number }>(
        `select count(*)::int as n from lounge_history_day where user_id = $1`,
        [userId],
      );
      growthDays = Math.max(growthDays, Number(dayRows[0]?.n || 0));
    }
    if (await tableName("lounge_follower_point")) {
      const pts = await sql.query<{ n: number }>(
        `select count(*)::int as n from lounge_follower_point where user_id = $1`,
        [userId],
      );
      followerDays = Math.max(followerDays, Number(pts[0]?.n || 0));
    }
    if (await tableName("lounge_settings")) {
      const st = await sql.query<{ timezone: string }>(
        `select timezone from lounge_settings where user_id = $1`,
        [userId],
      );
      if (st[0]?.timezone) timezone = st[0].timezone;
    }
    if (await tableName("lounge_webhook_delivery")) {
      const last = await sql.query<{ delivered_at: string | Date }>(
        `select delivered_at from lounge_webhook_delivery
         where user_id = $1 order by delivered_at desc limit 1`,
        [userId],
      );
      if (last[0]?.delivered_at) webhookLastAt = iso(last[0].delivered_at) || webhookLastAt;
    }

    const a = acct[0];
    const s = snap[0];
    return attachPulls({
      ...empty,
      hasSession: Boolean(a?.has_session),
      webhook: Boolean(a?.grok_hook_enabled && a?.grok_hook_url),
      webhookLastOk: a?.grok_last_ok ?? null,
      webhookLastAt,
      snapshotAt: s?.scraped_at ? iso(s.scraped_at) : null,
      bots: Number(s?.bots || 0),
      growthDays,
      followerDays,
      notifications: Number(notif[0]?.event_count || 0),
      scheduledJobs: Number(jobs[0]?.n || 0),
      kvKeys: Number(kv[0]?.n || 0),
      timezone,
    });
  } catch (e) {
    return attachPulls({
      ...empty,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

export async function upsertAccountFromFiles(userId: string): Promise<void> {
  const session = readJson("juicy-session.json") as JuicySession | null;
  const hook = readJson("grok-hook.json") as Partial<GrokHook> | null;
  const hist = readJson("growth-history.json") as HistoryFile | null;
  const timezone = hist?.timezone || TZ;
  const sql = await getSql();
  await sql.query(
    `insert into lounge_account (
       user_id, juicy_user_id, juicy_user_name, juicy_user_no, juicy_email,
       session_logged_in_at, session_source, has_session,
       grok_hook_url, grok_hook_secret, grok_pull_token, grok_hook_enabled,
       grok_last_at, grok_last_ok, grok_last_status, grok_last_error, timezone, updated_at
     ) values (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17, now()
     )
     on conflict (user_id) do update set
       juicy_user_id = coalesce(excluded.juicy_user_id, lounge_account.juicy_user_id),
       juicy_user_name = coalesce(excluded.juicy_user_name, lounge_account.juicy_user_name),
       juicy_user_no = coalesce(excluded.juicy_user_no, lounge_account.juicy_user_no),
       juicy_email = coalesce(excluded.juicy_email, lounge_account.juicy_email),
       session_logged_in_at = coalesce(excluded.session_logged_in_at, lounge_account.session_logged_in_at),
       session_source = coalesce(excluded.session_source, lounge_account.session_source),
       has_session = excluded.has_session or lounge_account.has_session,
       grok_hook_url = case when excluded.grok_hook_url <> '' then excluded.grok_hook_url else lounge_account.grok_hook_url end,
       grok_hook_secret = case when excluded.grok_hook_secret <> '' then excluded.grok_hook_secret else lounge_account.grok_hook_secret end,
       grok_pull_token = case when excluded.grok_pull_token <> '' then excluded.grok_pull_token else lounge_account.grok_pull_token end,
       grok_hook_enabled = excluded.grok_hook_enabled or lounge_account.grok_hook_enabled,
       grok_last_at = coalesce(excluded.grok_last_at, lounge_account.grok_last_at),
       grok_last_ok = coalesce(excluded.grok_last_ok, lounge_account.grok_last_ok),
       grok_last_status = coalesce(excluded.grok_last_status, lounge_account.grok_last_status),
       grok_last_error = coalesce(excluded.grok_last_error, lounge_account.grok_last_error),
       timezone = excluded.timezone,
       updated_at = now()`,
    [
      userId,
      session?.userId || null,
      session?.userName || null,
      session?.userNo || null,
      session?.email || null,
      session?.loggedInAt || null,
      session?.source || null,
      Boolean(session?.cookie && session.cookie.length > 8),
      String(hook?.url || ""),
      String(hook?.secret || ""),
      String(hook?.pullToken || ""),
      Boolean(hook?.enabled && hook?.url),
      hook?.lastAt || null,
      hook?.lastOk ?? null,
      hook?.lastStatus ?? null,
      hook?.lastError || null,
      timezone,
    ],
  );
  await upsertSettings(userId, timezone);
}

export async function upsertSettings(userId: string, timezone = TZ, payload: Record<string, unknown> = {}): Promise<void> {
  if (!userId) return;
  try {
    if (!(await tableName("lounge_settings"))) return;
    const sql = await getSql();
    await sql.query(
      `insert into lounge_settings (user_id, timezone, payload, updated_at)
       values ($1, $2, $3::jsonb, now())
       on conflict (user_id) do update set
         timezone = excluded.timezone,
         payload = excluded.payload,
         updated_at = now()`,
      [userId, timezone || TZ, JSON.stringify(payload)],
    );
  } catch (e) {
    console.warn("[lounge] upsert settings failed", e);
  }
}

export async function upsertGrokHook(userId: string, hook: GrokHook): Promise<void> {
  try {
    const sql = await getSql();
    await sql.query(
      `insert into lounge_account (
         user_id, grok_hook_url, grok_hook_secret, grok_pull_token, grok_hook_enabled,
         grok_last_at, grok_last_ok, grok_last_status, grok_last_error, updated_at
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9, now())
       on conflict (user_id) do update set
         grok_hook_url = excluded.grok_hook_url,
         grok_hook_secret = excluded.grok_hook_secret,
         grok_pull_token = excluded.grok_pull_token,
         grok_hook_enabled = excluded.grok_hook_enabled,
         grok_last_at = excluded.grok_last_at,
         grok_last_ok = excluded.grok_last_ok,
         grok_last_status = excluded.grok_last_status,
         grok_last_error = excluded.grok_last_error,
         updated_at = now()`,
      [
        userId,
        hook.url || "",
        hook.secret || "",
        hook.pullToken || "",
        Boolean(hook.enabled && hook.url),
        hook.lastAt || null,
        hook.lastOk ?? null,
        hook.lastStatus ?? null,
        hook.lastError || null,
      ],
    );
  } catch (e) {
    console.warn("[lounge] upsert grok hook failed", e);
  }
}

export async function logWebhookDelivery(userId: string, hook: Pick<GrokHook, "lastAt" | "lastOk" | "lastStatus" | "lastError">): Promise<void> {
  if (!userId || !hook.lastAt) return;
  try {
    if (!(await tableName("lounge_webhook_delivery"))) return;
    const sql = await getSql();
    await sql.query(
      `insert into lounge_webhook_delivery (user_id, delivered_at, ok, status, error)
       values ($1, $2, $3, $4, $5)`,
      [userId, hook.lastAt, Boolean(hook.lastOk), hook.lastStatus ?? null, hook.lastError || null],
    );
    await sql.query(
      `delete from lounge_webhook_delivery
       where user_id = $1 and id not in (
         select id from lounge_webhook_delivery
         where user_id = $1
         order by delivered_at desc
         limit 50
       )`,
      [userId],
    );
  } catch (e) {
    console.warn("[lounge] log webhook delivery failed", e);
  }
}

export async function upsertHistoryDays(userId: string, hist: HistoryFile): Promise<void> {
  if (!userId || !Array.isArray(hist?.days) || !hist.days.length) return;
  try {
    if (!(await tableName("lounge_history_day"))) return;
    const sql = await getSql();
    await upsertSettings(userId, hist.timezone || TZ);
    for (const d of hist.days) {
      const t = d.totals || { chats: 0, likes: 0, favorites: 0, followers: 0, interactions: 0, bots: 0 };
      await sql.query(
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
          JSON.stringify(d),
        ],
      );
    }
  } catch (e) {
    console.warn("[lounge] upsert history days failed", e);
  }
}

export async function upsertFollowerPoints(
  userId: string,
  file: {
    points?: Array<{ date: string; scrapedAt: string; count: number; source?: string }>;
  },
): Promise<void> {
  if (!userId || !Array.isArray(file?.points) || !file.points.length) return;
  try {
    if (!(await tableName("lounge_follower_point"))) return;
    const sql = await getSql();
    for (const p of file.points) {
      if (!p?.date) continue;
      await sql.query(
        `insert into lounge_follower_point (user_id, day, scraped_at, count, source)
         values ($1, $2, $3, $4, $5)
         on conflict (user_id, day) do update set
           scraped_at = excluded.scraped_at,
           count = excluded.count,
           source = excluded.source`,
        [userId, p.date, p.scrapedAt || new Date().toISOString(), Number(p.count) || 0, p.source || ""],
      );
    }
  } catch (e) {
    console.warn("[lounge] upsert follower points failed", e);
  }
}

export async function projectFilesToTables(userId: string): Promise<void> {
  if (!userId) return;
  try {
    const sql = await getSql();
    await upsertAccountFromFiles(userId);

    const snap = readJson("last-snapshot.json") as LoungeSnapshot | null;
    if (snap && Array.isArray(snap.bots)) {
      const t = snap.totals || {
        bots: snap.bots.length,
        chats: 0,
        likes: 0,
        favorites: 0,
        followers: 0,
        interactions: 0,
      };
      await sql.query(
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
          JSON.stringify(snap),
        ],
      );
    }

    const hist = readJson("growth-history.json") as HistoryFile | null;
    if (hist && Array.isArray(hist.days)) {
      const last = hist.days[hist.days.length - 1];
      await sql.query(
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
          hist.timezone || TZ,
          hist.days.length,
          last?.date || null,
          last?.totals?.chats ?? 0,
          last?.totals?.likes ?? 0,
          last?.totals?.favorites ?? 0,
          last?.totals?.followers ?? 0,
          JSON.stringify(hist),
        ],
      );
      await upsertHistoryDays(userId, hist);
    }

    const fol = readJson("followers-history.json") as {
      points?: Array<{ date: string; scrapedAt: string; count: number; source?: string }>;
      last?: { scrapedAt?: string; count?: number } | null;
    } | null;
    if (fol && Array.isArray(fol.points)) {
      const last = fol.last || fol.points[fol.points.length - 1];
      await sql.query(
        `insert into lounge_followers (user_id, last_count, last_at, points, payload, updated_at)
         values ($1,$2,$3,$4,$5::jsonb, now())
         on conflict (user_id) do update set
           last_count = excluded.last_count,
           last_at = excluded.last_at,
           points = excluded.points,
           payload = excluded.payload,
           updated_at = now()`,
        [
          userId,
          last?.count ?? null,
          last?.scrapedAt || null,
          fol.points.length,
          JSON.stringify(fol),
        ],
      );
      await upsertFollowerPoints(userId, fol);
    }

    const notif = readJson("notification-events.json") as {
      events?: Array<{ ts?: number }>;
      lastScrapedAt?: string | null;
    } | null;
    if (notif && Array.isArray(notif.events)) {
      const lastTs = notif.events.reduce((m, e) => Math.max(m, Number(e.ts) || 0), 0);
      await sql.query(
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
          JSON.stringify(notif),
        ],
      );
    }
  } catch (e) {
    console.warn("[lounge] project to tables failed", e);
  }
}

function asHistoryDay(row: {
  day: string | Date;
  scraped_at: string | Date | null;
  chats: number;
  likes: number;
  favorites: number;
  followers: number;
  interactions: number;
  bots: number;
  payload: unknown;
}): HistoryDay {
  if (row.payload && typeof row.payload === "object" && (row.payload as HistoryDay).date) {
    return row.payload as HistoryDay;
  }
  const day =
    typeof row.day === "string" ? row.day.slice(0, 10) : iso(row.day)?.slice(0, 10) || "";
  return {
    date: day,
    scrapedAt: iso(row.scraped_at) || new Date().toISOString(),
    totals: {
      chats: Number(row.chats || 0),
      likes: Number(row.likes || 0),
      favorites: Number(row.favorites || 0),
      followers: Number(row.followers || 0),
      interactions: Number(row.interactions || 0),
      bots: Number(row.bots || 0),
    },
    bots: {},
  };
}

export async function hydrateFilesFromTables(userId: string): Promise<number> {
  if (!userId) return 0;
  let n = 0;
  try {
    const sql = await getSql();
    const acct = await sql.query<{
      grok_hook_url: string;
      grok_hook_secret: string;
      grok_pull_token: string;
      grok_hook_enabled: boolean;
      grok_last_at: string | Date | null;
      grok_last_ok: boolean | null;
      grok_last_status: number | null;
      grok_last_error: string | null;
    }>(
      `select grok_hook_url, grok_hook_secret, grok_pull_token, grok_hook_enabled,
              grok_last_at, grok_last_ok, grok_last_status, grok_last_error
       from lounge_account where user_id = $1`,
      [userId],
    );
    const a = acct[0];
    if (a && (a.grok_hook_url || a.grok_hook_secret || a.grok_pull_token)) {
      const existing = (readJson("grok-hook.json") as Partial<GrokHook> | null) || {};
      writeJson("grok-hook.json", {
        url: a.grok_hook_url || existing.url || "",
        secret: a.grok_hook_secret || existing.secret || "",
        pullToken: a.grok_pull_token || existing.pullToken || "",
        enabled: Boolean(a.grok_hook_enabled && (a.grok_hook_url || existing.url)),
        lastAt: iso(a.grok_last_at) || existing.lastAt || null,
        lastOk: a.grok_last_ok ?? existing.lastOk ?? null,
        lastStatus: a.grok_last_status ?? existing.lastStatus ?? null,
        lastError: a.grok_last_error ?? existing.lastError ?? null,
      });
      n += 1;
    }

    const snap = await sql.query<{ payload: unknown }>(
      `select payload from lounge_snapshot where user_id = $1`,
      [userId],
    );
    if (snap[0]?.payload) {
      const { repairSnapshot } = await import("./repair");
      writeJson("last-snapshot.json", repairSnapshot(snap[0].payload as Parameters<typeof repairSnapshot>[0]) || snap[0].payload);
      n += 1;
    }

    const hist = await sql.query<{ payload: unknown; days: number }>(
      `select payload, days from lounge_history where user_id = $1`,
      [userId],
    );
    const existingHist = readJson("growth-history.json") as HistoryFile | null;
    const fileDays = Array.isArray(existingHist?.days) ? existingHist.days.length : 0;
    let wroteHist = false;
    if (hist[0]?.payload && Number(hist[0].days || 0) >= fileDays) {
      const { repairHistory } = await import("./repair");
      writeJson("growth-history.json", repairHistory(hist[0].payload as Parameters<typeof repairHistory>[0]));
      n += 1;
      wroteHist = true;
    }
    if (await tableName("lounge_history_day")) {
      const dayRows = await sql.query<{
        day: string | Date;
        scraped_at: string | Date | null;
        chats: number;
        likes: number;
        favorites: number;
        followers: number;
        interactions: number;
        bots: number;
        payload: unknown;
      }>(
        `select day, scraped_at, chats, likes, favorites, followers, interactions, bots, payload
         from lounge_history_day where user_id = $1 order by day`,
        [userId],
      );
      if (dayRows.length > fileDays && dayRows.length >= Number(hist[0]?.days || 0)) {
        const rebuilt: HistoryFile = {
          version: 1,
          timezone: existingHist?.timezone || TZ,
          days: dayRows.map(asHistoryDay),
        };
        writeJson("growth-history.json", rebuilt);
        if (!wroteHist) n += 1;
      }
    }

    const fol = await sql.query<{ payload: unknown; points: number }>(
      `select payload, points from lounge_followers where user_id = $1`,
      [userId],
    );
    if (fol[0]?.payload) {
      const { repairFollowerFile } = await import("./repair");
      writeJson("followers-history.json", repairFollowerFile(fol[0].payload as Parameters<typeof repairFollowerFile>[0]));
      n += 1;
    } else if (await tableName("lounge_follower_point")) {
      const pts = await sql.query<{
        day: string | Date;
        scraped_at: string | Date;
        count: number;
        source: string;
      }>(
        `select day, scraped_at, count, source from lounge_follower_point
         where user_id = $1 order by day`,
        [userId],
      );
      if (pts.length) {
        const points = pts.map((p) => ({
          date: typeof p.day === "string" ? p.day.slice(0, 10) : iso(p.day)?.slice(0, 10) || "",
          scrapedAt: iso(p.scraped_at) || new Date().toISOString(),
          count: Number(p.count) || 0,
          source: p.source || "",
        }));
        writeJson("followers-history.json", {
          version: 1,
          timezone: TZ,
          points,
          sample: [],
          last: points[points.length - 1] || null,
          sources: {},
        });
        n += 1;
      }
    }

    const notif = await sql.query<{ payload: unknown; event_count: number }>(
      `select payload, event_count from lounge_notifications where user_id = $1`,
      [userId],
    );
    if (notif[0]?.payload) {
      const { repairNotifs } = await import("./repair");
      writeJson("notification-events.json", repairNotifs(notif[0].payload as Parameters<typeof repairNotifs>[0]));
      n += 1;
    }
  } catch (e) {
    console.warn("[lounge] hydrate from tables failed", e);
  }
  return n;
}

/** Used by tests / scripts to project a specific user's on-disk cache. */
export function projectUserDir(_userId: string) {
  return userDataPath(_userId, ".");
}

export { currentLoungeUserId };
