/**
 * Creator "stalker" mode — co-track rival lounges and compare public stats.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dataPath, ensureDataDir } from "./paths";
import { scrapeLounge } from "./scrape";
import type { JuicyBot, LoungeSnapshot, MetricTotals } from "./types";
import { liftBaseImmersive } from "./types";
import type { LeaderboardBoard } from "./deep-signals";
import {
  analyzeRivalMrt,
  compactRivalMrtDay,
  pairMrtFromSnapshots,
  pickNeighbors,
  type RivalMrt,
  type RivalMrtDay,
  type RivalRankSeed,
  type RivalSource,
} from "./rival-mrt";
import { loungeTimezone } from "./timezone-server";

export const RIVALS_FILE = "rivals-track.json";
export const MAX_MANUAL = 12;
export const MAX_RIVALS = 24;
export const NEIGHBOR_N = 3;
export const MAX_MRT_LOG = 90;
export const MAX_ALUMNI = 80;

export type { RivalMrt, RivalMrtDay, RivalRankSeed, RivalSource } from "./rival-mrt";
export { pickNeighbors, compactRivalMrtDay, pairMrtFromSnapshots } from "./rival-mrt";

export type RivalTotals = {
  bots: number;
  chats: number;
  likes: number;
  favorites: number;
  followers: number;
  interactions: number;
};

export type RivalDay = {
  date: string; // YYYY-MM-DD lounge timezone
  scrapedAt: string;
  totals: RivalTotals;
  rank30d?: number | null;
  launches30?: number | null;
};

export type RivalEntry = {
  userId: string;
  userName: string;
  userAvatar?: string;
  userNo?: string;
  label?: string;
  addedAt: string;
  lastScrapedAt: string | null;
  lastSnapshot: LoungeSnapshot | null;
  history: RivalDay[];
  warnings: string[];
  /** Missing source on old files = manual (persistent). */
  source?: RivalSource;
  neighborRank?: number | null;
  boardRanks?: Partial<Record<string, number | null>>;
  rankSeed?: RivalRankSeed | null;
  mrt?: RivalMrt | null;
  /** Daily compact MRT — never overwrite; 90 days. */
  mrtLog?: RivalMrtDay[];
};

export type RivalsFile = {
  version: 1 | 2;
  timezone: string;
  rivals: RivalEntry[];
  /** Dropped auto-neighbours keep their MRT/history here for the warehouse. */
  alumni?: RivalEntry[];
  skippedNeighborIds?: string[];
  neighborSyncedAt?: string | null;
};

export type RivalCompareRow = {
  userId: string;
  userName: string;
  userAvatar?: string;
  isYou: boolean;
  totals: RivalTotals;
  dayOverDay: RivalTotals | null;
  last7Days: RivalTotals | null;
  topBot: { name: string; chats: number } | null;
  lastScrapedAt: string | null;
  botsPublic: number;
  ageNewestDays: number | null;
  source?: RivalSource | "you";
  rank30d?: number | null;
  launches30?: number | null;
  cadence?: RivalMrt["launch"]["cadence"] | null;
  overlapN?: number | null;
  overlapTags?: string[];
  bestSlot?: string | null;
};

export type RivalCompareResult = {
  timezone: string;
  comparedAt: string;
  rows: RivalCompareRow[];
  youUserId: string | null;
  neighbors?: ReturnType<typeof pickNeighbors>;
  /** Warehouse-backed MRT for the signed-in lounge — never scraped as a rival. */
  youMrt: RivalMrt | null;
};

export type TrackedCreatorRef = {
  userId: string;
  userName: string;
  isYou: boolean;
  source?: RivalSource | "you" | "alumni";
  rank30d?: number | null;
  hasSnapshot: boolean;
  hasMrt: boolean;
};

export type PairCompareResult = {
  leftId: string;
  rightId: string;
  leftName: string;
  rightName: string;
  leftIsYou: boolean;
  rightIsYou: boolean;
  leftMrt: RivalMrt | null;
  rightMrt: RivalMrt | null;
  same: boolean;
};


function rivalsPath() {
  return dataPath(RIVALS_FILE);
}

function dayKey(iso?: string) {
  const d = iso ? new Date(iso) : new Date();
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: loungeTimezone(),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export function emptyTotals(): RivalTotals {
  return { bots: 0, chats: 0, likes: 0, favorites: 0, followers: 0, interactions: 0 };
}

function botVisibilityCounts(bots: JuicyBot[] | undefined) {
  const list = bots || [];
  return {
    bots: list.length,
    publicBots: list.filter((b) => b.visibility === 2 || b.visibility == null).length,
    unlistedBots: list.filter((b) => b.visibility === 1).length,
    privateBots: list.filter((b) => b.visibility === 0).length,
  };
}

/**
 * Rival snapshots must never carry own-account payloads.
 * `getUserStatisticsData` / `getBenefitSummary` / `getOwnUserCharacterData`
 * take no userId — they always return the logged-in lounge.
 */
export function sanitizeRivalSnapshot(
  snap: LoungeSnapshot | null | undefined,
  rivalUserId?: string,
): LoungeSnapshot | null {
  if (!snap) return null;
  const want = rivalUserId || snap.userId;
  let profile = snap.profile;
  if (profile?.userId && want && String(profile.userId) !== String(want)) {
    profile = null;
  }
  const bots = Array.isArray(snap.bots) ? snap.bots : [];
  const vis = botVisibilityCounts(bots);
  const chatsFromBots = bots.reduce((s, b) => s + (b.chatCount ?? 0), 0);
  const likesFromBots = bots.reduce((s, b) => s + (b.likeCount ?? 0), 0);
  const favFromBots = bots.reduce((s, b) => s + (b.favoriteCount ?? 0), 0);
  const chats = profile?.chatCount ?? chatsFromBots;
  const likes = profile?.likeCount ?? likesFromBots;
  const favorites = profile?.favoriteCount ?? favFromBots;
  const followers = profile?.followersCount ?? 0;
  return {
    ...snap,
    authenticated: false,
    userId: want || snap.userId,
    profile,
    stats: null,
    benefit: null,
    ownCharacterData: null,
    bots,
    totals: {
      bots: vis.bots,
      publicBots: vis.publicBots,
      unlistedBots: vis.unlistedBots,
      privateBots: vis.privateBots,
      chats,
      likes,
      favorites,
      followers,
      interactions: chats + likes + favorites,
    },
  };
}

function rivalSnapshotDirty(snap: LoungeSnapshot, rivalUserId?: string): boolean {
  if (snap.stats != null || snap.benefit != null || snap.ownCharacterData != null) return true;
  if (snap.authenticated) return true;
  if (rivalUserId && snap.profile?.userId && String(snap.profile.userId) !== String(rivalUserId)) {
    return true;
  }
  const p = snap.profile;
  if (p?.followersCount != null && snap.totals?.followers !== p.followersCount) return true;
  if (p?.chatCount != null && snap.totals?.chats !== p.chatCount) return true;
  return false;
}

export function totalsFromSnapshot(snap: LoungeSnapshot): RivalTotals {
  const p = snap.profile;
  const t = snap.totals || ({} as MetricTotals);
  const chats = p?.chatCount ?? t.chats ?? 0;
  const likes = p?.likeCount ?? t.likes ?? 0;
  const favorites = p?.favoriteCount ?? t.favorites ?? 0;
  const followers = p?.followersCount ?? t.followers ?? 0;
  return {
    bots: t.bots ?? snap.bots?.length ?? 0,
    chats,
    likes,
    favorites,
    followers,
    interactions: chats + likes + favorites,
  };
}

export function subtractTotals(a: RivalTotals, b: RivalTotals): RivalTotals {
  return {
    bots: a.bots - b.bots,
    chats: a.chats - b.chats,
    likes: a.likes - b.likes,
    favorites: a.favorites - b.favorites,
    followers: a.followers - b.followers,
    interactions: a.interactions - b.interactions,
  };
}

function normalizeEntry(r: RivalEntry): RivalEntry {
  return {
    ...r,
    source: r.source === "neighbor" ? "neighbor" : "manual",
    history: Array.isArray(r.history) ? r.history : [],
    warnings: Array.isArray(r.warnings) ? r.warnings : [],
    mrtLog: Array.isArray(r.mrtLog) ? r.mrtLog : [],
  };
}

export function loadRivals(): RivalsFile {
  try {
    if (!existsSync(rivalsPath())) {
      return { version: 2, timezone: loungeTimezone(), rivals: [], alumni: [], skippedNeighborIds: [] };
    }
    const raw = JSON.parse(readFileSync(rivalsPath(), "utf8")) as RivalsFile;
    const rivals = (Array.isArray(raw.rivals) ? raw.rivals : []).map(normalizeEntry);
    let dirty = false;
    const repaired = rivals.map((entry) => {
      const snap = entry.lastSnapshot;
      if (!snap || !rivalSnapshotDirty(snap, entry.userId)) return entry;
      const cleaned = sanitizeRivalSnapshot(snap, entry.userId);
      if (!cleaned) return entry;
      dirty = true;
      const next: RivalEntry = { ...entry, lastSnapshot: cleaned };
      const date = dayKey(cleaned.scrapedAt);
      if (next.history?.length) {
        const row = next.history.find((h) => h.date === date);
        if (row) row.totals = totalsFromSnapshot(cleaned);
      }
      return next;
    });
    const file: RivalsFile = {
      version: 2,
      timezone: raw.timezone || loungeTimezone(),
      rivals: repaired,
      alumni: Array.isArray(raw.alumni) ? raw.alumni.map(normalizeEntry) : [],
      skippedNeighborIds: Array.isArray(raw.skippedNeighborIds) ? raw.skippedNeighborIds : [],
      neighborSyncedAt: raw.neighborSyncedAt ?? null,
    };
    for (const entry of [...file.rivals, ...(file.alumni || [])]) {
      if (!entry.mrt && entry.lastSnapshot) {
        attachMrt(entry, {
          ...entry.lastSnapshot,
          bots: entry.lastSnapshot.bots || [],
        });
        dirty = true;
      }
      if (entry.mrt && !(entry.mrtLog && entry.mrtLog.length)) {
        recordMrtLog(entry);
        dirty = true;
      }
    }
    if (dirty || raw.version !== 2) {
      try {
        saveRivals(file);
      } catch {
        /* */
      }
    }
    return file;
  } catch {
    return { version: 2, timezone: loungeTimezone(), rivals: [], alumni: [], skippedNeighborIds: [] };
  }
}

function saveRivals(file: RivalsFile) {
  ensureDataDir();
  writeFileSync(rivalsPath(), JSON.stringify(file), "utf8");
}

/** Extract creator userId from lounge URL or raw id. */
export function parseLoungeLink(input: string): string {
  const s = String(input || "").trim();
  if (!s) return "";
  if (/^\d{6,}$/.test(s)) return s;
  try {
    const u = new URL(s.startsWith("http") ? s : `https://www.juicychat.ai/${s}`);
    const m =
      u.pathname.match(/userdetailspace\/(\d+)/i) ||
      u.pathname.match(/user\/(\d+)/i) ||
      u.pathname.match(/space\/(\d+)/i) ||
      u.pathname.match(/creator\/(\d+)/i);
    if (m?.[1]) return m[1];
    const q = u.searchParams.get("userId") || u.searchParams.get("id");
    if (q && /^\d+$/.test(q)) return q;
  } catch {
    /* fall through */
  }
  const m2 = s.match(/userdetailspace\/(\d+)/i) || s.match(/(\d{10,})/);
  return m2?.[1] || "";
}

function topBot(bots: JuicyBot[] | undefined) {
  if (!bots?.length) return null;
  const b = [...bots].sort((a, c) => (c.chatCount ?? 0) - (a.chatCount ?? 0))[0]!;
  return { name: b.characterName || "—", chats: b.chatCount ?? 0 };
}

function newestAgeDays(bots: JuicyBot[] | undefined): number | null {
  if (!bots?.length) return null;
  let best: number | null = null;
  const now = Date.now();
  for (const b of bots) {
    const raw = b.gmtFirstPublish ?? b.gmtCreate;
    if (raw == null) continue;
    let n = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isFinite(n) || n <= 0) continue;
    if (n < 1e12) n *= 1000;
    const age = (now - n) / 86_400_000;
    if (best == null || age < best) best = age;
  }
  return best;
}

function recordDay(entry: RivalEntry, snap: LoungeSnapshot, extra?: { rank30d?: number | null; launches30?: number | null }) {
  const day: RivalDay = {
    date: dayKey(snap.scrapedAt),
    scrapedAt: snap.scrapedAt || new Date().toISOString(),
    totals: totalsFromSnapshot(snap),
    rank30d: extra?.rank30d ?? entry.neighborRank ?? entry.mrt?.rank30d ?? null,
    launches30: extra?.launches30 ?? entry.mrt?.launch.last30 ?? null,
  };
  const hist = entry.history.filter((h) => h.date !== day.date);
  hist.push(day);
  hist.sort((a, b) => a.date.localeCompare(b.date));
  entry.history = hist.slice(-90);
}

function recordMrtLog(entry: RivalEntry) {
  if (!entry.mrt) return;
  const date = dayKey(entry.mrt.analyzedAt);
  const row = compactRivalMrtDay(entry.mrt, date);
  const log = (entry.mrtLog || []).filter((d) => d.date !== date);
  log.push(row);
  log.sort((a, b) => a.date.localeCompare(b.date));
  entry.mrtLog = log.slice(-MAX_MRT_LOG);
}

function mergeMrtLog(a: RivalMrtDay[] | undefined, b: RivalMrtDay[] | undefined): RivalMrtDay[] {
  const map = new Map<string, RivalMrtDay>();
  for (const row of [...(a || []), ...(b || [])]) {
    const prev = map.get(row.date);
    if (!prev || (row.analyzedAt || "") >= (prev.analyzedAt || "")) map.set(row.date, row);
  }
  return [...map.values()].sort((x, y) => x.date.localeCompare(y.date)).slice(-MAX_MRT_LOG);
}

function mergeHistory(a: RivalDay[], b: RivalDay[]): RivalDay[] {
  const map = new Map<string, RivalDay>();
  for (const row of [...a, ...b]) {
    const prev = map.get(row.date);
    if (!prev || (row.scrapedAt || "") >= (prev.scrapedAt || "")) map.set(row.date, row);
  }
  return [...map.values()].sort((x, y) => x.date.localeCompare(y.date)).slice(-90);
}

function archiveAlumni(file: RivalsFile, entry: RivalEntry) {
  if (!entry.mrt && !entry.mrtLog?.length && !entry.history.length && !entry.lastSnapshot) return;
  file.alumni = file.alumni || [];
  const i = file.alumni.findIndex((a) => a.userId === entry.userId);
  if (i >= 0) {
    const prev = file.alumni[i]!;
    prev.history = mergeHistory(prev.history || [], entry.history || []);
    prev.mrtLog = mergeMrtLog(prev.mrtLog, entry.mrtLog);
    if (entry.mrt) prev.mrt = entry.mrt;
    if (entry.lastScrapedAt && (!prev.lastScrapedAt || entry.lastScrapedAt >= prev.lastScrapedAt)) {
      prev.lastSnapshot = entry.lastSnapshot;
      prev.lastScrapedAt = entry.lastScrapedAt;
      prev.userName = entry.userName || prev.userName;
      prev.userAvatar = entry.userAvatar || prev.userAvatar;
    }
    prev.warnings = entry.warnings || prev.warnings;
    prev.neighborRank = entry.neighborRank ?? prev.neighborRank;
  } else {
    file.alumni.push({ ...entry });
  }
  if (file.alumni.length > MAX_ALUMNI) {
    file.alumni.sort((x, y) => {
      const nx = (x.mrtLog?.length || 0) + (x.history?.length || 0);
      const ny = (y.mrtLog?.length || 0) + (y.history?.length || 0);
      if (ny !== nx) return ny - nx;
      return (y.lastScrapedAt || "").localeCompare(x.lastScrapedAt || "");
    });
    file.alumni = file.alumni.slice(0, MAX_ALUMNI);
  }
}

function takeAlumni(file: RivalsFile, userId: string): RivalEntry | null {
  const i = file.alumni?.findIndex((a) => a.userId === userId) ?? -1;
  if (i < 0 || !file.alumni) return null;
  const [ent] = file.alumni.splice(i, 1);
  return ent || null;
}

function compactBot(b: JuicyBot): JuicyBot {
  return {
    characterId: b.characterId,
    characterName: b.characterName,
    characterThumb: b.characterThumb,
    characterPhoto: b.characterPhoto,
    introduction: b.introduction ? String(b.introduction).slice(0, 280) : undefined,
    chatCount: b.chatCount,
    likeCount: b.likeCount,
    favoriteCount: b.favoriteCount,
    visibility: b.visibility,
    characterTags: b.characterTags,
    gmtCreate: b.gmtCreate,
    gmtFirstPublish: b.gmtFirstPublish,
    gmtModified: b.gmtModified,
    score10: b.score10,
    score20: b.score20,
    shareCount: b.shareCount,
    galleryCount: b.galleryCount,
    memoryCount: b.memoryCount,
    genPictureCount: b.genPictureCount,
    figureId: b.figureId,
    basePopular: b.basePopular,
    baseTrending: b.baseTrending,
    baseRecent: b.baseRecent,
    baseEditor: b.baseEditor,
    baseImmersive: liftBaseImmersive(b),
    userId: b.userId,
    userName: b.userName,
    rating: b.rating,
    textLength: b.textLength,
    publicDefinition: b.publicDefinition,
  };
}

function selectRivalBots(bots: JuicyBot[]): JuicyBot[] {
  const compact = bots.map(compactBot);
  const keep = new Map<string, JuicyBot>();
  const byChats = [...compact].sort((a, b) => (b.chatCount ?? 0) - (a.chatCount ?? 0));
  for (const b of byChats.slice(0, 100)) keep.set(b.characterId, b);
  const now = Date.now();
  for (const b of compact) {
    const raw = b.gmtFirstPublish ?? b.gmtCreate;
    if (raw == null) continue;
    let n = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isFinite(n) || n <= 0) continue;
    if (n < 1e12) n *= 1000;
    if ((now - n) / 86_400_000 <= 120) keep.set(b.characterId, b);
  }
  return [...keep.values()].sort((a, b) => (b.chatCount ?? 0) - (a.chatCount ?? 0));
}

function loadBoardsFromDisk(): LeaderboardBoard[] {
  try {
    const p = dataPath("creator-ranklist.json");
    if (!existsSync(p)) return [];
    const raw = JSON.parse(readFileSync(p, "utf8")) as { leaderboards?: LeaderboardBoard[] };
    return Array.isArray(raw.leaderboards) ? raw.leaderboards : [];
  } catch {
    return [];
  }
}

function loadDiscoveryFromDisk() {
  try {
    const p = dataPath("creator-insights.json");
    if (!existsSync(p)) return null;
    const raw = JSON.parse(readFileSync(p, "utf8")) as { discovery?: RivalMrt extends never ? never : unknown };
    const d = (
      raw as {
        discovery?: {
          feeds?: Array<{
            id: string;
            hits?: Array<{ characterId: string; characterName?: string; rank: number; userId?: string }>;
            allHits?: Array<{ characterId: string; characterName?: string; rank: number; userId?: string }>;
          }>;
        };
      }
    ).discovery;
    return d || null;
  } catch {
    return null;
  }
}

function loadYouSnapshot(): LoungeSnapshot | null {
  try {
    const p = dataPath("last-snapshot.json");
    if (!existsSync(p)) return null;
    return JSON.parse(readFileSync(p, "utf8")) as LoungeSnapshot;
  } catch {
    return null;
  }
}

function boardRanksFor(userId: string, boards: LeaderboardBoard[]): Partial<Record<string, number | null>> {
  const out: Partial<Record<string, number | null>> = {};
  for (const b of boards) {
    const hit = [...(b.aroundYou || []), ...(b.listings || []), ...(b.top || [])].find(
      (h) => h.userId === userId,
    );
    out[b.id] = hit?.rank ?? null;
  }
  return out;
}

function attachMrt(
  entry: RivalEntry,
  snap: LoungeSnapshot,
  extra?: { enrichment?: RivalMrt["enrichment"]; characterRanks30d?: RivalMrt["characterRanks30d"] },
) {
  const boards = loadBoardsFromDisk();
  const you = loadYouSnapshot();
  const days = entry.history;
  const latest = days[days.length - 1];
  const prev = days.length >= 2 ? days[days.length - 2] : null;
  const d7 = days.length >= 2 ? days[Math.max(0, days.length - 7)] : null;
  const dod = latest && prev ? latest.totals.chats - prev.totals.chats : null;
  const d7c = latest && d7 ? latest.totals.chats - d7.totals.chats : null;
  entry.boardRanks = boardRanksFor(entry.userId, boards);
  entry.neighborRank = entry.boardRanks.c_30d_all ?? entry.neighborRank ?? null;
  try {
    entry.mrt = analyzeRivalMrt({
      rival: snap,
      you,
      dodChats: dod,
      d7Chats: d7c,
      boards,
      discovery: loadDiscoveryFromDisk(),
      enrichment: extra?.enrichment,
      characterRanks30d: extra?.characterRanks30d,
      rank30d: entry.neighborRank ?? null,
    });
  } catch {
    /* */
  }
  recordMrtLog(entry);
}

function emptyNeighborEntry(hit: ReturnType<typeof pickNeighbors>["above"][number]): RivalEntry {
  return {
    userId: hit.userId,
    userName: hit.userName || hit.userId,
    addedAt: new Date().toISOString(),
    lastScrapedAt: null,
    lastSnapshot: null,
    history: [],
    warnings: [],
    source: "neighbor",
    neighborRank: hit.rank,
    rankSeed: {
      chats: hit.chatCount,
      likes: hit.likeCount,
      followers: hit.followersCount,
      bots: hit.characterCount,
      score: hit.score,
    },
  };
}

export function syncNeighborRoster(opts?: {
  board?: LeaderboardBoard | null;
  youUserId?: string | null;
}): RivalsFile {
  const file = loadRivals();
  const boards = opts?.board ? [opts.board, ...loadBoardsFromDisk().filter((b) => b.id !== opts.board?.id)] : loadBoardsFromDisk();
  const board = boards.find((b) => b.id === "c_30d_all") || opts?.board || null;
  const pick = pickNeighbors(board, NEIGHBOR_N);
  const wanted = [...pick.above, ...pick.below];
  const wantedIds = new Set(wanted.map((w) => w.userId));
  const skipped = new Set(file.skippedNeighborIds || []);
  const youId = opts?.youUserId || pick.you?.userId || null;

  const kept: RivalEntry[] = [];
  for (const r of file.rivals) {
    if (youId && r.userId === String(youId)) continue;
    if (r.source !== "neighbor") {
      kept.push(r);
      continue;
    }
    if (wantedIds.has(r.userId)) {
      kept.push(r);
      continue;
    }
    archiveAlumni(file, r);
  }
  file.rivals = kept;

  for (const hit of wanted) {
    if (youId && hit.userId === String(youId)) continue;
    if (skipped.has(hit.userId)) continue;
    const existing = file.rivals.find((r) => r.userId === hit.userId);
    if (existing) {
      existing.neighborRank = hit.rank;
      existing.userName = existing.userName || hit.userName;
      existing.rankSeed = {
        chats: hit.chatCount ?? existing.rankSeed?.chats,
        likes: hit.likeCount ?? existing.rankSeed?.likes,
        followers: hit.followersCount ?? existing.rankSeed?.followers,
        bots: hit.characterCount ?? existing.rankSeed?.bots,
        score: hit.score ?? existing.rankSeed?.score,
      };
      if (existing.source !== "manual") existing.source = "neighbor";
    } else {
      const restored = takeAlumni(file, hit.userId);
      if (restored) {
        restored.source = "neighbor";
        restored.neighborRank = hit.rank;
        restored.userName = restored.userName || hit.userName;
        restored.rankSeed = {
          chats: hit.chatCount ?? restored.rankSeed?.chats,
          likes: hit.likeCount ?? restored.rankSeed?.likes,
          followers: hit.followersCount ?? restored.rankSeed?.followers,
          bots: hit.characterCount ?? restored.rankSeed?.bots,
          score: hit.score ?? restored.rankSeed?.score,
        };
        file.rivals.push(restored);
      } else {
        file.rivals.push(emptyNeighborEntry(hit));
      }
    }
  }

  file.neighborSyncedAt = new Date().toISOString();
  saveRivals(file);
  return file;
}

export async function addRival(input: {
  linkOrId: string;
  label?: string;
  scrapeNow?: boolean;
}): Promise<{ entry: RivalEntry; file: RivalsFile }> {
  const userId = parseLoungeLink(input.linkOrId);
  if (!userId) throw new Error("Could not parse a lounge user id from that link.");
  const file = loadRivals();
  file.skippedNeighborIds = (file.skippedNeighborIds || []).filter((id) => id !== userId);
  let entry = file.rivals.find((r) => r.userId === userId);
  if (!entry) {
    const manuals = file.rivals.filter((r) => r.source !== "neighbor").length;
    if (manuals >= MAX_MANUAL) {
      throw new Error(`Max ${MAX_MANUAL} pinned creators — unpin one first.`);
    }
    const restored = takeAlumni(file, userId);
    if (restored) {
      restored.source = "manual";
      if (input.label?.trim()) restored.label = input.label.trim();
      file.rivals.push(restored);
      entry = restored;
    } else {
      entry = {
        userId,
        userName: "",
        label: input.label?.trim() || undefined,
        addedAt: new Date().toISOString(),
        lastScrapedAt: null,
        lastSnapshot: null,
        history: [],
        warnings: [],
        source: "manual",
        mrtLog: [],
      };
      file.rivals.push(entry);
    }
  } else {
    entry.source = "manual";
    if (input.label?.trim()) entry.label = input.label.trim();
  }
  saveRivals(file);
  if (input.scrapeNow !== false) {
    return refreshRival(userId, { enrich: true });
  }
  return { entry, file };
}

export function pinRival(userId: string): RivalsFile {
  const file = loadRivals();
  const entry = file.rivals.find((r) => r.userId === userId);
  if (!entry) throw new Error("Creator not in track list.");
  if (entry.source !== "manual") {
    const manuals = file.rivals.filter((r) => r.source === "manual").length;
    if (manuals >= MAX_MANUAL) throw new Error(`Max ${MAX_MANUAL} pinned creators.`);
  }
  entry.source = "manual";
  file.skippedNeighborIds = (file.skippedNeighborIds || []).filter((id) => id !== userId);
  saveRivals(file);
  return file;
}

export function removeRival(userId: string): RivalsFile {
  const file = loadRivals();
  const entry = file.rivals.find((r) => r.userId === userId);
  file.rivals = file.rivals.filter((r) => r.userId !== userId);
  if (entry) {
    archiveAlumni(file, entry);
    const skipped = new Set(file.skippedNeighborIds || []);
    skipped.add(userId);
    file.skippedNeighborIds = [...skipped];
  }
  saveRivals(file);
  return file;
}

export async function refreshRival(
  userId: string,
  opts?: { enrich?: boolean },
): Promise<{ entry: RivalEntry; file: RivalsFile }> {
  const file = loadRivals();
  const entry = file.rivals.find((r) => r.userId === userId);
  if (!entry) throw new Error("Creator not in track list.");

  const raw = await scrapeLounge({ userId, forceAuth: false });
  const snap = sanitizeRivalSnapshot(raw, userId) ?? raw;
  const fullBots = snap.bots || [];
  const stored: LoungeSnapshot = {
    ...snap,
    bots: selectRivalBots(fullBots),
  };
  entry.lastSnapshot = stored;
  entry.lastScrapedAt = snap.scrapedAt || new Date().toISOString();
  entry.userName = snap.profile?.userName || entry.userName || userId;
  entry.userAvatar = snap.profile?.userAvatar || entry.userAvatar;
  entry.userNo = snap.profile?.userNo || entry.userNo;
  entry.warnings = snap.warnings || [];

  let enrichment: RivalMrt["enrichment"] = entry.mrt?.enrichment || [];
  if (opts?.enrich !== false) {
    try {
      const { JuicyClient } = await import("./client");
      const { loadSession } = await import("./session");
      const { enrichTopBots } = await import("./deep-signals");
      const client = JuicyClient.fromSession(loadSession());
      const warn: string[] = [];
      const rows = await enrichTopBots(client, fullBots, warn, 8);
      enrichment = rows.map((r) => ({
        characterId: r.characterId,
        commentCount: r.commentCount ?? null,
        definitionLen: r.definitionLen ?? null,
        score10: r.detailScore10 ?? null,
        commentSample: r.commentSample ?? null,
        memoryCount: r.memoryCount ?? null,
        galleryCount: r.galleryCount ?? null,
        genPictureCount: r.genPictureCount ?? null,
        shareCount: r.shareCount ?? null,
        hasSceneCard: r.hasSceneCard ?? null,
      }));
      if (warn.length) entry.warnings = [...(entry.warnings || []), ...warn].slice(-20);
    } catch (e) {
      entry.warnings = [
        ...(entry.warnings || []),
        `enrich: ${e instanceof Error ? e.message : String(e)}`,
      ].slice(-20);
    }
  }

  recordDay(entry, snap, {
    rank30d: entry.neighborRank ?? null,
    launches30: null,
  });
  attachMrt(entry, { ...snap, bots: fullBots }, { enrichment });
  const today = entry.history.find((h) => h.date === dayKey(snap.scrapedAt));
  if (today && entry.mrt) {
    today.rank30d = entry.mrt.rank30d ?? today.rank30d;
    today.launches30 = entry.mrt.launch.last30;
  }
  saveRivals(file);
  return { entry, file };
}

async function overlayCharacterRanks(file: RivalsFile): Promise<void> {
  try {
    const { JuicyClient } = await import("./client");
    const { loadSession } = await import("./session");
    const client = JuicyClient.fromSession(loadSession());
    const r = await client.post<Record<string, unknown>[]>(
      "/yume/api/user/v1/character/getCharacterRankingList",
      {
        pageNo: 1,
        pageSize: 100,
        sortName: "chatCount",
        rankingDays: 30,
        unfiltered: 1,
        ruleType: 20,
      },
    );
    if (!r.success && r.code !== "200") return;
    const batch = Array.isArray(r.data) ? r.data : [];
    const byId = new Map<string, { rank: number; name: string; chats: number }>();
    batch.forEach((raw, i) => {
      const id = raw && typeof raw === "object" ? String((raw as { characterId?: unknown }).characterId || "") : "";
      if (!id) return;
      const o = raw as { characterName?: unknown; chatCount?: unknown };
      byId.set(id, {
        rank: i + 1,
        name: String(o.characterName || "Untitled"),
        chats: typeof o.chatCount === "number" ? o.chatCount : 0,
      });
    });
    if (!byId.size) return;
    for (const entry of file.rivals) {
      const hits: RivalMrt["characterRanks30d"] = [];
      for (const b of entry.lastSnapshot?.bots || []) {
        const h = byId.get(b.characterId);
        if (h) hits.push({ characterId: b.characterId, characterName: h.name, rank: h.rank, chats: h.chats });
      }
      hits.sort((a, b) => a.rank - b.rank);
      if (entry.mrt) {
        entry.mrt.characterRanks30d = hits.slice(0, 12);
        recordMrtLog(entry);
      }
    }
  } catch {
    /* optional */
  }
}

export async function refreshAllRivals(opts?: { enrich?: boolean }): Promise<RivalsFile> {
  syncNeighborRoster();
  let file = loadRivals();
  for (const r of file.rivals) {
    try {
      await refreshRival(r.userId, { enrich: opts?.enrich === true });
    } catch (e) {
      const again = loadRivals();
      const ent = again.rivals.find((x) => x.userId === r.userId);
      if (ent) {
        ent.warnings = [e instanceof Error ? e.message : String(e)];
        saveRivals(again);
      }
    }
  }
  file = loadRivals();
  try {
    await overlayCharacterRanks(file);
    saveRivals(file);
  } catch {
    /* */
  }
  return loadRivals();
}

function totalsFromSeed(seed: RivalRankSeed | null | undefined): RivalTotals {
  const chats = seed?.chats ?? 0;
  const likes = seed?.likes ?? 0;
  return {
    bots: seed?.bots ?? 0,
    chats,
    likes,
    favorites: 0,
    followers: seed?.followers ?? 0,
    interactions: chats + likes,
  };
}

function loadGrowthDeltas(): { dayOverDay: RivalTotals | null; last7Days: RivalTotals | null } {
  try {
    const p = dataPath("growth-history.json");
    if (!existsSync(p)) return { dayOverDay: null, last7Days: null };
    const raw = JSON.parse(readFileSync(p, "utf8")) as {
      days?: Array<{ totals?: Partial<RivalTotals> }>;
    };
    const days = Array.isArray(raw.days) ? raw.days : [];
    const asT = (t?: Partial<RivalTotals>): RivalTotals => ({
      bots: t?.bots ?? 0,
      chats: t?.chats ?? 0,
      likes: t?.likes ?? 0,
      favorites: t?.favorites ?? 0,
      followers: t?.followers ?? 0,
      interactions: t?.interactions ?? 0,
    });
    const latest = days[days.length - 1];
    const prev = days.length >= 2 ? days[days.length - 2] : null;
    const d7 = days.length >= 2 ? days[Math.max(0, days.length - 7)] : null;
    return {
      dayOverDay: latest && prev ? subtractTotals(asT(latest.totals), asT(prev.totals)) : null,
      last7Days:
        latest && d7 && days.length >= 2 ? subtractTotals(asT(latest.totals), asT(d7.totals)) : null,
    };
  } catch {
    return { dayOverDay: null, last7Days: null };
  }
}

function youMrtFromWarehouse(
  snap: LoungeSnapshot,
  rank30d: number | null,
  growth: { dayOverDay: RivalTotals | null; last7Days: RivalTotals | null },
): RivalMrt | null {
  try {
    return analyzeRivalMrt({
      rival: snap,
      you: snap,
      dodChats: growth.dayOverDay?.chats ?? null,
      d7Chats: growth.last7Days?.chats ?? null,
      boards: loadBoardsFromDisk(),
      discovery: loadDiscoveryFromDisk(),
      rank30d,
    });
  } catch {
    return null;
  }
}

export function buildCompare(
  youSnapshot?: LoungeSnapshot | null,
  youUserId?: string | null,
  fileArg?: RivalsFile,
): RivalCompareResult {
  const file = fileArg || loadRivals();
  const rows: RivalCompareRow[] = [];
  const youId = youUserId || youSnapshot?.userId || youSnapshot?.profile?.userId || null;
  const board = loadBoardsFromDisk().find((b) => b.id === "c_30d_all") || null;
  const neighbors = pickNeighbors(board, NEIGHBOR_N);
  let youMrt: RivalMrt | null = null;

  if (youSnapshot) {
    const totals = totalsFromSnapshot(youSnapshot);
    const growth = loadGrowthDeltas();
    const rank30d = neighbors.you?.rank ?? board?.yourRank ?? null;
    youMrt = youMrtFromWarehouse(youSnapshot, rank30d, growth);
    rows.push({
      userId: String(youId || youSnapshot.userId || "you"),
      userName: youSnapshot.profile?.userName || "You",
      userAvatar: youSnapshot.profile?.userAvatar,
      isYou: true,
      totals,
      dayOverDay: growth.dayOverDay,
      last7Days: growth.last7Days,
      topBot: topBot(youSnapshot.bots),
      lastScrapedAt: youSnapshot.scrapedAt || null,
      botsPublic: youSnapshot.totals?.publicBots ?? youSnapshot.bots?.length ?? 0,
      ageNewestDays: newestAgeDays(youSnapshot.bots),
      source: "you",
      rank30d,
      launches30: youMrt?.launch.last30 ?? null,
      cadence: youMrt?.launch.cadence ?? null,
      overlapN: null,
      overlapTags: [],
      bestSlot: youMrt?.launch.bestSlot ?? null,
    });
  }

  for (const r of file.rivals) {
    if (youId && r.userId === String(youId)) continue;
    const snap = r.lastSnapshot;
    const totals = snap ? totalsFromSnapshot(snap) : totalsFromSeed(r.rankSeed);
    const days = r.history;
    const latest = days[days.length - 1];
    const prev = days.length >= 2 ? days[days.length - 2] : null;
    const d7 = days.length >= 2 ? days[Math.max(0, days.length - 7)] : null;
    rows.push({
      userId: r.userId,
      userName: r.label || r.userName || r.userId,
      userAvatar: r.userAvatar,
      isYou: false,
      totals,
      dayOverDay: latest && prev ? subtractTotals(latest.totals, prev.totals) : null,
      last7Days: latest && d7 && days.length >= 2 ? subtractTotals(latest.totals, d7.totals) : null,
      topBot: topBot(snap?.bots),
      lastScrapedAt: r.lastScrapedAt,
      botsPublic:
        snap?.totals?.publicBots ??
        snap?.bots?.filter((b) => b.visibility === 2 || b.visibility == null).length ??
        0,
      ageNewestDays: newestAgeDays(snap?.bots),
      source: r.source === "neighbor" ? "neighbor" : "manual",
      rank30d: r.neighborRank ?? r.mrt?.rank30d ?? r.boardRanks?.c_30d_all ?? null,
      launches30: r.mrt?.launch.last30 ?? latest?.launches30 ?? null,
      cadence: r.mrt?.launch.cadence ?? null,
      overlapN: r.mrt?.topics.overlap.length ?? null,
      overlapTags: (r.mrt?.topics.overlap || []).slice(0, 4).map((t) => t.tag),
      bestSlot: r.mrt?.launch.bestSlot ?? null,
    });
  }

  rows.sort((a, b) => {
    const ra = a.rank30d ?? 9_999;
    const rb = b.rank30d ?? 9_999;
    if (ra !== rb) return ra - rb;
    return b.totals.chats - a.totals.chats;
  });

  return {
    timezone: loungeTimezone(),
    comparedAt: new Date().toISOString(),
    rows,
    youUserId: youId ? String(youId) : null,
    neighbors,
    youMrt,
  };
}

function findTrackedEntry(file: RivalsFile, userId: string): RivalEntry | null {
  const id = String(userId);
  return file.rivals.find((r) => r.userId === id) || file.alumni?.find((r) => r.userId === id) || null;
}

function snapshotForCreator(
  userId: string,
  youSnapshot: LoungeSnapshot | null | undefined,
  youId: string | null,
  file: RivalsFile,
): LoungeSnapshot | null {
  const id = String(userId || "");
  if (!id) return null;
  if (youId && id === String(youId) && youSnapshot) return youSnapshot;
  return findTrackedEntry(file, id)?.lastSnapshot || null;
}

function historyDeltas(entry: RivalEntry | null): { dod: number | null; d7: number | null } {
  const days = entry?.history || [];
  const latest = days[days.length - 1];
  const prev = days.length >= 2 ? days[days.length - 2] : null;
  const d7 = days.length >= 2 ? days[Math.max(0, days.length - 7)] : null;
  return {
    dod: latest && prev ? latest.totals.chats - prev.totals.chats : null,
    d7: latest && d7 ? latest.totals.chats - d7.totals.chats : null,
  };
}

function rankForCreator(
  userId: string,
  youId: string | null,
  entry: RivalEntry | null,
): number | null {
  if (youId && String(userId) === String(youId)) {
    const board = loadBoardsFromDisk().find((b) => b.id === "c_30d_all") || null;
    return pickNeighbors(board, NEIGHBOR_N).you?.rank ?? board?.yourRank ?? null;
  }
  return entry?.neighborRank ?? entry?.mrt?.rank30d ?? entry?.boardRanks?.c_30d_all ?? null;
}

function nameForCreator(
  userId: string,
  youSnapshot: LoungeSnapshot | null | undefined,
  youId: string | null,
  entry: RivalEntry | null,
): string {
  if (youId && String(userId) === String(youId)) {
    return youSnapshot?.profile?.userName || entry?.userName || "You";
  }
  return entry?.label || entry?.userName || userId;
}

export function listTrackedCreators(
  youSnapshot?: LoungeSnapshot | null,
  youUserId?: string | null,
  fileArg?: RivalsFile,
): TrackedCreatorRef[] {
  const file = fileArg || loadRivals();
  const compare = buildCompare(youSnapshot, youUserId, file);
  const seen = new Set<string>();
  const refs: TrackedCreatorRef[] = [];
  for (const r of compare.rows) {
    seen.add(r.userId);
    const entry = r.isYou ? null : findTrackedEntry(file, r.userId);
    refs.push({
      userId: r.userId,
      userName: r.userName,
      isYou: r.isYou,
      source: r.source,
      rank30d: r.rank30d,
      hasSnapshot: r.isYou ? Boolean(youSnapshot) : Boolean(entry?.lastSnapshot),
      hasMrt: r.isYou ? Boolean(compare.youMrt) : Boolean(entry?.mrt),
    });
  }
  for (const a of file.alumni || []) {
    if (seen.has(a.userId)) continue;
    refs.push({
      userId: a.userId,
      userName: a.label || a.userName || a.userId,
      isYou: false,
      source: "alumni",
      rank30d: a.neighborRank ?? a.mrt?.rank30d ?? null,
      hasSnapshot: Boolean(a.lastSnapshot),
      hasMrt: Boolean(a.mrt),
    });
  }
  return refs;
}

export function buildPairCompare(
  leftId: string,
  rightId: string,
  youSnapshot?: LoungeSnapshot | null,
  youUserId?: string | null,
  fileArg?: RivalsFile,
): PairCompareResult {
  const file = fileArg || loadRivals();
  const youId = youUserId || youSnapshot?.userId || youSnapshot?.profile?.userId || null;
  const left = String(leftId || "");
  const right = String(rightId || "");
  const leftEntry = findTrackedEntry(file, left);
  const rightEntry = findTrackedEntry(file, right);
  const leftSnap = snapshotForCreator(left, youSnapshot, youId, file);
  const rightSnap = snapshotForCreator(right, youSnapshot, youId, file);
  const leftIsYou = Boolean(youId && left && left === String(youId));
  const rightIsYou = Boolean(youId && right && right === String(youId));
  const boards = loadBoardsFromDisk();
  const discovery = loadDiscoveryFromDisk();
  const leftHist = historyDeltas(leftEntry);
  const rightHist = historyDeltas(rightEntry);
  const youGrowth = leftIsYou || rightIsYou ? loadGrowthDeltas() : null;
  const leftDod = leftIsYou ? youGrowth?.dayOverDay?.chats ?? null : leftHist.dod;
  const leftD7 = leftIsYou ? youGrowth?.last7Days?.chats ?? null : leftHist.d7;
  const rightDod = rightIsYou ? youGrowth?.dayOverDay?.chats ?? null : rightHist.dod;
  const rightD7 = rightIsYou ? youGrowth?.last7Days?.chats ?? null : rightHist.d7;
  const leftRank = rankForCreator(left, youId, leftEntry);
  const rightRank = rankForCreator(right, youId, rightEntry);

  let leftMrt: RivalMrt | null = null;
  let rightMrt: RivalMrt | null = null;
  if (leftSnap && rightSnap) {
    const pair = pairMrtFromSnapshots(leftSnap, rightSnap, {
      leftRank30d: leftRank,
      rightRank30d: rightRank,
      leftDodChats: leftDod,
      leftD7Chats: leftD7,
      rightDodChats: rightDod,
      rightD7Chats: rightD7,
      boards,
      discovery,
    });
    leftMrt = pair.leftMrt;
    rightMrt = pair.rightMrt;
  } else {
    if (leftSnap) {
      leftMrt = analyzeRivalMrt({
        rival: leftSnap,
        you: leftSnap,
        rank30d: leftRank,
        dodChats: leftDod,
        d7Chats: leftD7,
        boards,
        discovery,
      });
    } else if (leftIsYou && youSnapshot) {
      leftMrt = youMrtFromWarehouse(youSnapshot, leftRank, loadGrowthDeltas());
    } else {
      leftMrt = leftEntry?.mrt ?? null;
    }
    if (rightSnap) {
      rightMrt = analyzeRivalMrt({
        rival: rightSnap,
        you: leftSnap,
        rank30d: rightRank,
        dodChats: rightDod,
        d7Chats: rightD7,
        boards,
        discovery,
      });
    } else {
      rightMrt = rightEntry?.mrt ?? null;
    }
  }

  return {
    leftId: left,
    rightId: right,
    leftName: nameForCreator(left, youSnapshot, youId, leftEntry),
    rightName: nameForCreator(right, youSnapshot, youId, rightEntry),
    leftIsYou,
    rightIsYou,
    leftMrt,
    rightMrt,
    same: Boolean(left && right && left === right),
  };
}
