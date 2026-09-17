import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { JuicyClient } from "./client";
import { loadNotifStore, type NotifEvent } from "./notifications";
import { loadSession, saveSession } from "./session";
import { liftBaseImmersive, type LoungeSnapshot } from "./types";
import { dataPath, ensureDataDir } from "./paths";

const TZ = "Europe/Madrid";

function insightsPath() {
  return dataPath("creator-insights.json");
}
function snapPath() {
  return dataPath("last-snapshot.json");
}

/** Homepage discovery tabs on juicychat.ai */
export const DISCOVERY_FEEDS = [
  { id: "popular", label: "Popular", sortName: "popular", maxPages: 40 },
  { id: "recent", label: "Recent", sortName: "recent", maxPages: 40 },
  { id: "trending", label: "Trending", sortName: "trending", maxPages: 40 },
  { id: "immersive", label: "Immersive", sortName: "immersive", maxPages: 40 },
  { id: "new", label: "New", sortName: "new", maxPages: 40 },
  { id: "editor", label: "Editor Choice", sortName: "editor", maxPages: 20 },
] as const;

export type DiscoveryFeedId = (typeof DISCOVERY_FEEDS)[number]["id"];

export type FollowerRow = {
  userId: string;
  userName: string;
  userAvatar?: string;
  userNo?: string;
  followersCount?: number;
  characterCount?: number;
};

export type WalletTx = {
  id: string;
  type?: string | number;
  amount?: number;
  gems?: number;
  remark?: string;
  ts?: number;
};

export type BotDepthRow = {
  characterId: string;
  characterName: string;
  chats: number;
  likes: number;
  favorites: number;
  score10?: number;
  score20?: number;
  memoryCount?: number;
  genPictureCount?: number;
  galleryCount?: number;
  basePopular?: number;
  baseTrending?: number;
  baseRecent?: number;
  baseEditor?: number;
  baseImmersive?: number;
  ageDays?: number | null;
  tags: string[];
  visibility?: string;
  /** Live feed ranks, e.g. { trending: 167, editor: 20 } */
  discoveryRanks?: Partial<Record<DiscoveryFeedId, number>>;
  discoveryFeeds?: DiscoveryFeedId[];
};

export type RankItem = {
  characterId: string;
  characterName: string;
  value: number;
};

export type ScorePoint = {
  characterId: string;
  characterName: string;
  score10: number;
  chats: number;
  likes: number;
  favorites: number;
};

export type DiscoveryHit = {
  characterId: string;
  characterName: string;
  rank: number;
  score10?: number;
  chats?: number;
  likes?: number;
  userId?: string;
  userName?: string;
};

export type DiscoveryFeedResult = {
  id: DiscoveryFeedId;
  label: string;
  sortName: string;
  pagesScanned: number;
  scannedCount: number;
  apiTotal: number | null;
  hits: DiscoveryHit[];
  /** Everyone seen in the scanned pages — used by rival MRT. */
  allHits?: DiscoveryHit[];
};

export type DiscoveryPlacement = {
  scrapedAt: string;
  feeds: DiscoveryFeedResult[];
  /** Bots that appear in at least one scanned feed */
  matrix: Array<{
    characterId: string;
    characterName: string;
    chats: number;
    likes: number;
    score10?: number;
    ranks: Partial<Record<DiscoveryFeedId, number>>;
    feeds: DiscoveryFeedId[];
    baseEditor?: number;
    baseImmersive?: number;
  }>;
  summary: Record<DiscoveryFeedId, number>;
  pagesByFeed: Record<string, number>;
};

/** Serializable JSON-friendly creator insights payload. */
export type CreatorInsights = {
  scrapedAt: string;
  timezone: string;
  benefit: Record<string, string | number | boolean | null> | null;
  stats: Record<string, string | number | boolean | null> | null;
  ownCharacterData: Record<string, string | number | boolean | null> | null;
  followers: FollowerRow[];
  followerCount: number;
  wallet: WalletTx[];
  notifSummary: Record<string, number>;
  botDepth: BotDepthRow[];
  topByChats: RankItem[];
  topByScore: RankItem[];
  topByMemories: RankItem[];
  topByGenPics: RankItem[];
  topByLikes: RankItem[];
  scoreVsEngagement: ScorePoint[];
  discovery: DiscoveryPlacement | null;
  giftsRewards: NotifEvent[];
  follows: NotifEvent[];
  comments: NotifEvent[];
  audits: NotifEvent[];
  warnings: string[];
};


function loadSnapshot(): LoungeSnapshot | null {
  try {
    if (!existsSync(snapPath())) return null;
    return JSON.parse(readFileSync(snapPath(), "utf8")) as LoungeSnapshot;
  } catch {
    return null;
  }
}

function ageDays(ts: string | number | null | undefined): number | null {
  if (ts == null || ts === "") return null;
  const n = typeof ts === "number" ? ts : Number(ts);
  if (!Number.isFinite(n) || n <= 0) return null;
  const ms = n < 1e12 ? n * 1000 : n;
  return Math.max(0, Math.floor((Date.now() - ms) / 86400000));
}

function asPlainRecord(
  value: unknown,
): Record<string, string | number | boolean | null> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const out: Record<string, string | number | boolean | null> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (v == null) out[k] = null;
    else if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") out[k] = v;
    else if (typeof v === "object") out[k] = JSON.stringify(v);
    else out[k] = String(v);
  }
  return out;
}

function asArray(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  if (!data || typeof data !== "object") return [];
  const o = data as Record<string, unknown>;
  for (const k of ["list", "records", "rows", "data", "characterList", "items"]) {
    if (Array.isArray(o[k])) return o[k] as Record<string, unknown>[];
  }
  return [];
}

function pickFollower(raw: Record<string, unknown>): FollowerRow | null {
  const userId = raw.userId ?? raw.followUserId ?? raw.id;
  if (userId == null) return null;
  return {
    userId: String(userId),
    userName: String(raw.userName ?? raw.followUserName ?? raw.name ?? "user"),
    userAvatar:
      raw.userAvatar != null
        ? String(raw.userAvatar)
        : raw.avatar != null
          ? String(raw.avatar)
          : undefined,
    userNo: raw.userNo != null ? String(raw.userNo) : undefined,
    followersCount: typeof raw.followersCount === "number" ? raw.followersCount : undefined,
    characterCount: typeof raw.characterCount === "number" ? raw.characterCount : undefined,
  };
}

/**
 * Scan homepage discovery feeds and find where the creator's bots currently rank.
 * API: POST /yume/api/user/v1/character/getCharacterList { sortName, pageNo, pageSize, ... }
 */
export async function scrapeDiscoveryPlacement(
  client: JuicyClient,
  options: {
    ownUserId: string;
    ownBotIds: Set<string>;
    botNames: Map<string, string>;
    botMeta: Map<string, { chats: number; likes: number; score10?: number; baseEditor?: number; baseImmersive?: number }>;
    maxPagesByFeed?: Partial<Record<DiscoveryFeedId, number>>;
  },
  warnings: string[],
): Promise<DiscoveryPlacement> {
  const feeds: DiscoveryFeedResult[] = [];
  const ranksByBot = new Map<string, Partial<Record<DiscoveryFeedId, number>>>();

  for (const feed of DISCOVERY_FEEDS) {
    const maxPages = options.maxPagesByFeed?.[feed.id] ?? feed.maxPages;
    const hits: DiscoveryHit[] = [];
    const allHits: DiscoveryHit[] = [];
    let pagesScanned = 0;
    let scannedCount = 0;
    let apiTotal: number | null = null;

    for (let pageNo = 1; pageNo <= maxPages; pageNo++) {
      try {
        const r = await client.post<Record<string, unknown>[]>(
          "/yume/api/user/v1/character/getCharacterList",
          {
            pageNo,
            pageSize: 50,
            visibility: null,
            auditType: null,
            searchContent: "",
            characterTags: [],
            sortName: feed.sortName,
            gender: null,
          },
        );
        if (!r.success && r.code !== "200") {
          warnings.push(`discovery ${feed.id}: ${r.msg || r.code}`);
          break;
        }
        if (typeof r.total === "number") apiTotal = r.total;
        const batch = asArray(r.data);
        pagesScanned++;
        if (!batch.length) break;

        for (let i = 0; i < batch.length; i++) {
          const raw = batch[i];
          const id = raw.characterId != null ? String(raw.characterId) : "";
          if (!id) continue;
          const owner = raw.userId != null ? String(raw.userId) : "";
          const isOwn = options.ownBotIds.has(id) || owner === options.ownUserId;
          const rank = (pageNo - 1) * 50 + i + 1;
          const name =
            options.botNames.get(id) ||
            (raw.characterName != null ? String(raw.characterName) : "Untitled");
          const hit: DiscoveryHit = {
            characterId: id,
            characterName: name,
            rank,
            score10: typeof raw.score10 === "number" ? raw.score10 : undefined,
            chats: typeof raw.chatCount === "number" ? raw.chatCount : undefined,
            likes: typeof raw.likeCount === "number" ? raw.likeCount : undefined,
            userId: owner || undefined,
            userName: raw.userName != null ? String(raw.userName) : undefined,
          };
          if (allHits.length < 2500) {
            allHits.push({
              characterId: id,
              characterName: name,
              rank,
              chats: hit.chats,
              userId: owner || undefined,
              userName: hit.userName,
            });
          }
          if (!isOwn) continue;
          hits.push(hit);
          const cur = ranksByBot.get(id) || {};
          // keep best (lowest) rank if seen twice
          if (cur[feed.id] == null || rank < (cur[feed.id] as number)) {
            cur[feed.id] = rank;
            ranksByBot.set(id, cur);
          }
        }

        scannedCount += batch.length;
        if (batch.length < 50) break;
        if (apiTotal != null && scannedCount >= apiTotal) break;
      } catch (e) {
        warnings.push(
          `discovery ${feed.id} p${pageNo}: ${e instanceof Error ? e.message : String(e)}`,
        );
        break;
      }
    }

    hits.sort((a, b) => a.rank - b.rank);
    allHits.sort((a, b) => a.rank - b.rank);
    feeds.push({
      id: feed.id,
      label: feed.label,
      sortName: feed.sortName,
      pagesScanned,
      scannedCount,
      apiTotal,
      hits,
      allHits,
    });
  }

  // Build matrix: union of bots with any rank + editor-flagged from own list
  const matrixIds = new Set<string>([...ranksByBot.keys()]);
  for (const [id, meta] of options.botMeta) {
    if (meta.baseEditor === 1 || meta.baseImmersive === 1) matrixIds.add(id);
  }

  const matrix = [...matrixIds]
    .map((id) => {
      const ranks = ranksByBot.get(id) || {};
      const feedIds = DISCOVERY_FEEDS.map((f) => f.id).filter((fid) => ranks[fid] != null);
      const meta = options.botMeta.get(id) || { chats: 0, likes: 0 };
      return {
        characterId: id,
        characterName: options.botNames.get(id) || id,
        chats: meta.chats,
        likes: meta.likes,
        score10: meta.score10,
        ranks,
        feeds: feedIds,
        baseEditor: meta.baseEditor,
        baseImmersive: meta.baseImmersive,
      };
    })
    .sort((a, b) => {
      // more feeds first, then best rank
      if (b.feeds.length !== a.feeds.length) return b.feeds.length - a.feeds.length;
      const bestA = Math.min(...Object.values(a.ranks).map(Number), 999999);
      const bestB = Math.min(...Object.values(b.ranks).map(Number), 999999);
      return bestA - bestB;
    });

  const summary = {} as Record<DiscoveryFeedId, number>;
  for (const f of feeds) summary[f.id] = f.hits.length;
  const pagesByFeed: Record<string, number> = {};
  for (const f of feeds) pagesByFeed[f.id] = f.pagesScanned;

  return {
    scrapedAt: new Date().toISOString(),
    feeds,
    matrix,
    summary,
    pagesByFeed,
  };
}

export async function scrapeCreatorInsights(options?: {
  followerPages?: number;
  walletPages?: number;
  discoveryPages?: number;
  skipDiscovery?: boolean;
}): Promise<CreatorInsights> {
  const session = loadSession();
  if (!session?.cookie) throw new Error("Not logged in — open Lounge and sign in (magic link / Google / password), then pull insights again.");
  const client = JuicyClient.fromSession(session);
  const warnings: string[] = [];
  const followerPages = options?.followerPages ?? 10;
  const walletPages = options?.walletPages ?? 5;
  const discoveryPages = options?.discoveryPages ?? 40;

  let benefit: CreatorInsights["benefit"] = null;
  let stats: CreatorInsights["stats"] = null;
  let ownCharacterData: CreatorInsights["ownCharacterData"] = null;

  try {
    const r = await client.post<Record<string, unknown>>("/yume/api/user/v1/creator/getBenefitSummary", {});
    benefit = asPlainRecord(r.data);
  } catch (e) {
    warnings.push(`benefit: ${e instanceof Error ? e.message : String(e)}`);
  }

  try {
    const r = await client.post<Record<string, unknown>>("/yume/api/user/v1/getUserStatisticsData", {});
    stats = asPlainRecord(r.data);
  } catch (e) {
    warnings.push(`stats: ${e instanceof Error ? e.message : String(e)}`);
  }

  try {
    const r = await client.post<Record<string, unknown>>(
      "/yume/api/user/v1/character/getOwnUserCharacterData",
      {},
    );
    ownCharacterData = asPlainRecord(r.data);
  } catch (e) {
    warnings.push(`ownCharacterData: ${e instanceof Error ? e.message : String(e)}`);
  }

  const followers: FollowerRow[] = [];
  const seenFollowers = new Set<string>();
  let followerListTotal: number | null = null;
  for (let pageNo = 1; pageNo <= followerPages; pageNo++) {
    try {
      const r = await client.post<Record<string, unknown>[]>(
        "/yume/api/user/v1/getUserFollowersList",
        { pageNo, pageSize: 50 },
      );
      const nestedTotal = (r as { total?: unknown }).total;
      const dataTotal =
        r.data && !Array.isArray(r.data) && typeof r.data === "object"
          ? (r.data as { total?: unknown }).total
          : undefined;
      const total = typeof nestedTotal === "number" ? nestedTotal : typeof dataTotal === "number" ? dataTotal : null;
      if (total != null) followerListTotal = total;
      const batch = asArray(r.data);
      for (const raw of batch) {
        const row = pickFollower(raw);
        if (row && !seenFollowers.has(row.userId)) {
          seenFollowers.add(row.userId);
          followers.push(row);
        }
      }
      if (batch.length < 50) break;
    } catch (e) {
      warnings.push(`followers p${pageNo}: ${e instanceof Error ? e.message : String(e)}`);
      break;
    }
  }

  const wallet: WalletTx[] = [];
  for (let pageNo = 1; pageNo <= walletPages; pageNo++) {
    try {
      const r = await client.post<Record<string, unknown>[]>(
        "/yume/api/user/v1/wallet/gemsTransactionRecord",
        { pageNo, pageSize: 50 },
      );
      const batch = asArray(r.data);
      for (const rec of batch) {
        const id = String(rec.id ?? rec.flowId ?? rec.transactionId ?? `${pageNo}-${wallet.length}`);
        const tsRaw = rec.gmtCreate ?? rec.gmtModified ?? rec.createTime ?? rec.ts;
        const ts =
          typeof tsRaw === "number" ? tsRaw : tsRaw ? Number(tsRaw) : undefined;
        wallet.push({
          id,
          type: (rec.transactionType ?? rec.type ?? rec.bizType) as string | number | undefined,
          amount: typeof rec.amount === "number" ? rec.amount : undefined,
          gems:
            typeof rec.gems === "number"
              ? rec.gems
              : typeof rec.changeAmount === "number"
                ? rec.changeAmount
                : undefined,
          remark:
            rec.remark != null
              ? String(rec.remark)
              : rec.desc != null
                ? String(rec.desc)
                : undefined,
          ts: Number.isFinite(ts as number) ? (ts as number) : undefined,
        });
      }
      if (batch.length < 50) break;
    } catch (e) {
      warnings.push(`wallet p${pageNo}: ${e instanceof Error ? e.message : String(e)}`);
      break;
    }
  }

  if (client.cookie && client.cookie !== session.cookie) {
    saveSession({ ...session, cookie: client.cookie });
  }

  const snap = loadSnapshot();
  const bots = snap?.bots ?? [];
  const ownUserId = String(session.userId || snap?.userId || "");
  const ownBotIds = new Set(bots.map((b) => b.characterId));
  const botNames = new Map(bots.map((b) => [b.characterId, b.characterName] as const));
  const botMeta = new Map(
    bots.map((b) => [
      b.characterId,
      {
        chats: b.chatCount ?? 0,
        likes: b.likeCount ?? 0,
        score10: b.score10,
        baseEditor: b.baseEditor,
        baseImmersive: liftBaseImmersive(b),
      },
    ]),
  );

  let discovery: DiscoveryPlacement | null = null;
  if (!options?.skipDiscovery && ownUserId) {
    try {
      discovery = await scrapeDiscoveryPlacement(
        client,
        {
          ownUserId,
          ownBotIds,
          botNames,
          botMeta,
          maxPagesByFeed: {
            popular: discoveryPages,
            recent: discoveryPages,
            trending: discoveryPages,
            immersive: discoveryPages,
            new: discoveryPages,
            editor: Math.min(20, Math.max(4, Math.ceil(200 / 50))),
          },
        },
        warnings,
      );
    } catch (e) {
      warnings.push(`discovery: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const ranksLookup = new Map<string, Partial<Record<DiscoveryFeedId, number>>>();
  if (discovery) {
    for (const row of discovery.matrix) ranksLookup.set(row.characterId, row.ranks);
  }

  const botDepth: BotDepthRow[] = bots.map((b) => {
    const ranks = ranksLookup.get(b.characterId);
    return {
      characterId: b.characterId,
      characterName: b.characterName,
      chats: b.chatCount ?? 0,
      likes: b.likeCount ?? 0,
      favorites: b.favoriteCount ?? 0,
      score10: b.score10,
      score20: b.score20,
      memoryCount: b.memoryCount,
      genPictureCount: b.genPictureCount,
      galleryCount: b.galleryCount,
      basePopular: b.basePopular,
      baseTrending: b.baseTrending,
      baseRecent: b.baseRecent,
      baseEditor: b.baseEditor,
      baseImmersive: liftBaseImmersive(b),
      ageDays: ageDays(b.gmtFirstPublish ?? b.gmtCreate),
      tags: b.characterTags ?? [],
      visibility: b._visibilityLabel,
      discoveryRanks: ranks,
      discoveryFeeds: ranks
        ? (Object.keys(ranks) as DiscoveryFeedId[])
        : b.baseEditor === 1
          ? (["editor"] as DiscoveryFeedId[])
          : liftBaseImmersive(b) === 1
            ? (["immersive"] as DiscoveryFeedId[])
            : [],
    };
  });

  const top = (
    key: "chats" | "score10" | "memoryCount" | "genPictureCount" | "likes",
    n = 10,
  ): RankItem[] =>
    [...botDepth]
      .map((b) => ({
        characterId: b.characterId,
        characterName: b.characterName,
        value: Number(
          key === "chats"
            ? b.chats
            : key === "score10"
              ? b.score10 ?? 0
              : key === "memoryCount"
                ? b.memoryCount ?? 0
                : key === "likes"
                  ? b.likes
                  : b.genPictureCount ?? 0,
        ),
      }))
      .sort((a, b) => b.value - a.value)
      .filter((x) => x.value > 0)
      .slice(0, n);

  const scoreVsEngagement: ScorePoint[] = botDepth
    .filter((b) => (b.score10 ?? 0) > 0)
    .map((b) => ({
      characterId: b.characterId,
      characterName: b.characterName,
      score10: b.score10 ?? 0,
      chats: b.chats,
      likes: b.likes,
      favorites: b.favorites,
    }))
    .sort((a, b) => b.score10 - a.score10)
    .slice(0, 80);

  const notif = loadNotifStore();
  const notifSummary: Record<string, number> = {};
  for (const e of notif.events) {
    notifSummary[e.kind] = (notifSummary[e.kind] || 0) + 1;
  }

  const giftsRewards = notif.events.filter((e) => e.kind === "gift" || e.kind === "reward").slice(0, 80);
  const follows = notif.events.filter((e) => e.kind === "follow").slice(0, 80);
  const comments = notif.events.filter((e) => e.kind === "comment").slice(0, 80);
  const audits = notif.events.filter((e) => e.kind === "audit").slice(0, 40);

  const insights: CreatorInsights = {
    scrapedAt: new Date().toISOString(),
    timezone: TZ,
    benefit,
    stats,
    ownCharacterData,
    followers,
    followerCount: followerListTotal ?? followers.length,
    wallet,
    notifSummary,
    botDepth,
    topByChats: top("chats"),
    topByScore: top("score10"),
    topByMemories: top("memoryCount"),
    topByGenPics: top("genPictureCount"),
    topByLikes: top("likes"),
    scoreVsEngagement,
    discovery,
    giftsRewards,
    follows,
    comments,
    audits,
    warnings,
  };

  ensureDataDir();
  writeFileSync(insightsPath(), JSON.stringify(insights), "utf8");
  return insights;
}

export function loadCreatorInsights(): CreatorInsights | null {
  try {
    if (!existsSync(insightsPath())) return null;
    return JSON.parse(readFileSync(insightsPath(), "utf8")) as CreatorInsights;
  } catch {
    return null;
  }
}
