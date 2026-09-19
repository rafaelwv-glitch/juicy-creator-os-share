import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { dataPath, ensureDataDir } from "./paths";
import { loadHistory } from "./history";
import { loadNotifStore, type NotifStore } from "./notifications";
import { loadCreatorInsights, type CreatorInsights } from "./insights";
import { loadFollowersCached, type FollowerAnalysis } from "./followers";
import { clearSession, loadSession, saveSession, type JuicySession } from "./session";
import type { HistoryFile, LoungeSnapshot } from "./types";
import { loadRivals, type RivalsFile } from "./rivals";
import type { CloudPublishJob } from "./cloud-publish";
import type { ForensicFile } from "./forensics";
import type { EconomyFile } from "./economy";
import { loungeTimezone } from "./timezone-server";

export const BACKUP_FORMAT = "juicy-lounge-backup" as const;
export const BACKUP_VERSION = "9.9.0";

/** Credentials-free dump of every analytics signal. Replaces the old Save JSON. */
export const WAREHOUSE_FORMAT = "juicy-lounge-warehouse" as const;
export const WAREHOUSE_VERSION = "1.7.0";

const CREDENTIAL_FILES = new Set(["juicy-session.json", "grok-hook.json"]);

export const WAREHOUSE_FILES = [
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
  "timezone.json",
  "new-feed.json",
  "followed-bots.json",
] as const;

/** Origin-private browser cache: warehouse + credentials. */
export const BROWSER_FILES = [...WAREHOUSE_FILES, "juicy-session.json", "grok-hook.json"] as const;

/** Demo analytics dropped from IDB when the snapshot is still SampleCreator. */
export const SAMPLE_ANALYTICS_FILES = [
  "last-snapshot.json",
  "growth-history.json",
  "notification-events.json",
  "creator-insights.json",
  "followers-history.json",
  "creator-dashboard.json",
  "creator-ranklist.json",
  "bot-forensics.json",
  "creator-economy.json",
] as const;

export type JuicyBackup = {
  format: typeof BACKUP_FORMAT;
  version: string;
  exportedAt: string;
  timezone: string;
  /** Optional session (includes cookie) — treat as secret. Internal GitHub only. */
  session: JuicySession | null;
  snapshot: LoungeSnapshot | null;
  history: HistoryFile | null;
  notifications: NotifStore | null;
  insights: CreatorInsights | null;
  followers: FollowerAnalysis | null;
  rivals?: RivalsFile | null;
  publishJobs?: CloudPublishJob[];
  forensics?: ForensicFile | null;
  economy?: EconomyFile | null;
};

export type WarehouseAccount = {
  userId?: string;
  userName?: string;
  userNo?: string;
};

export type WarehouseManifest = {
  bots: number;
  historyDays: number;
  events: number;
  forensicBots: number;
  forensicDayRows: number;
  followerPoints: number;
  rivalCount: number;
  rivalAlumni: number;
  rivalMrtDays: number;
  newFeedBots: number;
  newFeedDays: number;
  newFeedAt: string | null;
  keys: string[];
  snapshotAt: string | null;
  insightsAt: string | null;
  dashboardAt: string | null;
  ranklistAt: string | null;
  forensicsAt: string | null;
};

export type LoungeWarehouse = {
  format: typeof WAREHOUSE_FORMAT;
  version: string;
  exportedAt: string;
  timezone: string;
  /** Always false — this file must never carry cookies, hooks, or tokens. */
  credentials: false;
  account: WarehouseAccount | null;
  manifest: WarehouseManifest;
  files: Record<string, unknown>;
};

function loadSnapshotFile(): LoungeSnapshot | null {
  try {
    const path = dataPath("last-snapshot.json");
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf8")) as LoungeSnapshot;
  } catch {
    return null;
  }
}

function readKv(name: string): unknown | null {
  try {
    const p = dataPath(name);
    if (!existsSync(p)) return null;
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function writeKv(name: string, value: unknown) {
  ensureDataDir();
  writeFileSync(dataPath(name), JSON.stringify(value), "utf8");
}

function forensicStats(v: unknown): { bots: number; days: number; at: string | null } {
  if (!v || typeof v !== "object") return { bots: 0, days: 0, at: null };
  const f = v as ForensicFile;
  const bots = f.bots ? Object.keys(f.bots).length : 0;
  let days = 0;
  for (const b of Object.values(f.bots || {})) days += b.days?.length || 0;
  return { bots, days, at: f.lastIngestAt ?? null };
}

function buildManifest(files: Record<string, unknown>): WarehouseManifest {
  const snap = files["last-snapshot.json"] as LoungeSnapshot | undefined;
  const hist = files["growth-history.json"] as HistoryFile | undefined;
  const notif = files["notification-events.json"] as NotifStore | undefined;
  const fol = files["followers-history.json"] as { points?: unknown[] } | undefined;
  const rivals = files["rivals-track.json"] as RivalsFile | undefined;
  const insights = files["creator-insights.json"] as CreatorInsights | undefined;
  const dash = files["creator-dashboard.json"] as { scrapedAt?: string } | undefined;
  const rank = files["creator-ranklist.json"] as { scrapedAt?: string } | undefined;
  const forensic = forensicStats(files["bot-forensics.json"]);
  const newFeed = files["new-feed.json"] as
    | { catalog?: Record<string, unknown>; days?: unknown[]; lastScrapedAt?: string }
    | undefined;
  let rivalMrtDays = 0;
  for (const r of [...(rivals?.rivals || []), ...(rivals?.alumni || [])]) {
    rivalMrtDays += r.mrtLog?.length || (r.mrt ? 1 : 0);
  }
  return {
    bots: snap?.bots?.length ?? 0,
    historyDays: hist?.days?.length ?? 0,
    events: notif?.events?.length ?? 0,
    forensicBots: forensic.bots,
    forensicDayRows: forensic.days,
    followerPoints: Array.isArray(fol?.points) ? fol.points.length : 0,
    rivalCount: rivals?.rivals?.length ?? 0,
    rivalAlumni: rivals?.alumni?.length ?? 0,
    rivalMrtDays,
    newFeedBots: newFeed?.catalog ? Object.keys(newFeed.catalog).length : 0,
    newFeedDays: Array.isArray(newFeed?.days) ? newFeed.days.length : 0,
    newFeedAt: newFeed?.lastScrapedAt ?? null,
    keys: Object.keys(files).sort(),
    snapshotAt: snap?.scrapedAt ?? null,
    insightsAt: insights?.scrapedAt ?? null,
    dashboardAt: dash?.scrapedAt ?? null,
    ranklistAt: rank?.scrapedAt ?? null,
    forensicsAt: forensic.at,
  };
}

export function collectBackup(opts?: { includeSession?: boolean }): JuicyBackup {
  const includeSession = opts?.includeSession !== false;
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    timezone: loungeTimezone(),
    session: includeSession ? loadSession() : null,
    snapshot: loadSnapshotFile(),
    history: loadHistory(),
    notifications: loadNotifStore(),
    insights: loadCreatorInsights(),
    followers: loadFollowersCached(),
    rivals: loadRivals(),
    forensics: (() => {
      try {
        const p = dataPath("bot-forensics.json");
        if (!existsSync(p)) return null;
        return JSON.parse(readFileSync(p, "utf8")) as ForensicFile;
      } catch {
        return null;
      }
    })(),
    economy: (() => {
      try {
        const p = dataPath("creator-economy.json");
        if (!existsSync(p)) return null;
        return JSON.parse(readFileSync(p, "utf8")) as EconomyFile;
      } catch {
        return null;
      }
    })(),
    publishJobs: (() => {
      try {
        const p = dataPath("publish-jobs.json");
        if (!existsSync(p)) return [] as CloudPublishJob[];
        const raw = JSON.parse(readFileSync(p, "utf8")) as CloudPublishJob[];
        return Array.isArray(raw) ? raw : [];
      } catch {
        return [] as CloudPublishJob[];
      }
    })(),
  };
}

const SECRET_KEY = /^(cookie|yume_voucher|voucher|authorization)$/i;

function stripSecrets(value: unknown, depth = 0): unknown {
  if (depth > 14 || value == null) return value;
  if (Array.isArray(value)) return value.map((v) => stripSecrets(v, depth + 1));
  if (typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEY.test(k)) continue;
    out[k] = stripSecrets(v, depth + 1);
  }
  return out;
}

export function collectWarehouse(): LoungeWarehouse {
  const files: Record<string, unknown> = {};
  for (const name of WAREHOUSE_FILES) {
    if (CREDENTIAL_FILES.has(name)) continue;
    const v = readKv(name);
    if (v != null) files[name] = stripSecrets(v);
  }
  const snap = (files["last-snapshot.json"] as LoungeSnapshot | undefined) || loadSnapshotFile();
  const session = loadSession();
  const account: WarehouseAccount | null = snap?.profile
    ? {
        userId: snap.profile.userId || snap.userId,
        userName: snap.profile.userName,
        userNo: snap.profile.userNo,
      }
    : session
      ? { userId: session.userId, userName: session.userName, userNo: session.userNo }
      : snap?.userId
        ? { userId: snap.userId }
        : null;
  return {
    format: WAREHOUSE_FORMAT,
    version: WAREHOUSE_VERSION,
    exportedAt: new Date().toISOString(),
    timezone: loungeTimezone(),
    credentials: false,
    account,
    manifest: buildManifest(files),
    files,
  };
}

/** Keep pins/jobs/session when the isolate still has the SampleCreator snapshot. */
export function filesForBrowserCache(
  files: Record<string, unknown>,
  sample: boolean,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...files };
  if (!sample) return out;
  for (const name of SAMPLE_ANALYTICS_FILES) delete out[name];
  return out;
}

/** Origin-private dump for IndexedDB. Includes session + grok hook. */
export function collectBrowserWarehouse(): LoungeWarehouse {
  const files: Record<string, unknown> = {};
  for (const name of BROWSER_FILES) {
    const v = readKv(name);
    if (v == null) continue;
    files[name] = name === "juicy-session.json" || name === "grok-hook.json" ? v : stripSecrets(v);
  }
  const snap = (files["last-snapshot.json"] as LoungeSnapshot | undefined) || loadSnapshotFile();
  const session = loadSession();
  const account: WarehouseAccount | null = snap?.profile
    ? {
        userId: snap.profile.userId || snap.userId,
        userName: snap.profile.userName,
        userNo: snap.profile.userNo,
      }
    : session
      ? { userId: session.userId, userName: session.userName, userNo: session.userNo }
      : snap?.userId
        ? { userId: snap.userId }
        : null;
  return {
    format: WAREHOUSE_FORMAT,
    version: WAREHOUSE_VERSION,
    exportedAt: new Date().toISOString(),
    timezone: loungeTimezone(),
    credentials: false,
    account,
    manifest: buildManifest(files),
    files,
  };
}

function filesFromLegacy(data: Partial<JuicyBackup> & { events?: NotifStore["events"] }): Record<string, unknown> {
  const files: Record<string, unknown> = {};
  if (data.snapshot) files["last-snapshot.json"] = data.snapshot;
  if (data.history && Array.isArray(data.history.days)) files["growth-history.json"] = data.history;
  const notifications: NotifStore | null =
    data.notifications ??
    (Array.isArray(data.events)
      ? {
          version: 1,
          timezone: loungeTimezone(),
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
      timezone: notifications.timezone || loungeTimezone(),
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
  if (data.forensics && data.forensics.bots) files["bot-forensics.json"] = data.forensics;
  if (data.economy && Array.isArray(data.economy.days)) files["creator-economy.json"] = data.economy;
  if (Array.isArray(data.publishJobs)) files["publish-jobs.json"] = data.publishJobs;
  return files;
}

export type ApplyBackupResult = {
  ok: true;
  message: string;
  counts: {
    bots: number;
    historyDays: number;
    events: number;
    forensicBots: number;
    keys: number;
    hasInsights: boolean;
    hasSession: boolean;
    hasFollowers: boolean;
  };
};

export function applyBackup(
  raw: unknown,
  opts?: { allowCredentials?: boolean },
): ApplyBackupResult {
  if (!raw || typeof raw !== "object") {
    throw new Error("Invalid warehouse: not an object");
  }
  const data = raw as Partial<LoungeWarehouse> &
    Partial<JuicyBackup> & {
      events?: NotifStore["events"];
      files?: Record<string, unknown>;
    };

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
    throw new Error("Not a Juicy Lounge warehouse or backup file");
  }

  ensureDataDir();

  let files: Record<string, unknown> = {};
  if (data.files && typeof data.files === "object") {
    files = { ...data.files };
  } else {
    files = filesFromLegacy(data);
  }

  let written = 0;
  for (const [name, value] of Object.entries(files)) {
    const isCred = CREDENTIAL_FILES.has(name);
    if (isCred && !opts?.allowCredentials) continue;
    if (!isCred && !(WAREHOUSE_FILES as readonly string[]).includes(name)) continue;
    if (value == null) continue;
    if (name === "juicy-session.json") {
      const sess = value as JuicySession;
      if (sess?.cookie && sess.cookie.length > 8) {
        saveSession(sess);
        written += 1;
      }
      continue;
    }
    writeKv(name, value);
    written += 1;
  }

  let restoredSession = false;
  if (opts?.allowCredentials) {
    let session = (data.session ?? (files["juicy-session.json"] as JuicySession | undefined) ?? null) as
      | (JuicySession & { loungeUserId?: string })
      | null;
    if (session && !session.userId && session.loungeUserId) {
      session = { ...session, userId: session.loungeUserId };
    }
    if (session?.cookie) {
      saveSession(session);
      restoredSession = true;
    }
    const hook = files["grok-hook.json"] as { url?: string; secret?: string } | undefined;
    if (hook && (hook.url || hook.secret)) {
      writeKv("grok-hook.json", hook);
    }
  }

  const snap = (files["last-snapshot.json"] as LoungeSnapshot | undefined) || null;
  const hist = (files["growth-history.json"] as HistoryFile | undefined) || null;
  const notif = (files["notification-events.json"] as NotifStore | undefined) || null;
  const forensic = forensicStats(files["bot-forensics.json"]);
  const bots = snap?.bots?.length ?? 0;
  const historyDays = hist?.days?.length ?? 0;
  const events = notif?.events?.length ?? 0;

  return {
    ok: true,
    message: `Warehouse restored · ${bots} bots · ${historyDays} history days · ${events} events · ${forensic.bots} forensic bots · ${written} files`,
    counts: {
      bots,
      historyDays,
      events,
      forensicBots: forensic.bots,
      keys: written,
      hasInsights: Boolean(files["creator-insights.json"]),
      hasSession: restoredSession,
      hasFollowers: Boolean(files["followers-history.json"]),
    },
  };
}

export function clearAnalyticsFiles(opts?: { keepSession?: boolean }) {
  for (const name of [
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
    "exposure-performance.json",
    "audit15-queue.json",
    "tag-competition.json",
    "new-feed.json",
  ]) {
    try {
      const p = dataPath(name);
      if (existsSync(p)) unlinkSync(p);
    } catch {
      /* */
    }
  }
  if (!opts?.keepSession) {
    clearSession();
  }
}
