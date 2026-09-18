/**
 * Deduplicate lounge files so a pull never stacks the same day / bot / event
 * on top of itself. Counts are levels (latest scrape wins), never sums.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dataPath } from "./paths";
import type { HistoryDay, HistoryFile, LoungeSnapshot } from "./types";

const TZ = "Europe/Madrid";

export function calendarDay(raw: string | Date | null | undefined): string {
  if (!raw) return "";
  if (raw instanceof Date) return madridDay(raw);
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s.slice(0, 10);
  return madridDay(d);
}

function madridDay(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export function asInt(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return Math.round(v);
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) {
    return Math.round(Number(v));
  }
  return null;
}

export function uniqueLast<T>(items: T[], keyFn: (t: T) => string): T[] {
  const map = new Map<string, T>();
  for (const item of items) {
    const k = keyFn(item);
    if (!k) continue;
    map.set(k, item);
  }
  return [...map.values()];
}

export type FollowerPoint = {
  date: string;
  scrapedAt: string;
  count: number;
  source: string;
};

export type FollowerFile = {
  version: number;
  timezone: string;
  points: FollowerPoint[];
  sample: unknown[];
  last: FollowerPoint | null;
  sources: Record<string, number | null>;
};

/**
 * Pick the real follower *level* from noisy candidates.
 * Drops values that look like two (or more) real levels stacked on top of
 * each other — the 11,143-from-4,808+dupes class of bug.
 */
export function consensusFollowerCount(
  candidates: Array<number | null | undefined>,
): number | null {
  const xs = [
    ...new Set(
      candidates
        .map((n) => asInt(n))
        .filter((n): n is number => n != null && n >= 0),
    ),
  ].sort((a, b) => a - b);
  if (!xs.length) return null;
  if (xs.length === 1) return xs[0]!;

  const looksLikeSum = (n: number) => {
    for (let i = 0; i < xs.length; i++) {
      for (let j = i + 1; j < xs.length; j++) {
        const a = xs[i]!;
        const b = xs[j]!;
        if (a === n || b === n) continue;
        if (n > Math.max(a, b) * 1.35 && Math.abs(a + b - n) / Math.max(n, 1) < 0.16) {
          return true;
        }
      }
    }
    const others = xs.filter((o) => o !== n);
    if (!others.length) return false;
    const otherSum = others.reduce((a, b) => a + b, 0);
    return n > Math.max(...others) * 1.35 && Math.abs(otherSum - n) / Math.max(n, 1) < 0.16;
  };

  const pool = xs.filter((n) => !looksLikeSum(n));
  const use = pool.length ? pool : xs;

  let best = use[0]!;
  let bestScore = -1;
  for (const n of use) {
    const score = use.filter((o) => Math.abs(o - n) / Math.max(n, 1) <= 0.22).length;
    if (score > bestScore || (score === bestScore && n < best)) {
      best = n;
      bestScore = score;
    }
  }
  const cluster = use.filter((o) => Math.abs(o - best) / Math.max(best, 1) <= 0.22);
  return Math.max(...cluster);
}

function sanitizeSources(
  sources: Record<string, number | null> | undefined,
  typical: number | null,
): Record<string, number | null> {
  const next: Record<string, number | null> = { ...(sources || {}) };
  if (typical == null || typical <= 0) return next;
  for (const [k, v] of Object.entries(next)) {
    const n = asInt(v);
    if (n != null && n > typical * 1.45 && n > 500) next[k] = typical;
  }
  return next;
}

/** Keep one row per Madrid day. Last scrape wins. Never sum counts. */
export function repairFollowerFile(file: FollowerFile): FollowerFile {
  const byDate = new Map<string, FollowerPoint>();
  for (const p of file.points || []) {
    const date = calendarDay(p.date) || calendarDay(p.scrapedAt);
    if (!date) continue;
    const count = asInt(p.count);
    if (count == null || count < 0) continue;
    const next: FollowerPoint = {
      date,
      scrapedAt: p.scrapedAt || new Date().toISOString(),
      count,
      source: p.source || "",
    };
    const prev = byDate.get(date);
    if (!prev || next.scrapedAt >= prev.scrapedAt) byDate.set(date, next);
  }
  let points = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  const sourceTypical = consensusFollowerCount([
    file.sources?.listTotal,
    file.sources?.profile,
    file.sources?.me,
    file.sources?.stats,
    file.sources?.infoCount,
    file.last?.count,
    ...points.map((p) => p.count),
  ]);
  points = collapseSummedFollowerPoints(points, sourceTypical);

  const lastRaw = points[points.length - 1] || file.last || null;
  const typical = consensusFollowerCount([
    sourceTypical,
    lastRaw?.count,
    file.sources?.profile,
    file.sources?.me,
    file.sources?.stats,
    file.sources?.listTotal,
  ]);
  const last =
    lastRaw && typical != null && lastRaw.count > typical * 1.45 && lastRaw.count > 500
      ? { ...lastRaw, count: typical, source: `${lastRaw.source || "repair"}:deduped` }
      : lastRaw;
  if (last && points.length) {
    const i = points.findIndex((p) => p.date === last.date);
    if (i >= 0) points[i] = last;
  }

  return {
    version: 1,
    timezone: file.timezone || TZ,
    points: points.slice(-180),
    sample: Array.isArray(file.sample) ? file.sample : [],
    last,
    sources: sanitizeSources(file.sources, typical),
  };
}

/**
 * If a later point equals the sum of earlier levels, someone stacked daily
 * totals on top of each other. Replace with the highest real level.
 */
function collapseSummedFollowerPoints(
  points: FollowerPoint[],
  typicalHint: number | null = null,
): FollowerPoint[] {
  if (points.length < 2) return points;
  const levels = points.map((p) => p.count).filter((c) => c > 0);
  if (levels.length < 2) return points;
  const typical = typicalHint ?? consensusFollowerCount(levels);
  if (typical == null || typical <= 0) return points;
  const near = levels.filter((c) => Math.abs(c - typical) / Math.max(typical, 1) <= 0.22);
  const restSum = (skip: number) =>
    levels.filter((c) => c !== skip).reduce((a, b) => a + b, 0);

  return points.map((p) => {
    const stacked =
      p.count > typical * 1.45 &&
      p.count > 500 &&
      (near.length >= 2 || Math.abs(p.count - restSum(p.count)) / Math.max(p.count, 1) < 0.16);
    if (!stacked) return p;
    return { ...p, count: typical, source: `${p.source || "repair"}:deduped` };
  });
}

export function repairHistory(file: HistoryFile, followerLevel?: number | null): HistoryFile {
  const byDate = new Map<string, HistoryDay>();
  for (const d of file.days || []) {
    const date = calendarDay(d.date) || calendarDay(d.scrapedAt);
    if (!date) continue;
    const totals = d.totals || {
      chats: 0,
      likes: 0,
      favorites: 0,
      interactions: 0,
      followers: 0,
      bots: 0,
    };
    const botN = d.bots ? Object.keys(d.bots).length : 0;
    const empty =
      (totals.bots ?? 0) <= 0 &&
      botN <= 0 &&
      (totals.followers ?? 0) <= 0 &&
      (totals.chats ?? 0) <= 1 &&
      (totals.likes ?? 0) <= 0;
    if (empty) continue;
    let followers = asInt(totals.followers) ?? 0;
    if (followerLevel != null && followerLevel > 0 && followers > followerLevel * 1.45 && followers > 500) {
      followers = followerLevel;
    }
    const next: HistoryDay = { ...d, date, totals: { ...totals, followers } };
    const prev = byDate.get(date);
    if (!prev || (next.scrapedAt || "") >= (prev.scrapedAt || "")) byDate.set(date, next);
  }
  const days = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  return {
    ...file,
    version: 1,
    timezone: file.timezone || TZ,
    days: days.slice(-400),
  };
}

export function repairSnapshot(
  snap: LoungeSnapshot | null | undefined,
  followerLevel?: number | null,
): LoungeSnapshot | null {
  if (!snap) return null;
  const map = new Map<string, LoungeSnapshot["bots"][number]>();
  for (const b of snap.bots || []) {
    if (!b?.characterId) continue;
    map.set(String(b.characterId), b);
  }
  const bots = [...map.values()];
  const profileFol = asInt(snap.profile?.followersCount);
  const statsFol = asInt(snap.stats?.followersCount);
  const totalFol = asInt(snap.totals?.followers);
  const followers =
    consensusFollowerCount([followerLevel, profileFol, statsFol, totalFol]) ??
    profileFol ??
    statsFol ??
    totalFol ??
    0;
  const chats = asInt(snap.totals?.chats) ?? asInt(snap.profile?.chatCount) ?? 0;
  const likes = asInt(snap.totals?.likes) ?? asInt(snap.profile?.likeCount) ?? 0;
  const favorites = asInt(snap.totals?.favorites) ?? asInt(snap.profile?.favoriteCount) ?? 0;
  const profile = snap.profile
    ? { ...snap.profile, followersCount: followers }
    : snap.profile;
  return {
    ...snap,
    profile,
    bots,
    totals: {
      ...snap.totals,
      bots: bots.length,
      publicBots: bots.filter((b) => b.visibility === 2 || b.visibility == null).length,
      unlistedBots: bots.filter((b) => b.visibility === 1).length,
      privateBots: bots.filter((b) => b.visibility === 0).length,
      chats,
      likes,
      favorites,
      followers,
      interactions: snap.totals?.interactions ?? chats + likes + favorites,
    },
  };
}

export type NotifLike = {
  events?: Array<{
    messageId?: string;
    ts?: number;
    characterId?: string;
    characterName?: string;
  }>;
  lastScrapedAt?: string | null;
  [k: string]: unknown;
};

export function repairNotifs<T extends NotifLike>(store: T): T {
  const events = Array.isArray(store.events) ? store.events : [];
  const map = new Map<string, (typeof events)[number]>();
  for (const e of events) {
    if (!e || typeof e !== "object") continue;
    const id = e.messageId != null && String(e.messageId).trim() ? String(e.messageId) : "";
    if (!id) continue;
    const characterId = String(e.characterId || e.characterName || "unknown");
    const patched = { ...e, messageId: id, characterId };
    const prev = map.get(id);
    if (!prev || (patched.ts || 0) >= (prev.ts || 0)) map.set(id, patched);
  }
  const next = [...map.values()].sort((a, b) => (b.ts || 0) - (a.ts || 0));
  return { ...store, events: next };
}

function readJson(name: string): unknown | null {
  try {
    const p = dataPath(name);
    if (!existsSync(p)) return null;
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function writeJson(name: string, value: unknown) {
  try {
    writeFileSync(dataPath(name), JSON.stringify(value), "utf8");
  } catch {
    /* */
  }
}

/** Repair on-disk lounge files in the current user store. */
export function repairLoungeFiles(): {
  snapshotFollowers: number | null;
  followerPoints: number;
  historyDays: number;
  notifications: number;
} {
  const folRaw = readJson("followers-history.json") as FollowerFile | null;
  let fol: FollowerFile | null = null;
  let followerPoints = 0;
  if (folRaw) {
    fol = repairFollowerFile(folRaw);
    writeJson("followers-history.json", fol);
    followerPoints = fol.points.length;
  }
  const agreed = consensusFollowerCount([
    fol?.last?.count,
    fol?.sources?.profile,
    fol?.sources?.me,
    fol?.sources?.stats,
    fol?.sources?.listTotal,
  ]);

  const snap = repairSnapshot(readJson("last-snapshot.json") as LoungeSnapshot | null, agreed);
  if (snap) writeJson("last-snapshot.json", snap);

  const histRaw = readJson("growth-history.json") as HistoryFile | null;
  let historyDays = 0;
  if (histRaw) {
    const hist = repairHistory(histRaw, agreed ?? snap?.totals?.followers ?? null);
    writeJson("growth-history.json", hist);
    historyDays = hist.days.length;
  }

  const notifRaw = readJson("notification-events.json") as NotifLike | null;
  let notifications = 0;
  if (notifRaw) {
    const notif = repairNotifs(notifRaw);
    writeJson("notification-events.json", notif);
    notifications = Array.isArray(notif.events) ? notif.events.length : 0;
  }

  const dash = readJson("creator-dashboard.json") as { snapshot?: LoungeSnapshot } | null;
  if (dash?.snapshot) {
    dash.snapshot = repairSnapshot(dash.snapshot, agreed) || dash.snapshot;
    writeJson("creator-dashboard.json", dash);
  }

  return {
    snapshotFollowers: snap?.totals?.followers ?? agreed ?? null,
    followerPoints,
    historyDays,
    notifications,
  };
}
