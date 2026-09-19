/**
 * Precise follower count + daily/weekly trend.
 * Prefer a consensus of live sources over a single field that can get stacked.
 * One row per lounge-timezone day. Counts are levels, never summed.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { JuicyClient } from "./client";
import { loadHistory } from "./history";
import { loadNotifStore } from "./notifications";
import { currentLoungeUserId, dataPath, ensureDataDir } from "./paths";
import {
  asInt,
  consensusFollowerCount,
  repairFollowerFile,
  type FollowerFile as RepairedFile,
  type FollowerPoint,
} from "./repair";
import { loadSession } from "./session";
import { loungeTimezone } from "./timezone-server";


const FILE = "followers-history.json";

export type { FollowerPoint };

export type FollowerSample = {
  userId: string;
  userName: string;
  userAvatar?: string;
  followersCount?: number;
  characterCount?: number;
};

export type FollowerSeriesPoint = {
  date: string;
  count: number;
  delta: number;
  follows?: number;
  projected?: boolean;
};

export type FollowerAnalysis = {
  scrapedAt: string | null;
  count: number | null;
  source: string | null;
  sources: Record<string, number | null>;
  dailyDelta: number | null;
  weeklyDelta: number | null;
  monthlyDelta: number | null;
  velocityPerDay: number | null;
  dailyDeltaSource?: "api" | "follows";
  pendingFollows?: number;
  series: FollowerSeriesPoint[];
  follows1d: number;
  follows7d: number;
  sample: FollowerSample[];
  warnings: string[];
};

type FollowerFile = RepairedFile & { sample: FollowerSample[] };

function dayKey(iso?: string): string {
  const d = iso ? new Date(iso) : new Date();
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: loungeTimezone(),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function asArray(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  if (!data || typeof data !== "object") return [];
  const o = data as Record<string, unknown>;
  for (const k of ["list", "records", "rows", "data", "followers", "followerList", "items"]) {
    if (Array.isArray(o[k])) return o[k] as Record<string, unknown>[];
  }
  return [];
}

function loadFile(): FollowerFile {
  try {
    const p = dataPath(FILE);
    if (!existsSync(p)) return emptyFile();
    const raw = JSON.parse(readFileSync(p, "utf8")) as FollowerFile;
    if (!raw || !Array.isArray(raw.points)) return emptyFile();
    const repaired = repairFollowerFile(raw) as FollowerFile;
    repaired.sample = Array.isArray(raw.sample) ? uniqueSample(raw.sample) : [];
    return repaired;
  } catch {
    return emptyFile();
  }
}

function uniqueSample(sample: FollowerSample[]): FollowerSample[] {
  const map = new Map<string, FollowerSample>();
  for (const s of sample) {
    if (!s?.userId) continue;
    map.set(String(s.userId), s);
  }
  return [...map.values()];
}

function emptyFile(): FollowerFile {
  return { version: 1, timezone: loungeTimezone(), points: [], sample: [], last: null, sources: {} };
}

function saveFile(file: FollowerFile) {
  const next = repairFollowerFile(file) as FollowerFile;
  next.sample = uniqueSample(file.sample || []);
  try {
    ensureDataDir();
    writeFileSync(dataPath(FILE), JSON.stringify(next), "utf8");
  } catch {
    /* */
  }
  const uid = currentLoungeUserId();
  if (uid) {
    void import("./relational")
      .then((m) => m.upsertFollowerPoints(uid, next))
      .catch(() => undefined);
  }
}

export function applyFollowerCountToSnapshot(count: number | null) {
  if (count == null || !Number.isFinite(count) || count < 0) return;
  try {
    const p = dataPath("last-snapshot.json");
    if (!existsSync(p)) return;
    const snap = JSON.parse(readFileSync(p, "utf8")) as {
      profile?: { followersCount?: number };
      stats?: Record<string, unknown>;
      totals?: { followers?: number };
    };
    if (!snap.totals) snap.totals = {};
    snap.totals.followers = Math.round(count);
    if (snap.profile) snap.profile.followersCount = Math.round(count);
    writeFileSync(p, JSON.stringify(snap), "utf8");
  } catch {
    /* */
  }
}

export function recordFollowerPoint(count: number, source: string, scrapedAt?: string) {
  if (!Number.isFinite(count) || count < 0) return;
  const file = loadFile();
  const iso = scrapedAt || new Date().toISOString();
  const date = dayKey(iso);
  const n = Math.round(count);
  const idx = file.points.findIndex((p) => p.date === date);
  if (idx >= 0) {
    const prev = file.points[idx]!;
    const stacked = n > 0 && prev.count > n * 1.45 && prev.count > 500;
    // Lounge profile often lags listTotal — never replace a higher same-day level
    // with a lower stale reading (unless the stored value looks like a stacked sum).
    if (!stacked && n < prev.count) {
      if (iso > prev.scrapedAt) {
        file.points[idx] = { ...prev, scrapedAt: iso };
        file.last = file.points[idx]!;
        saveFile(file);
      }
      return;
    }
    file.points[idx] = { date, scrapedAt: iso, count: n, source };
  } else {
    file.points.push({ date, scrapedAt: iso, count: n, source });
  }
  file.points.sort((a, b) => a.date.localeCompare(b.date));
  if (file.points.length > 180) file.points = file.points.slice(-180);
  file.last = file.points[file.points.length - 1] || null;
  saveFile(file);
}

function seedFromHistory(file: FollowerFile): FollowerFile {
  const hist = loadHistory();
  const known = new Set(file.points.map((p) => p.date));
  for (const d of hist.days || []) {
    const n = d.totals?.followers;
    if (typeof n !== "number" || n <= 0) continue;
    const date = d.date;
    if (!date || known.has(date)) continue;
    file.points.push({
      date,
      scrapedAt: d.scrapedAt,
      count: Math.round(n),
      source: "lounge-history",
    });
    known.add(date);
  }
  file.points.sort((a, b) => a.date.localeCompare(b.date));
  return repairFollowerFile(file) as FollowerFile;
}

function followEventsByDay(): Map<string, number> {
  const map = new Map<string, number>();
  const seen = new Set<string>();
  for (const e of loadNotifStore().events || []) {
    if (e.kind !== "follow" || !e.ts) continue;
    const id = e.messageId || `${e.senderId || "x"}-${e.ts}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const date = dayKey(new Date(e.ts).toISOString());
    map.set(date, (map.get(date) || 0) + 1);
  }
  return map;
}

function sumMapRange(map: Map<string, number>, from: string, to: string): number {
  let n = 0;
  for (const [d, c] of map) {
    if (d >= from && d <= to) n += c;
  }
  return n;
}

export function analyzeFollowers(file?: FollowerFile): FollowerAnalysis {
  const f = seedFromHistory(file ? { ...file, points: file.points.slice() } : loadFile());
  const points = f.points;
  const latest = points[points.length - 1] || f.last || null;
  const byDate = new Map(points.map((p) => [p.date, p]));
  const calendarToday = dayKey();
  const byFollows = followEventsByDay();
  const followsToday = byFollows.get(calendarToday) || 0;
  const follows7d = sumMapRange(byFollows, shiftDate(calendarToday, -6), calendarToday);

  const displayPoints: FollowerPoint[] = points.slice();
  if (latest && latest.date < calendarToday) {
    displayPoints.push({
      date: calendarToday,
      scrapedAt: new Date().toISOString(),
      count: latest.count,
      source: "pending",
    });
  }

  const series: FollowerSeriesPoint[] = displayPoints.map((p, i) => ({
    date: p.date,
    count: p.count,
    delta: i === 0 ? 0 : p.count - displayPoints[i - 1]!.count,
    follows: byFollows.get(p.date) || 0,
    projected: p.source === "pending",
  }));

  // Trailing stall: JuicyChat total didn't tick but named follow events did.
  let stallFrom = series.length;
  for (let i = series.length - 1; i >= 1; i--) {
    if (series[i]!.delta !== 0) break;
    stallFrom = i;
  }
  let pendingFollows = 0;
  if (stallFrom < series.length) {
    for (let i = stallFrom; i < series.length; i++) {
      const row = series[i]!;
      const inflow = row.follows || 0;
      if (inflow <= 0) continue;
      const prevCount = i > 0 ? series[i - 1]!.count : row.count;
      row.delta = inflow;
      row.count = prevCount + inflow;
      row.projected = true;
      pendingFollows += inflow;
    }
  }

  const last = series[series.length - 1] || null;
  const dailyDelta = last?.date === calendarToday ? last.delta : followsToday;
  const dailyDeltaSource: "api" | "follows" =
    last?.projected && (last.delta || 0) !== 0 ? "follows" : "api";

  const weekKey = shiftDate(calendarToday, -7);
  const monthKey = shiftDate(calendarToday, -30);
  const weekPt = findOnOrBefore(points, weekKey);
  const monthPt = findOnOrBefore(points, monthKey);
  let weeklyDelta = latest && weekPt ? latest.count - weekPt.count : null;
  let monthlyDelta = latest && monthPt ? latest.count - monthPt.count : null;
  if (pendingFollows > 0) {
    if (weeklyDelta != null) weeklyDelta += pendingFollows;
    if (monthlyDelta != null) monthlyDelta += pendingFollows;
  }

  const picked = pickBestCount(f.sources || {}, latest?.count ?? byDate.get(calendarToday)?.count ?? null);
  const count = picked.count;

  return {
    scrapedAt: latest?.scrapedAt ?? null,
    count,
    source: picked.source ?? latest?.source ?? null,
    sources: f.sources || {},
    dailyDelta,
    weeklyDelta,
    monthlyDelta,
    velocityPerDay:
      weeklyDelta != null ? Math.round((weeklyDelta / 7) * 10) / 10 : dailyDelta,
    dailyDeltaSource,
    pendingFollows,
    series,
    follows1d: followsToday,
    follows7d,
    sample: f.sample || [],
    warnings: [],
  };
}

function pickBestCount(
  sources: Record<string, number | null>,
  fallback: number | null = null,
): { count: number | null; source: string | null } {
  const order = ["profile", "me", "stats", "listTotal", "infoCount"] as const;
  const agreed = consensusFollowerCount([
    ...order.map((k) => sources[k]),
    fallback,
  ]);
  if (agreed != null) {
    for (const k of order) {
      const n = sources[k];
      if (typeof n === "number" && Math.abs(n - agreed) / Math.max(agreed, 1) <= 0.22) {
        return { count: agreed, source: k };
      }
    }
    return { count: agreed, source: fallback != null ? "point" : "consensus" };
  }
  for (const k of order) {
    const n = sources[k];
    if (typeof n === "number" && Number.isFinite(n) && n >= 0) return { count: n, source: k };
  }
  return { count: fallback, source: fallback != null ? "point" : null };
}

function shiftDate(yyyyMmDd: string, days: number): string {
  const [y, m, d] = yyyyMmDd.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, (m || 1) - 1, d || 1));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function findOnOrBefore(points: FollowerPoint[], date: string): FollowerPoint | null {
  let found: FollowerPoint | null = null;
  for (const p of points) {
    if (p.date <= date) found = p;
    else break;
  }
  return found || points[0] || null;
}

function pickFollower(raw: Record<string, unknown>): FollowerSample | null {
  const row =
    raw.user && typeof raw.user === "object"
      ? { ...raw, ...(raw.user as Record<string, unknown>) }
      : raw;
  const uid = row.userId ?? row.followUserId ?? row.followerUserId ?? row.id;
  if (uid == null) return null;
  return {
    userId: String(uid),
    userName: String(row.userName || row.followUserName || row.name || "user"),
    userAvatar: (row.userAvatar || row.avatar || row.followUserAvatar) as string | undefined,
    followersCount: asInt(row.followersCount) ?? undefined,
    characterCount: asInt(row.characterCount) ?? undefined,
  };
}

function sourceLabel(key: string | null): string {
  if (key === "listTotal") return "followersList.total";
  if (key === "profile") return "getOtherUserInfo";
  if (key === "infoCount") return "getUserInfoCount";
  if (key === "stats") return "statistics";
  if (key === "me") return "getUserInfo";
  if (key === "point") return "history";
  if (key === "consensus") return "consensus";
  return "none";
}

export async function scrapeFollowers(options?: { userId?: string }): Promise<FollowerAnalysis> {
  const warnings: string[] = [];
  const session = loadSession();
  const client = JuicyClient.fromSession(session);
  const sources: Record<string, number | null> = {};
  const sample: FollowerSample[] = [];

  let userId = options?.userId || session?.userId || "";
  try {
    const me = await client.get<Record<string, unknown>>("/yume/api/user/v1/getUserInfo");
    const mid = asInt((me.data as Record<string, unknown> | undefined)?.userId);
    if (!userId && me.data && (me.data as { userId?: string }).userId) {
      userId = String((me.data as { userId: string }).userId);
    }
    sources.me = asInt((me.data as Record<string, unknown> | undefined)?.followersCount);
    void mid;
  } catch (e) {
    warnings.push(`getUserInfo: ${e instanceof Error ? e.message : String(e)}`);
  }

  try {
    const r = await client.post<Record<string, unknown>[]>(
      "/yume/api/user/v1/getUserFollowersList",
      { pageNo: 1, pageSize: 30 },
    );
    const total =
      asInt((r as { total?: unknown }).total) ??
      asInt((r.data as unknown as { total?: unknown } | undefined)?.total);
    sources.listTotal = total;
    const batch = asArray(r.data);
    sources.listPage = batch.length;
    const seen = new Set<string>();
    for (const raw of batch) {
      const row = pickFollower(raw);
      if (row && !seen.has(row.userId)) {
        seen.add(row.userId);
        sample.push(row);
      }
    }
    if (!r.success && r.code !== "200" && total == null) {
      warnings.push(`followersList: ${r.msg || r.code}`);
    }
  } catch (e) {
    warnings.push(`followersList: ${e instanceof Error ? e.message : String(e)}`);
  }

  if (userId) {
    try {
      const p = await client.post<Record<string, unknown>>("/yume/api/user/v1/getOtherUserInfo", {
        userId,
      });
      const d = (p.data || {}) as Record<string, unknown>;
      sources.profile = asInt(d.followersCount) ?? asInt(d.followerCount);
    } catch (e) {
      warnings.push(`getOtherUserInfo: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  try {
    const c = await client.post<Record<string, unknown>>("/yume/api/user/v1/getUserInfoCount", {});
    const d = (c.data || {}) as Record<string, unknown>;
    sources.infoCount =
      asInt(d.followersCount) ?? asInt(d.followerCount) ?? asInt(d.followCount) ?? asInt(d.fansCount);
  } catch (e) {
    warnings.push(`getUserInfoCount: ${e instanceof Error ? e.message : String(e)}`);
  }

  try {
    const st = await client.post<Record<string, unknown>>("/yume/api/user/v1/getUserStatisticsData", {});
    const d = (st.data || {}) as Record<string, unknown>;
    sources.stats = asInt(d.followersCount) ?? asInt(d.followerCount);
  } catch {
    /* optional */
  }

  const picked = pickBestCount(sources);
  const count = picked.count;
  const source = sourceLabel(picked.source);

  if (count != null) {
    recordFollowerPoint(count, source);
    applyFollowerCountToSnapshot(count);
    try {
      const { patchTodayFollowers } = await import("./history");
      patchTodayFollowers(count);
    } catch {
      /* */
    }
  }
  const file = loadFile();
  file.sample = sample;
  file.sources = sources;
  saveFile(file);

  const analysis = analyzeFollowers();
  analysis.warnings = warnings;
  analysis.sample = sample;
  analysis.sources = sources;
  if (count != null) analysis.count = count;
  analysis.source = source === "none" ? analysis.source : source;
  return analysis;
}

export function loadFollowersCached(): FollowerAnalysis {
  return analyzeFollowers();
}
