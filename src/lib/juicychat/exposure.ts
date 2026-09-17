/**
 * Exposure-adjusted performance: chat percentile vs discovery percentile.
 * Relative only — we do not claim JuicyChat's ranking formula.
 *
 * expectedChats = roster chat quantile at this bot's discovery percentile
 *   (unlisted bots: median chats of the other unlisted bots).
 * ratio = observed chats / expectedChats
 * lift  = chatPct − exposurePct
 */
import type { JuicyBot } from "./types";
import { liftBaseImmersive } from "./types";

export const EXPOSURE_FEEDS = ["editor", "trending", "immersive", "popular", "recent", "new"] as const;
export type ExposureFeed = (typeof EXPOSURE_FEEDS)[number];

export const FEED_WEIGHT: Record<ExposureFeed, number> = {
  editor: 1.6,
  trending: 1.3,
  immersive: 1.25,
  popular: 1.1,
  recent: 0.8,
  new: 0.7,
};

export type ExposureStatus = "gem" | "over" | "amplified" | "feed-heavy" | "inline" | "hidden";

export const EXPOSURE_LABEL: Record<ExposureStatus, string> = {
  gem: "Underexposed gem",
  over: "Overperformer",
  amplified: "Platform-amplified",
  "feed-heavy": "Feed-heavy",
  inline: "In line",
  hidden: "Hidden",
};

export type ExposureRankMap = Partial<Record<ExposureFeed, number>>;

export type ExposureDiscovery = {
  matrix?: Array<{
    characterId: string;
    ranks?: ExposureRankMap;
    feeds?: string[];
  }>;
  feeds?: Array<{ id: string; scannedCount?: number; apiTotal?: number | null }>;
} | null;

export type ExposureDepth = Array<{
  characterId: string;
  discoveryRanks?: ExposureRankMap;
  score10?: number;
}> | null;

export type ExposureRow = {
  characterId: string;
  characterName: string;
  visibility: number | null;
  chats: number;
  likes: number;
  favorites: number;
  comments: number;
  score10: number | null;
  ageDays: number | null;
  chatsPerDay: number | null;
  attachRate: number;
  exposure: number;
  exposurePct: number;
  chatPct: number;
  scorePct: number;
  attachPct: number;
  qualityPct: number;
  gemScore: number;
  expectedChats: number;
  ratio: number;
  lift: number;
  feeds: ExposureFeed[];
  ranks: ExposureRankMap;
  bestRank: number | null;
  bestFeed: ExposureFeed | null;
  status: ExposureStatus;
};

export type ExposureReport = {
  analyzedAt: string;
  pool: number;
  listed: number;
  scanned: Partial<Record<ExposureFeed, number>>;
  counts: Record<ExposureStatus, number>;
  medianUnexposedChats: number;
  rows: ExposureRow[];
  gems: ExposureRow[];
  overperformers: ExposureRow[];
  amplified: ExposureRow[];
  feedHeavy: ExposureRow[];
};

function isFeed(id: string): id is ExposureFeed {
  return (EXPOSURE_FEEDS as readonly string[]).includes(id);
}

function toMs(v: string | number | null | undefined): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n < 1e12 ? Math.round(n * 1000) : Math.round(n);
}

function ageDays(ms: number | null): number | null {
  if (ms == null) return null;
  return Math.max(0, (Date.now() - ms) / 86_400_000);
}

function percentileBelow(values: number[], v: number): number {
  const n = values.length;
  if (!n) return 0;
  let below = 0;
  for (const x of values) if (x < v) below += 1;
  return below / n;
}

function quantile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  if (p <= 0) return sorted[0]!;
  if (p >= 1) return sorted[sorted.length - 1]!;
  const i = p * (sorted.length - 1);
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  if (lo === hi) return sorted[lo]!;
  const t = i - lo;
  return sorted[lo]! * (1 - t) + sorted[hi]! * t;
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** Rank 1 of N ≈ 1; last listed slot still beats not being listed. */
export function rankScore(rank: number, scanned: number): number {
  if (!Number.isFinite(rank) || rank < 1) return 0;
  const n = Math.max(scanned || rank, rank);
  const prox = Math.sqrt(Math.max(0, (n - rank + 1) / n));
  return 0.18 + 0.82 * prox;
}

function emptyCounts(): Record<ExposureStatus, number> {
  return { gem: 0, over: 0, amplified: 0, "feed-heavy": 0, inline: 0, hidden: 0 };
}

export function analyzeExposure(opts: {
  bots: JuicyBot[];
  discovery?: ExposureDiscovery;
  botDepth?: ExposureDepth;
  commentCounts?: Record<string, number> | null;
}): ExposureReport {
  const matrix = new Map((opts.discovery?.matrix || []).map((m) => [m.characterId, m]));
  const depth = new Map((opts.botDepth || []).map((d) => [d.characterId, d]));
  const scanned: Partial<Record<ExposureFeed, number>> = {};
  for (const f of opts.discovery?.feeds || []) {
    if (isFeed(f.id) && typeof f.scannedCount === "number" && f.scannedCount > 0) {
      scanned[f.id] = f.scannedCount;
    }
  }
  const comments = opts.commentCounts || {};

  type Acc = {
    bot: JuicyBot;
    chats: number;
    likes: number;
    favs: number;
    comments: number;
    score10: number | null;
    age: number | null;
    cpd: number | null;
    attach: number;
    ranks: ExposureRankMap;
    exposure: number;
    feeds: ExposureFeed[];
    bestRank: number | null;
    bestFeed: ExposureFeed | null;
    hidden: boolean;
  };

  const acc: Acc[] = [];
  for (const bot of opts.bots || []) {
    if (!bot.characterId) continue;
    const hidden = bot.visibility === 0;
    const chats = bot.chatCount ?? 0;
    const likes = bot.likeCount ?? 0;
    const favs = bot.favoriteCount ?? 0;
    const score10 = bot.score10 ?? depth.get(bot.characterId)?.score10 ?? null;
    const age = ageDays(toMs(bot.gmtFirstPublish ?? bot.gmtCreate));
    const cpd = age != null && age > 0.25 ? chats / age : null;
    const attach = chats >= 80 ? favs / chats : 0;

    const ranks: ExposureRankMap = {};
    const m = matrix.get(bot.characterId);
    if (m?.ranks) {
      for (const [k, v] of Object.entries(m.ranks)) {
        if (isFeed(k) && typeof v === "number" && v > 0) ranks[k] = v;
      }
    }
    const dr = depth.get(bot.characterId)?.discoveryRanks;
    if (dr) {
      for (const [k, v] of Object.entries(dr)) {
        if (!isFeed(k) || typeof v !== "number" || v <= 0) continue;
        const prev = ranks[k];
        if (prev == null || v < prev) ranks[k] = v;
      }
    }

    let exposure = 0;
    const feeds: ExposureFeed[] = [];
    let bestRank: number | null = null;
    let bestFeed: ExposureFeed | null = null;
    for (const feed of EXPOSURE_FEEDS) {
      const rank = ranks[feed];
      if (rank == null) continue;
      const window = scanned[feed] || (feed === "editor" ? 200 : 2000);
      exposure += FEED_WEIGHT[feed] * rankScore(rank, window);
      feeds.push(feed);
      if (bestRank == null || rank < bestRank) {
        bestRank = rank;
        bestFeed = feed;
      }
    }
    if ((bot.baseEditor ?? 0) > 0 && ranks.editor == null) {
      exposure += 0.25;
      if (!feeds.includes("editor")) feeds.push("editor");
    }
    if ((liftBaseImmersive(bot) ?? 0) > 0 && ranks.immersive == null) {
      exposure += 0.2;
      if (!feeds.includes("immersive")) feeds.push("immersive");
    }

    acc.push({
      bot,
      chats,
      likes,
      favs,
      comments: comments[bot.characterId] || 0,
      score10,
      age,
      cpd,
      attach,
      ranks,
      exposure,
      feeds,
      bestRank,
      bestFeed,
      hidden,
    });
  }

  const pool = acc.filter((a) => !a.hidden);
  const chatsV = pool.map((a) => a.chats);
  const expV = pool.map((a) => a.exposure);
  const scoredV = pool.map((a) => a.score10).filter((n): n is number => n != null && n > 0);
  const attachV = pool.map((a) => a.attach);
  const favV = pool.map((a) => a.favs);
  const chatsSorted = [...chatsV].sort((a, b) => a - b);
  const unexposed = pool.filter((a) => a.exposure <= 0).map((a) => a.chats);
  const medianUnexposedChats = unexposed.length ? median(unexposed) : median(chatsV);

  const rows: ExposureRow[] = acc.map((a) => {
    if (a.hidden) {
      return {
        characterId: a.bot.characterId,
        characterName: a.bot.characterName || "Untitled",
        visibility: a.bot.visibility ?? 0,
        chats: a.chats,
        likes: a.likes,
        favorites: a.favs,
        comments: a.comments,
        score10: a.score10,
        ageDays: a.age,
        chatsPerDay: a.cpd,
        attachRate: a.attach,
        exposure: 0,
        exposurePct: 0,
        chatPct: 0,
        scorePct: 0,
        attachPct: 0,
        qualityPct: 0,
        gemScore: 0,
        expectedChats: 0,
        ratio: 0,
        lift: 0,
        feeds: [],
        ranks: {},
        bestRank: null,
        bestFeed: null,
        status: "hidden",
      };
    }

    const chatPct = percentileBelow(chatsV, a.chats);
    const exposurePct = percentileBelow(expV, a.exposure);
    const scorePct = a.score10 != null && a.score10 > 0 ? percentileBelow(scoredV, a.score10) : 0;
    const attachPct = percentileBelow(attachV, a.attach);
    const favPct = percentileBelow(favV, a.favs);
    const qualityPct = Math.max(scorePct, attachPct * 0.9, favPct * 0.65);
    const gemScore = qualityPct * chatPct * (1 - Math.min(1, exposurePct));
    const expectedRaw = a.exposure <= 0 ? medianUnexposedChats : quantile(chatsSorted, exposurePct);
    const expectedChats = Math.max(1, expectedRaw);
    const ratio = a.chats / expectedChats;
    const lift = chatPct - exposurePct;
    const onFeed = a.exposure > 0;

    let status: ExposureStatus = "inline";
    if (onFeed && exposurePct >= 0.82 && chatPct >= 0.55 && ratio >= 0.5) {
      status = "amplified";
    } else if (!onFeed && gemScore >= 0.5 && a.chats >= 2000) {
      status = "gem";
    } else if (lift >= 0.22 && chatPct >= 0.5 && ratio >= 1.7) {
      status = "over";
    } else if (onFeed && exposurePct >= 0.9 && ratio < 0.45) {
      status = "feed-heavy";
    }

    return {
      characterId: a.bot.characterId,
      characterName: a.bot.characterName || "Untitled",
      visibility: a.bot.visibility ?? null,
      chats: a.chats,
      likes: a.likes,
      favorites: a.favs,
      comments: a.comments,
      score10: a.score10,
      ageDays: a.age,
      chatsPerDay: a.cpd,
      attachRate: a.attach,
      exposure: a.exposure,
      exposurePct,
      chatPct,
      scorePct,
      attachPct,
      qualityPct,
      gemScore,
      expectedChats,
      ratio,
      lift,
      feeds: a.feeds,
      ranks: a.ranks,
      bestRank: a.bestRank,
      bestFeed: a.bestFeed,
      status,
    };
  });

  const publicRows = rows.filter((r) => r.status !== "hidden");
  const gems = [...publicRows.filter((r) => r.status === "gem")].sort((a, b) => b.gemScore - a.gemScore || b.ratio - a.ratio);
  const overperformers = [...publicRows.filter((r) => r.status === "over")].sort((a, b) => b.ratio - a.ratio);
  const amplified = [...publicRows.filter((r) => r.status === "amplified")].sort(
    (a, b) => b.exposurePct - a.exposurePct,
  );
  const feedHeavy = [...publicRows.filter((r) => r.status === "feed-heavy")].sort(
    (a, b) => b.exposure - a.exposure,
  );

  const counts = emptyCounts();
  for (const r of rows) counts[r.status] += 1;

  return {
    analyzedAt: new Date().toISOString(),
    pool: pool.length,
    listed: pool.filter((a) => a.exposure > 0).length,
    scanned,
    counts,
    medianUnexposedChats,
    rows: [...publicRows].sort((a, b) => b.lift - a.lift),
    gems,
    overperformers,
    amplified,
    feedHeavy,
  };
}

export function formatExposureRatio(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n >= 100) return "99x+";
  if (n >= 10) return `${n.toFixed(0)}x`;
  return `${n.toFixed(1)}x`;
}

export function formatLiftPts(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const pts = Math.round(n * 100);
  if (pts > 0) return `+${pts}`;
  return String(pts);
}
