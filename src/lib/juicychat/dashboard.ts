import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sampleWarehouse from "./sample-warehouse.json";
import { analyzeGrowth, recordAndAnalyze, seedHistoryFromSnapshot, dayKey } from "./history";
import { scrapeCreatorInsights, loadCreatorInsights } from "./insights";
import { analyzeTiming, scrapeNotifications, loadNotifStore } from "./notifications";
import { dataPath, ensureDataDir } from "./paths";
import { analyzePublishTiming } from "./publish-analysis";
import { buildCompare, loadRivals, sanitizeRivalSnapshot, syncNeighborRoster } from "./rivals";
import { scrapeLounge } from "./scrape";
import { JuicyClient } from "./client";
import { loadSession } from "./session";
import {
  headlineRanks,
  scrapeDeepSignals,
  type DeepSignals,
  type LeaderboardBoard,
  type TagCompetition,
} from "./deep-signals";
import type { GrowthAnalysis, LoungeSnapshot } from "./types";
import type { CreatorInsights } from "./insights";
import type { TimingAnalysis } from "./notifications";
import type { PublishAnalysis } from "./publish-analysis";
import type { RivalCompareResult, RivalsFile } from "./rivals";
import { repairLoungeFiles, repairSnapshot } from "./repair";
import { loadFollowersCached } from "./followers";
import { ingestForensicsIfStale } from "./forensics";
import { loadEconomyLast, patchBotsFromEconomy, type EconomySnapshot } from "./economy";
import { deriveCommentPulse, type CommentPulseComment } from "./comment-pulse";
import { deriveTagCompetition, rivalBotsFromEntries } from "./tag-competition";
import { analyzeExposure, type ExposureReport, type ExposureStatus } from "./exposure";
import { persistAudit15, buildBriefing, type CreatorBriefing } from "./briefing";
import {
  buildDashboardSignals,
  emptyDashboardSignals,
  type DashboardSignals,
} from "./dashboard-signals";
import { buildTagForensics, emptyTagForensics, type TagForensics } from "./tag-forensics";

export type CreatorDashboard = {
  scrapedAt: string;
  snapshot: LoungeSnapshot | null;
  growth: GrowthAnalysis;
  deep: DeepSignals | null;
  insights: CreatorInsights | null;
  timing: TimingAnalysis | null;
  publish: PublishAnalysis | null;
  rivals: { file: RivalsFile; compare: RivalCompareResult };
  economy: EconomySnapshot | null;
  briefing?: CreatorBriefing | null;
  signals?: DashboardSignals;
  tagForensics?: TagForensics | null;
  warnings: string[];
  source: "live" | "cache" | "partial";
};

const DASH_FILE = "creator-dashboard.json";
const RANK_FILE = "creator-ranklist.json";
const TAG_FILE = "tag-competition.json";

/** Load the anonymous sample warehouse when this install has no lounge data yet. */
export function seedSampleWarehouseIfEmpty(): void {
  try {
    if (existsSync(dataPath("last-snapshot.json"))) return;
    const raw = sampleWarehouse as { files?: Record<string, unknown> };
    const files = raw.files && typeof raw.files === "object" ? raw.files : null;
    if (!files) {
      const fixture = join(process.cwd(), "fixtures", "warehouse-sample.json");
      if (!existsSync(fixture)) return;
      const disk = JSON.parse(readFileSync(fixture, "utf8")) as { files?: Record<string, unknown> };
      writeSeedFiles(disk.files || {});
      return;
    }
    writeSeedFiles(files);
  } catch {
    /* sample seed is best-effort */
  }
}

function writeSeedFiles(files: Record<string, unknown>): void {
  ensureDataDir();
  for (const [name, body] of Object.entries(files)) {
    if (!name.endsWith(".json") || name.includes("..") || name.includes("/")) continue;
    writeFileSync(dataPath(name), JSON.stringify(body));
  }
}

type RanklistCache = {
  scrapedAt: string;
  leaderboards: LeaderboardBoard[];
};

export function loadDashboardCache(): CreatorDashboard | null {
  try {
    const p = dataPath(DASH_FILE);
    if (!existsSync(p)) return null;
    const d = JSON.parse(readFileSync(p, "utf8")) as CreatorDashboard;
    if (d.snapshot) d.snapshot = repairSnapshot(d.snapshot) || d.snapshot;
    d.deep = overlayRanklist(d.deep);
    try {
      const file = loadRivals();
      if (file.rivals.length) {
        d.rivals = {
          file,
          compare: buildCompare(d.snapshot, d.snapshot?.userId || d.snapshot?.profile?.userId || null),
        };
      } else if (d.rivals?.file?.rivals?.length) {
        const repaired = {
          ...d.rivals.file,
          rivals: d.rivals.file.rivals.map((r) => {
            if (!r.lastSnapshot) return r;
            const cleaned = sanitizeRivalSnapshot(r.lastSnapshot, r.userId);
            return cleaned ? { ...r, lastSnapshot: cleaned } : r;
          }),
        };
        d.rivals = {
          file: repaired,
          compare: buildCompare(
            d.snapshot,
            d.snapshot?.userId || d.snapshot?.profile?.userId || null,
            repaired,
          ),
        };
      }
    } catch {
      /* */
    }
    return { ...d, source: "cache" };
  } catch {
    return null;
  }
}

function saveDashboardCache(d: CreatorDashboard) {
  try {
    ensureDataDir();
    writeFileSync(dataPath(DASH_FILE), JSON.stringify(d), "utf8");
    if (d.deep?.leaderboards?.length) saveRanklistCache(d.deep.leaderboards, d.deep.scrapedAt);
  } catch {
    /* */
  }
}

export function loadRanklistCache(): RanklistCache | null {
  try {
    const p = dataPath(RANK_FILE);
    if (!existsSync(p)) return null;
    const d = JSON.parse(readFileSync(p, "utf8")) as RanklistCache;
    if (!Array.isArray(d.leaderboards) || !d.leaderboards.length) return null;
    return d;
  } catch {
    return null;
  }
}

export function saveRanklistCache(leaderboards: LeaderboardBoard[], scrapedAt?: string) {
  try {
    ensureDataDir();
    const payload: RanklistCache = {
      scrapedAt: scrapedAt || new Date().toISOString(),
      leaderboards,
    };
    writeFileSync(dataPath(RANK_FILE), JSON.stringify(payload), "utf8");
  } catch {
    /* */
  }
}

function emptyDeepFromBoards(boards: LeaderboardBoard[], scrapedAt: string): DeepSignals {
  const head = headlineRanks(boards);
  return {
    scrapedAt,
    userInfoCount: null,
    botEnrichment: [],
    characterRanks: [],
    ownCharacterRanks: [],
    creatorRanks: boards[0]?.listings?.slice(0, 30) || boards[0]?.top || [],
    yourCreatorRank: head.yourCreatorRank,
    yourBestBoard: head.yourBestBoard,
    leaderboards: boards,
    monthlyNew: [],
    characterBoards: [],
    monthlyCreatorRanks: [],
    tagCompetition: [],
    commentPulse: [],
    quality: {
      avgScore10: null,
      medianChats: null,
      top10ChatShare: null,
      botsWithComments: 0,
      botsRanked: 0,
      engagementRate: null,
    },
    warnings: [],
  };
}

function overlayRanklist(deep: DeepSignals | null): DeepSignals | null {
  const cached = loadRanklistCache();
  if (!cached?.leaderboards?.length) {
    if (!deep) return null;
    const head = headlineRanks(deep.leaderboards || []);
    return { ...deep, yourCreatorRank: head.yourCreatorRank, yourBestBoard: head.yourBestBoard };
  }
  const boardsHaveRows = cached.leaderboards.some((b) => (b.scanned || 0) > 0 || (b.listings || b.top || []).length > 0);
  if (!boardsHaveRows) return deep;
  if (!deep) return emptyDeepFromBoards(cached.leaderboards, cached.scrapedAt);
  const deepEmpty = !deep.leaderboards?.some((b) => (b.scanned || 0) > 0);
  const deepAt = Date.parse(deep.scrapedAt || "");
  const rankAt = Date.parse(cached.scrapedAt || "");
  const rankNewer = Number.isFinite(rankAt) && (!Number.isFinite(deepAt) || rankAt >= deepAt);
  if (deepEmpty || rankNewer) {
    const head = headlineRanks(cached.leaderboards);
    return {
      ...deep,
      scrapedAt: rankNewer ? cached.scrapedAt : deep.scrapedAt,
      leaderboards: cached.leaderboards,
      yourCreatorRank: head.yourCreatorRank,
      yourBestBoard: head.yourBestBoard,
      creatorRanks: cached.leaderboards[0]?.listings?.slice(0, 30) || cached.leaderboards[0]?.top || deep.creatorRanks,
    };
  }
  const head = headlineRanks(deep.leaderboards || []);
  return { ...deep, yourCreatorRank: head.yourCreatorRank, yourBestBoard: head.yourBestBoard };
}

function mergeDeep(prev: DeepSignals | null, next: DeepSignals): DeepSignals {
  if (!prev) return next;
  const pickArr = <T,>(a: T[] | undefined, b: T[] | undefined): T[] =>
    a && a.length ? a : b || [];
  const leaderboards =
    next.leaderboards?.some((b) => (b.scanned || 0) > 0) ? next.leaderboards : prev.leaderboards || [];
  const head = headlineRanks(leaderboards);
  return {
    ...next,
    botEnrichment: pickArr(next.botEnrichment, prev.botEnrichment),
    characterRanks: pickArr(next.characterRanks, prev.characterRanks),
    ownCharacterRanks: pickArr(next.ownCharacterRanks, prev.ownCharacterRanks),
    monthlyNew: pickArr(next.monthlyNew, prev.monthlyNew),
    characterBoards: next.characterBoards?.some((b) => b.own.length)
      ? next.characterBoards
      : prev.characterBoards || [],
    tagCompetition: pickArr(next.tagCompetition, prev.tagCompetition),
    commentPulse: pickArr(next.commentPulse, prev.commentPulse),
    leaderboards,
    yourCreatorRank: head.yourCreatorRank,
    yourBestBoard: head.yourBestBoard,
    creatorRanks: leaderboards[0]?.listings?.slice(0, 30) || leaderboards[0]?.top || next.creatorRanks,
    quality: {
      avgScore10: next.quality?.avgScore10 ?? prev.quality?.avgScore10 ?? null,
      medianChats: next.quality?.medianChats ?? prev.quality?.medianChats ?? null,
      top10ChatShare: next.quality?.top10ChatShare ?? prev.quality?.top10ChatShare ?? null,
      botsWithComments: next.quality?.botsWithComments || prev.quality?.botsWithComments || 0,
      botsRanked: next.quality?.botsRanked || prev.quality?.botsRanked || 0,
      engagementRate: next.quality?.engagementRate ?? prev.quality?.engagementRate ?? null,
    },
    warnings: [...(prev.warnings || []), ...(next.warnings || [])].slice(-40),
  };
}

function loadSnapshotFile(): LoungeSnapshot | null {
  try {
    const path = dataPath("last-snapshot.json");
    if (!existsSync(path)) return null;
    const snap = JSON.parse(readFileSync(path, "utf8")) as LoungeSnapshot;
    return repairSnapshot(snap);
  } catch {
    return null;
  }
}

function persistSnapshot(snapshot: LoungeSnapshot) {
  try {
    ensureDataDir();
    writeFileSync(dataPath("last-snapshot.json"), JSON.stringify(snapshot), "utf8");
  } catch {
    /* */
  }
}

function overlayFollowers(snapshot: LoungeSnapshot | null): LoungeSnapshot | null {
  if (!snapshot) return null;
  try {
    const fol = loadFollowersCached();
    if (fol.count == null) return repairSnapshot(snapshot);
    return repairSnapshot(snapshot, fol.count);
  } catch {
    return repairSnapshot(snapshot);
  }
}

/**
 * Light/ranklist scrapes skip getCommentPage, so commentPulse stays empty
 * unless we rebuild it from the never-pruned notification archive + enrichment.
 */
function attachCommentPulse(
  deep: DeepSignals | null,
  snapshot: LoungeSnapshot | null,
  insights: CreatorInsights | null,
): DeepSignals | null {
  let comments: CommentPulseComment[] = [];
  try {
    comments = loadNotifStore().events.filter((e) => e.kind === "comment");
  } catch {
    comments = [];
  }
  if (!comments.length && insights?.comments?.length) comments = insights.comments;

  const pulse = deriveCommentPulse({
    pulse: deep?.commentPulse,
    enrichment: deep?.botEnrichment,
    comments,
    bots: snapshot?.bots,
    limit: 16,
  });
  if (!pulse.length || !deep) return deep;
  return {
    ...deep,
    commentPulse: pulse,
    quality: {
      ...deep.quality,
      botsWithComments: Math.max(deep.quality?.botsWithComments ?? 0, pulse.length),
    },
  };
}

type TagCache = { scrapedAt: string; tags: TagCompetition[] };

function loadTagCache(): TagCompetition[] {
  try {
    const p = dataPath(TAG_FILE);
    if (!existsSync(p)) return [];
    const raw = JSON.parse(readFileSync(p, "utf8")) as TagCache | TagCompetition[];
    const tags = Array.isArray(raw) ? raw : Array.isArray(raw.tags) ? raw.tags : [];
    return tags.filter((t) => t && typeof t.tag === "string");
  } catch {
    return [];
  }
}

function tagSampleScore(rows: TagCompetition[] | undefined) {
  return (rows || []).reduce((s, t) => s + (t.sampleSize || 0) + (t.topInTag?.length || 0), 0);
}

function persistTagCache(rows: TagCompetition[]) {
  if (!rows.length) return;
  const prev = loadTagCache();
  if (tagSampleScore(rows) === 0 && tagSampleScore(prev) > 0) return;
  try {
    ensureDataDir();
    const payload: TagCache = { scrapedAt: new Date().toISOString(), tags: rows };
    writeFileSync(dataPath(TAG_FILE), JSON.stringify(payload), "utf8");
  } catch {
    /* */
  }
}

export function saveTagCache(rows: TagCompetition[]) {
  persistTagCache(rows);
}

/**
 * Light scrapes used to skip getCharacterListByTag, so the lounge panel
 * stayed empty. Rebuild from snapshot tags + last feed sample + rival spaces.
 */
function attachTagCompetition(
  deep: DeepSignals | null,
  snapshot: LoungeSnapshot | null,
  rivalsFile: RivalsFile | null,
): DeepSignals | null {
  const existing = [
    ...(deep?.tagCompetition || []),
    ...loadTagCache(),
  ];
  const rows = deriveTagCompetition({
    bots: snapshot?.bots,
    enrichment: deep?.botEnrichment,
    existing,
    rivalBots: rivalBotsFromEntries(rivalsFile?.rivals),
    maxTags: 10,
  });
  if (!rows.length) return deep;
  persistTagCache(rows);
  if (!deep) {
    return {
      ...emptyDeepFromBoards([], snapshot?.scrapedAt || new Date().toISOString()),
      tagCompetition: rows,
    };
  }
  return { ...deep, tagCompetition: rows };
}

const EXPOSURE_FILE = "exposure-performance.json";
const EXPOSURE_MAX_DAYS = 400;

type ExposureDay = {
  date: string;
  at: string;
  pool: number;
  listed: number;
  counts: Record<ExposureStatus, number>;
  gems: Array<{ id: string; name: string; ratio: number; lift: number; chats: number }>;
  over: Array<{ id: string; name: string; ratio: number; lift: number; chats: number }>;
  amplified: Array<{ id: string; name: string; ratio: number; chats: number; feeds: string[] }>;
};

type ExposureFile = {
  version: 1;
  timezone: string;
  lastAt: string | null;
  latest: ExposureReport | null;
  days: ExposureDay[];
};

function compactNamed(rows: ExposureReport["gems"]) {
  return rows.slice(0, 24).map((r) => ({
    id: r.characterId,
    name: r.characterName,
    ratio: Number(r.ratio.toFixed(3)),
    lift: Number(r.lift.toFixed(4)),
    chats: r.chats,
  }));
}

function compactAmplified(rows: ExposureReport["amplified"]) {
  return rows.slice(0, 24).map((r) => ({
    id: r.characterId,
    name: r.characterName,
    ratio: Number(r.ratio.toFixed(3)),
    chats: r.chats,
    feeds: r.feeds,
  }));
}

function persistExposure(
  snapshot: LoungeSnapshot | null,
  insights: CreatorInsights | null,
  deepCommentPulse?: { characterId: string; commentsFetched: number; approxTotal: number | null }[] | null,
) {
  if (!snapshot?.bots?.length) return;
  const commentCounts: Record<string, number> = {};
  try {
    for (const e of loadNotifStore().events) {
      if (e.kind !== "comment") continue;
      commentCounts[e.characterId] = (commentCounts[e.characterId] || 0) + 1;
    }
  } catch {
    /* */
  }
  for (const c of deepCommentPulse || []) {
    const n = c.approxTotal ?? c.commentsFetched;
    if (n > (commentCounts[c.characterId] || 0)) commentCounts[c.characterId] = n;
  }
  const report = analyzeExposure({
    bots: snapshot.bots,
    discovery: insights?.discovery,
    botDepth: insights?.botDepth,
    commentCounts,
  });
  if (!report.pool) return;

  let file: ExposureFile = { version: 1, timezone: "Europe/Madrid", lastAt: null, latest: null, days: [] };
  try {
    const p = dataPath(EXPOSURE_FILE);
    if (existsSync(p)) {
      const raw = JSON.parse(readFileSync(p, "utf8")) as ExposureFile;
      if (raw && Array.isArray(raw.days)) file = { ...file, ...raw, days: raw.days };
    }
  } catch {
    /* */
  }

  const date = dayKey(snapshot.scrapedAt || report.analyzedAt);
  const day: ExposureDay = {
    date,
    at: report.analyzedAt,
    pool: report.pool,
    listed: report.listed,
    counts: report.counts,
    gems: compactNamed(report.gems),
    over: compactNamed(report.overperformers),
    amplified: compactAmplified(report.amplified),
  };
  const days = file.days.filter((d) => d.date !== date);
  days.push(day);
  days.sort((a, b) => a.date.localeCompare(b.date));
  file = {
    version: 1,
    timezone: "Europe/Madrid",
    lastAt: report.analyzedAt,
    latest: report,
    days: days.slice(-EXPOSURE_MAX_DAYS),
  };
  ensureDataDir();
  writeFileSync(dataPath(EXPOSURE_FILE), JSON.stringify(file), "utf8");
}

function attachBriefing(d: CreatorDashboard): CreatorDashboard {
  try {
    persistAudit15(d.snapshot);
  } catch {
    /* clock history must not break the lounge */
  }
  try {
    d.briefing = buildBriefing({ snapshot: d.snapshot, growth: d.growth });
  } catch {
    d.briefing = d.briefing ?? null;
  }
  try {
    d.signals = buildDashboardSignals({
      snapshot: d.snapshot,
      economy: d.economy,
      rivals: d.rivals?.file ?? null,
    });
  } catch {
    d.signals = d.signals ?? emptyDashboardSignals();
  }
  try {
    d.tagForensics = buildTagForensics({
      snapshot: d.snapshot,
      timing: d.timing,
    });
  } catch {
    d.tagForensics = d.tagForensics ?? emptyTagForensics();
  }
  return d;
}

export async function buildCreatorDashboard(options?: {
  userId?: string;
  full?: boolean;
  refreshLounge?: boolean;
  refreshDeep?: boolean;
  refreshInsights?: boolean;
  refreshTiming?: boolean;
  deepOverride?: DeepSignals | null;
}): Promise<CreatorDashboard> {
  repairLoungeFiles();
  const warnings: string[] = [];
  const session = loadSession();
  const cached = loadDashboardCache();
  let userId = options?.userId || session?.userId || "";
  if (!userId) {
    userId = loadSnapshotFile()?.userId || loadSnapshotFile()?.profile?.userId || "";
  }
  const full = options?.full !== false;

  let snapshot = loadSnapshotFile();
  let growth = analyzeGrowth();

  if (options?.refreshLounge !== false && userId) {
    try {
      snapshot = await scrapeLounge({ userId, forceAuth: true });
      persistSnapshot(snapshot);
      growth = recordAndAnalyze(snapshot);
    } catch (e) {
      warnings.push(`lounge: ${e instanceof Error ? e.message : String(e)}`);
      if (snapshot) seedHistoryFromSnapshot(snapshot);
      growth = analyzeGrowth();
    }
  } else if (snapshot) {
    seedHistoryFromSnapshot(snapshot);
    growth = analyzeGrowth();
  }

  snapshot = overlayFollowers(snapshot);
  if (snapshot) persistSnapshot(snapshot);

  let economy: EconomySnapshot | null = loadEconomyLast();
  if (snapshot?.bots?.length) {
    patchBotsFromEconomy(snapshot.bots, economy);
    persistSnapshot(snapshot);
  }

  const client = JuicyClient.fromSession(loadSession());
  const youUserId =
    snapshot?.profile?.userId ||
    snapshot?.userId ||
    session?.userId ||
    null;

  let deep: DeepSignals | null = overlayRanklist(cached?.deep ?? null);
  if (options?.deepOverride) {
    deep = mergeDeep(deep, options.deepOverride);
    if (deep.leaderboards?.length) saveRanklistCache(deep.leaderboards, deep.scrapedAt);
  }
  if (options?.refreshDeep !== false && snapshot?.bots?.length) {
    try {
      const fresh = await scrapeDeepSignals(client, {
        bots: snapshot.bots,
        youUserId,
        youName: snapshot?.profile?.userName || session?.userName || null,
        light: !full,
      });
      warnings.push(...fresh.warnings);
      deep = mergeDeep(deep, fresh);
      if (deep.leaderboards?.length) saveRanklistCache(deep.leaderboards, deep.scrapedAt);
    } catch (e) {
      warnings.push(`deep: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  let insights: CreatorInsights | null = loadCreatorInsights() ?? cached?.insights ?? null;
  if (options?.refreshInsights !== false && snapshot?.authenticated) {
    try {
      insights = await scrapeCreatorInsights();
      warnings.push(...(insights.warnings || []));
    } catch (e) {
      warnings.push(`insights: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  let timing: TimingAnalysis | null = null;
  if (options?.refreshTiming !== false && snapshot?.authenticated) {
    try {
      await scrapeNotifications({ lookbackDays: 30, maxPages: full ? 40 : 15 });
      timing = analyzeTiming();
    } catch (e) {
      warnings.push(`timing: ${e instanceof Error ? e.message : String(e)}`);
      try {
        timing = analyzeTiming();
      } catch {
        /* */
      }
    }
  } else {
    try {
      timing = analyzeTiming();
    } catch {
      /* */
    }
  }

  const publish = snapshot?.bots?.length
    ? analyzePublishTiming(snapshot)
    : null;

  try {
    const board = deep?.leaderboards?.find((b) => b.id === "c_30d_all") ?? null;
    syncNeighborRoster({ board, youUserId });
  } catch {
    /* auto-neighbors are best-effort */
  }
  const rivalsFile = loadRivals();
  const rivals = {
    file: rivalsFile,
    compare: buildCompare(snapshot, youUserId),
  };

  deep = attachCommentPulse(deep, snapshot, insights);
  deep = attachTagCompetition(deep, snapshot, rivalsFile);
  try {
    persistExposure(snapshot, insights, deep?.commentPulse);
  } catch (e) {
    warnings.push(`exposure: ${e instanceof Error ? e.message : String(e)}`);
  }

  const dash: CreatorDashboard = {
    scrapedAt: snapshot?.scrapedAt || new Date().toISOString(),
    snapshot,
    growth,
    deep,
    insights,
    timing,
    publish,
    rivals,
    economy,
    briefing: null,
    warnings,
    source: options?.refreshLounge === false && options?.refreshDeep === false && !options?.deepOverride ? "partial" : "live",
  };
  attachBriefing(dash);
  saveDashboardCache(dash);
  try {
    ingestForensicsIfStale({
      snapshot,
      deep,
      insights,
      timing,
      publish,
      economy,
    });
  } catch (e) {
    warnings.push(`forensics: ${e instanceof Error ? e.message : String(e)}`);
  }
  return dash;
}

export function getCachedOrEmptyDashboard(): CreatorDashboard {
  seedSampleWarehouseIfEmpty();
  repairLoungeFiles();
  const snapshot = overlayFollowers(loadSnapshotFile());
  try {
    syncNeighborRoster({
      youUserId: snapshot?.userId || snapshot?.profile?.userId || null,
    });
  } catch {
    /* */
  }
  const economy: EconomySnapshot | null = loadEconomyLast();
  if (snapshot?.bots?.length) patchBotsFromEconomy(snapshot.bots, economy);
  const cached = loadDashboardCache();
  if (cached) {
    if (snapshot) {
      cached.snapshot = snapshot;
      const snapAt = Date.parse(snapshot.scrapedAt || "");
      const cacheAt = Date.parse(cached.scrapedAt || "");
      if (Number.isFinite(snapAt) && (!Number.isFinite(cacheAt) || snapAt > cacheAt)) {
        cached.scrapedAt = snapshot.scrapedAt;
      }
      cached.growth = analyzeGrowth();
    }
    cached.deep = overlayRanklist(cached.deep);
    if (!cached.insights) cached.insights = loadCreatorInsights();
    cached.economy = economy ?? cached.economy ?? null;
    const pulseScore = (p: { commentsFetched?: number; approxTotal?: number | null }[] | undefined) =>
      (p || []).reduce((s, c) => s + (c.commentsFetched || 0) + (c.approxTotal || 0), 0);
    const pulseBefore = pulseScore(cached.deep?.commentPulse);
    const tagBefore = cached.deep?.tagCompetition?.length || 0;
    cached.deep = attachCommentPulse(cached.deep, snapshot ?? cached.snapshot, cached.insights);
    cached.deep = attachTagCompetition(
      cached.deep,
      snapshot ?? cached.snapshot,
      cached.rivals?.file ?? loadRivals(),
    );
    if (
      pulseScore(cached.deep?.commentPulse) > pulseBefore ||
      (cached.deep?.tagCompetition?.length || 0) > tagBefore
    ) {
      try {
        saveDashboardCache(cached);
      } catch {
        /* */
      }
    }
    try {
      persistExposure(snapshot ?? cached.snapshot, cached.insights, cached.deep?.commentPulse);
    } catch {
      /* derived metric must not break the lounge */
    }
    try {
      ingestForensicsIfStale({
        snapshot,
        deep: cached.deep,
        insights: cached.insights,
        timing: cached.timing,
        publish: cached.publish,
        economy: cached.economy,
      });
    } catch {
      /* archive must not break the lounge */
    }
    return attachBriefing(cached);
  }
  if (snapshot) seedHistoryFromSnapshot(snapshot);
  const rank = loadRanklistCache();
  const insights = loadCreatorInsights();
  const rivalsFile = loadRivals();
  let deep: DeepSignals | null = rank?.leaderboards?.length
    ? emptyDeepFromBoards(rank.leaderboards, rank.scrapedAt)
    : null;
  deep = attachCommentPulse(deep, snapshot, insights);
  deep = attachTagCompetition(deep, snapshot, rivalsFile);
  try {
    persistExposure(snapshot, insights, deep?.commentPulse);
  } catch {
    /* */
  }
  return attachBriefing({
    scrapedAt: snapshot?.scrapedAt || rank?.scrapedAt || new Date().toISOString(),
    snapshot,
    growth: analyzeGrowth(),
    deep,
    insights,
    timing: null,
    publish: snapshot?.bots?.length ? analyzePublishTiming(snapshot) : null,
    rivals: {
      file: rivalsFile,
      compare: buildCompare(snapshot, snapshot?.userId || null),
    },
    economy,
    briefing: null,
    warnings: [],
    source: "cache",
  });
}
