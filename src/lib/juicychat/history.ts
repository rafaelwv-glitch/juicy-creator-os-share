import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type {
  BotGrowthRow,
  GrowthAnalysis,
  GrowthDelta,
  HistoryDay,
  HistoryFile,
  LoungeSnapshot,
  MetricTotals,
} from "./types";
import { liftBaseImmersive } from "./types";
import { currentLoungeUserId, dataPath, ensureDataDir } from "./paths";
import { repairHistory } from "./repair";

const MAX_DAYS = 400;
const TZ = "Europe/Madrid";

function historyPath() {
  return dataPath("growth-history.json");
}

/** Calendar date YYYY-MM-DD in Europe/Madrid */
export function dayKey(iso: string | Date = new Date()): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function emptyDelta(): GrowthDelta {
  return { chats: 0, likes: 0, favorites: 0, interactions: 0, followers: 0, bots: 0 };
}

function totalsFromSnapshot(snap: LoungeSnapshot): MetricTotals {
  const chats = snap.totals?.chats ?? 0;
  const likes = snap.totals?.likes ?? 0;
  const favorites = snap.totals?.favorites ?? 0;
  return {
    chats,
    likes,
    favorites,
    interactions: snap.totals?.interactions ?? chats + likes + favorites,
    followers: snap.totals?.followers ?? 0,
    bots: snap.totals?.bots ?? snap.bots?.length ?? 0,
  };
}

function botMetricsFromSnapshot(snap: LoungeSnapshot): HistoryDay["bots"] {
  const out: HistoryDay["bots"] = {};
  for (const b of snap.bots ?? []) {
    if (!b.characterId) continue;
    const chats = b.chatCount ?? 0;
    const likes = b.likeCount ?? 0;
    const favorites = b.favoriteCount ?? 0;
    out[b.characterId] = {
      characterId: b.characterId,
      characterName: b.characterName || "Untitled",
      characterThumb: b.characterThumb || b.characterPhoto,
      chats,
      likes,
      favorites,
      interactions: chats + likes + favorites,
      tags: b.characterTags?.length ? [...b.characterTags] : undefined,
      score10: b.score10,
      score20: b.score20,
      visibility: b.visibility,
      gmtFirstPublish: b.gmtFirstPublish,
      gmtCreate: b.gmtCreate,
      memoryCount: b.memoryCount,
      galleryCount: b.galleryCount,
      genPictureCount: b.genPictureCount,
      shareCount: b.shareCount,
      figureId: b.figureId,
      basePopular: b.basePopular,
      baseTrending: b.baseTrending,
      baseRecent: b.baseRecent,
      baseEditor: b.baseEditor,
      baseImmersive: liftBaseImmersive(b),
      extrasKeys: b.extras ? Object.keys(b.extras) : undefined,
    };
  }
  return out;
}

function dayFromSnapshot(snap: LoungeSnapshot): HistoryDay {
  return {
    date: dayKey(snap.scrapedAt || new Date().toISOString()),
    scrapedAt: snap.scrapedAt || new Date().toISOString(),
    totals: totalsFromSnapshot(snap),
    bots: botMetricsFromSnapshot(snap),
  };
}

function subtractTotals(a: MetricTotals, b: MetricTotals): GrowthDelta {
  return {
    chats: a.chats - b.chats,
    likes: a.likes - b.likes,
    favorites: a.favorites - b.favorites,
    interactions: a.interactions - b.interactions,
    followers: a.followers - b.followers,
    bots: a.bots - b.bots,
  };
}

function subtractBot(
  a: HistoryDay["bots"][string] | undefined,
  b: HistoryDay["bots"][string] | undefined,
): GrowthDelta {
  if (!a) return emptyDelta();
  if (!b) {
    return {
      chats: a.chats,
      likes: a.likes,
      favorites: a.favorites,
      interactions: a.interactions,
      followers: 0,
      bots: 1,
    };
  }
  return {
    chats: a.chats - b.chats,
    likes: a.likes - b.likes,
    favorites: a.favorites - b.favorites,
    interactions: a.interactions - b.interactions,
    followers: 0,
    bots: 0,
  };
}

export function loadHistory(): HistoryFile {
  try {
    if (!existsSync(historyPath())) {
      return { version: 1, timezone: TZ, days: [] };
    }
    const raw = JSON.parse(readFileSync(historyPath(), "utf8")) as HistoryFile;
    if (!raw || !Array.isArray(raw.days)) {
      return { version: 1, timezone: TZ, days: [] };
    }
    return repairHistory({
      version: 1,
      timezone: raw.timezone || TZ,
      days: raw.days,
      lastScrape: raw.lastScrape,
      previousScrape: raw.previousScrape,
    });
  } catch {
    return { version: 1, timezone: TZ, days: [] };
  }
}

function saveHistory(file: HistoryFile) {
  const next = repairHistory(file);
  ensureDataDir();
  writeFileSync(historyPath(), JSON.stringify(next), "utf8");
  const uid = currentLoungeUserId();
  if (uid) {
    void import("./relational")
      .then((m) => m.upsertHistoryDays(uid, next))
      .catch(() => undefined);
  }
}

/**
 * Record a snapshot into daily history.
 * - Upserts today's day (latest scrape wins for end-of-day totals)
 * - Keeps previous scrape for "since last refresh"
 */
export function recordSnapshot(snap: LoungeSnapshot): HistoryFile {
  const file = loadHistory();
  const current = dayFromSnapshot(snap);
  const previousScrape = file.lastScrape;

  const idx = file.days.findIndex((d) => d.date === current.date);
  if (idx >= 0) file.days[idx] = current;
  else file.days.push(current);

  file.days.sort((a, b) => a.date.localeCompare(b.date));
  if (file.days.length > MAX_DAYS) {
    file.days = file.days.slice(file.days.length - MAX_DAYS);
  }

  const toSave: HistoryFile = {
    version: 1,
    timezone: TZ,
    days: file.days,
    lastScrape: current,
    previousScrape:
      previousScrape && previousScrape.scrapedAt !== current.scrapedAt
        ? previousScrape
        : file.previousScrape,
  };
  saveHistory(toSave);
  return loadHistory();
}

/** Seed history from existing last-snapshot if empty (baseline only). */
export function seedHistoryFromSnapshot(snap: LoungeSnapshot | null | undefined): HistoryFile {
  const file = loadHistory();
  if (file.days.length > 0 || !snap?.bots?.length) return file;
  return recordSnapshot(snap);
}

function botGrowthRows(
  latest: HistoryDay,
  baseline: HistoryDay | null,
  baseline7: HistoryDay | null,
): BotGrowthRow[] {
  const ids = new Set(Object.keys(latest.bots));
  const rows: BotGrowthRow[] = [];
  for (const id of ids) {
    const cur = latest.bots[id];
    if (!cur) continue;
    const dod = baseline ? subtractBot(cur, baseline.bots[id]) : null;
    const d7 = baseline7 ? subtractBot(cur, baseline7.bots[id]) : null;
    rows.push({
      characterId: cur.characterId,
      characterName: cur.characterName,
      characterThumb: cur.characterThumb,
      current: {
        chats: cur.chats,
        likes: cur.likes,
        favorites: cur.favorites,
        interactions: cur.interactions,
      },
      dayOverDay: dod,
      last7Days: d7,
      sinceLastRefresh: null,
    });
  }
  return rows;
}

export function analyzeGrowth(file?: HistoryFile): GrowthAnalysis {
  const hist = file ?? loadHistory();
  const days = hist.days;
  const latest = days[days.length - 1] ?? hist.lastScrape ?? null;
  const previousDay = days.length >= 2 ? days[days.length - 2]! : null;
  const day7Idx = Math.max(0, days.length - 7);
  const day7 = days.length >= 2 ? days[day7Idx]! : null;
  const previousScrape = hist.previousScrape ?? previousDay;

  const dayOverDay =
    latest && previousDay ? subtractTotals(latest.totals, previousDay.totals) : null;

  const sinceLastRefresh =
    latest && previousScrape && previousScrape.scrapedAt !== latest.scrapedAt
      ? subtractTotals(latest.totals, previousScrape.totals)
      : null;

  const last7Days =
    latest && day7 && days.length >= 2
      ? subtractTotals(latest.totals, day7.totals)
      : null;

  const chart = days.map((d) => ({
    date: d.date,
    chats: d.totals.chats,
    likes: d.totals.likes,
    favorites: d.totals.favorites,
    interactions: d.totals.interactions,
    followers: d.totals.followers,
  }));

  const dailyGrowth = days.slice(1).map((d, i) => {
    const prev = days[i]!;
    const delta = subtractTotals(d.totals, prev.totals);
    return {
      date: d.date,
      chats: delta.chats,
      likes: delta.likes,
      favorites: delta.favorites,
      interactions: delta.interactions,
    };
  });

  let botGrowth: BotGrowthRow[] = latest
    ? botGrowthRows(
        latest,
        previousDay,
        day7 && day7.date !== latest.date ? day7 : previousDay,
      )
    : [];

  if (latest && previousScrape && previousScrape.scrapedAt !== latest.scrapedAt) {
    botGrowth = botGrowth.map((row) => ({
      ...row,
      sinceLastRefresh: subtractBot(
        latest.bots[row.characterId],
        previousScrape.bots[row.characterId],
      ),
    }));
  }

  const botCatalog = latest
    ? Object.values(latest.bots)
        .map((b) => ({
          characterId: b.characterId,
          characterName: b.characterName,
          characterThumb: b.characterThumb,
          chats: b.chats,
          likes: b.likes,
          favorites: b.favorites,
          interactions: b.interactions,
        }))
        .sort((a, b) => b.chats - a.chats)
    : [];

  const botTimeline = days.map((d) => ({
    date: d.date,
    bots: Object.fromEntries(
      Object.entries(d.bots).map(([id, b]) => [
        id,
        {
          chats: b.chats,
          likes: b.likes,
          favorites: b.favorites,
          interactions: b.interactions,
        },
      ]),
    ),
  }));

  const gainerSource: "dayOverDay" | "sinceLastRefresh" | "last7Days" = dayOverDay
    ? "dayOverDay"
    : sinceLastRefresh
      ? "sinceLastRefresh"
      : "last7Days";

  const rank = (key: "chats" | "likes" | "interactions") =>
    [...botGrowth]
      .filter((r) => r[gainerSource])
      .sort((a, b) => (b[gainerSource]?.[key] ?? 0) - (a[gainerSource]?.[key] ?? 0))
      .slice(0, 10)
      .map((r) => ({
        characterId: r.characterId,
        characterName: r.characterName,
        characterThumb: r.characterThumb,
        delta: r[gainerSource]![key],
        current: r.current[key],
      }));

  return {
    daysTracked: days.length,
    timezone: hist.timezone || TZ,
    latestDate: latest?.date ?? null,
    previousDate: previousDay?.date ?? null,
    latestScrapedAt: latest?.scrapedAt ?? null,
    previousScrapedAt: previousScrape?.scrapedAt ?? null,
    dayOverDay,
    sinceLastRefresh,
    last7Days,
    chart,
    dailyGrowth,
    botGrowth,
    botCatalog,
    botTimeline,
    topGainers: {
      chats: rank("chats"),
      likes: rank("likes"),
      interactions: rank("interactions"),
      period: gainerSource,
    },
  };
}

export function recordAndAnalyze(snap: LoungeSnapshot): GrowthAnalysis {
  const file = recordSnapshot(snap);
  return analyzeGrowth(file);
}

/** Keep today's stored follower level in sync with a live scrape (never a sum). */
export function patchTodayFollowers(count: number): void {
  if (!Number.isFinite(count) || count < 0) return;
  const file = loadHistory();
  const today = dayKey();
  const n = Math.round(count);
  let changed = false;
  for (const d of file.days) {
    if (d.date !== today) continue;
    if (d.totals.followers === n) continue;
    d.totals.followers = n;
    changed = true;
  }
  if (file.lastScrape?.date === today && file.lastScrape.totals.followers !== n) {
    file.lastScrape.totals.followers = n;
    changed = true;
  }
  if (changed) saveHistory(file);
}
