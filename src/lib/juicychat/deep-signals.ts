/**
 * High-value JuicyChat signal scrapers for the creator dashboard.
 * Best-effort: each call is isolated; failures become warnings, not crashes.
 */
import type { JuicyClient } from "./client";
import type { JuicyBot } from "./types";

function asArray(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  if (!data || typeof data !== "object") return [];
  const o = data as Record<string, unknown>;
  for (const k of [
    "list",
    "records",
    "rows",
    "data",
    "characterList",
    "items",
    "rankingList",
    "rankList",
    "creatorList",
  ]) {
    if (Array.isArray(o[k])) return o[k] as Record<string, unknown>[];
  }
  for (const v of Object.values(o)) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const nested = asArray(v);
      if (nested.length) return nested;
    }
  }
  return [];
}

function num(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}

function str(v: unknown): string | undefined {
  if (v == null) return undefined;
  return String(v);
}

export type BotEnrichment = {
  characterId: string;
  characterName: string;
  commentCount?: number;
  commentSample?: number;
  rankGlobal?: number;
  rankCategory?: string;
  detailScore10?: number;
  detailScore20?: number;
  memoryCount?: number;
  galleryCount?: number;
  genPictureCount?: number;
  definitionLen?: number;
  tags: string[];
  chatsPerDay?: number;
  ageDays?: number;
  shareCount?: number;
  textLength?: number;
  characterAge?: string | number;
  figureId?: string;
  galleryPageView?: number;
  hasSceneCard?: boolean;
};

export type CharacterRankHit = {
  rank: number;
  characterId: string;
  characterName: string;
  userId?: string;
  userName?: string;
  chatCount?: number;
  likeCount?: number;
  score10?: number;
  isOwn: boolean;
};

export type CreatorRankHit = {
  /** Display rank = list index + 1 (matches juicychat.ai/ranklistpage). */
  rank: number;
  /** Raw `ranking` field from the API (has gaps on all-time). */
  apiRanking?: number;
  userId: string;
  userName: string;
  chatCount?: number;
  likeCount?: number;
  followersCount?: number;
  characterCount?: number;
  score?: number;
  isYou: boolean;
};

export type LeaderboardBoard = {
  id: string;
  label: string;
  period: string;
  cohort: string;
  rankingType: number;
  yourRank: number | null;
  yourScore: number | null;
  scanned: number;
  top: CreatorRankHit[];
  aroundYou: CreatorRankHit[];
  listings: CreatorRankHit[];
};

export type MonthlyNewHit = {
  rankingDate: number;
  label: string;
  yourRank: number;
  yourScore?: number;
  topName?: string | null;
};

export type CharacterBoard = {
  id: string;
  label: string;
  own: Array<{ rank: number; characterId: string; characterName: string; chatCount?: number }>;
};

export type TagCompetition = {
  tag: string;
  yourBots: number;
  yourChats: number;
  sampleSize: number;
  topInTag: Array<{ name: string; chats: number; characterId: string; from?: string }>;
  yourBestRank: number | null;
  competitionChats: number;
  rivalBots?: number;
  rivalChats?: number;
};

export type CommentPulse = {
  characterId: string;
  characterName: string;
  commentsFetched: number;
  approxTotal: number | null;
  likesOnComments: number;
  /** Distinct named commenters from the notification archive. */
  uniqueSenders?: number;
};

export type DeepSignals = {
  scrapedAt: string;
  userInfoCount: Record<string, number | string | null> | null;
  botEnrichment: BotEnrichment[];
  characterRanks: CharacterRankHit[];
  ownCharacterRanks: CharacterRankHit[];
  creatorRanks: CreatorRankHit[];
  yourCreatorRank: number | null;
  yourBestBoard: string | null;
  leaderboards: LeaderboardBoard[];
  monthlyNew: MonthlyNewHit[];
  characterBoards: CharacterBoard[];
  monthlyCreatorRanks: CreatorRankHit[];
  tagCompetition: TagCompetition[];
  commentPulse: CommentPulse[];
  quality: {
    avgScore10: number | null;
    medianChats: number | null;
    top10ChatShare: number | null;
    botsWithComments: number;
    botsRanked: number;
    engagementRate: number | null; // (likes+favs)/chats
  };
  warnings: string[];
};

/** Same four toggles as juicychat.ai/ranklistpage. pageNo>1 is a no-op; size must fit on page 1. */
export const CREATOR_BOARD_SPECS = [
  { id: "c_30d_all", label: "Trending · ALL", period: "trending", cohort: "ALL", type: 1, size: 200 },
  { id: "c_30d_new", label: "Trending · NEW", period: "trending", cohort: "NEW", type: 2, size: 100 },
  { id: "c_all_all", label: "All-time · ALL", period: "all-time", cohort: "ALL", type: 3, size: 200 },
  { id: "c_all_new", label: "All-time · NEW", period: "all-time", cohort: "NEW", type: 4, size: 100 },
] as const;

function ageDays(ts: string | number | undefined | null): number | undefined {
  if (ts == null || ts === "") return undefined;
  let n = typeof ts === "number" ? ts : Number(ts);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  if (n < 1e12) n *= 1000;
  return Math.max(0, (Date.now() - n) / 86_400_000);
}

export async function fetchUserInfoCount(
  client: JuicyClient,
  warnings: string[],
): Promise<Record<string, number | string | null> | null> {
  try {
    const r = await client.post<Record<string, unknown>>("/yume/api/user/v1/getUserInfoCount", {});
    if (!r.success && r.code !== "200") {
      warnings.push(`getUserInfoCount: ${r.msg || r.code}`);
      return null;
    }
    if (!r.data || typeof r.data !== "object") return null;
    const out: Record<string, number | string | null> = {};
    for (const [k, v] of Object.entries(r.data)) {
      if (v == null) out[k] = null;
      else if (typeof v === "number" || typeof v === "string") out[k] = v;
      else out[k] = JSON.stringify(v);
    }
    return out;
  } catch (e) {
    warnings.push(`getUserInfoCount: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

export async function enrichTopBots(
  client: JuicyClient,
  bots: JuicyBot[],
  warnings: string[],
  limit = 18,
): Promise<BotEnrichment[]> {
  const top = [...bots]
    .sort((a, b) => (b.chatCount ?? 0) - (a.chatCount ?? 0))
    .slice(0, limit);
  const out: BotEnrichment[] = [];

  for (const bot of top) {
    const row: BotEnrichment = {
      characterId: bot.characterId,
      characterName: bot.characterName,
      tags: bot.characterTags || [],
      memoryCount: bot.memoryCount,
      galleryCount: bot.galleryCount,
      genPictureCount: bot.genPictureCount,
      detailScore10: bot.score10,
      detailScore20: bot.score20,
      ageDays: ageDays(bot.gmtFirstPublish ?? bot.gmtCreate),
    };
    if (row.ageDays && row.ageDays > 0 && bot.chatCount) {
      row.chatsPerDay = bot.chatCount / row.ageDays;
    }

    try {
      const d = await client.post<Record<string, unknown>>(
        "/yume/api/user/v1/character/getCharacterDetail",
        { characterId: bot.characterId },
      );
      if (d.success || d.code === "200") {
        const raw = (d.data || {}) as Record<string, unknown>;
        const c =
          raw.character && typeof raw.character === "object"
            ? (raw.character as Record<string, unknown>)
            : raw;
        row.detailScore10 = num(c.score10) ?? row.detailScore10;
        row.detailScore20 = num(c.score20) ?? row.detailScore20;
        row.memoryCount = num(c.memoryCount) ?? row.memoryCount;
        row.galleryCount = num(c.galleryCount) ?? row.galleryCount;
        row.genPictureCount = num(c.genPictureCount) ?? row.genPictureCount;
        if (Array.isArray(c.characterTags)) row.tags = c.characterTags.map(String);
        const def =
          str(c.characterDefinition) ||
          str(c.definition) ||
          str(c.publicDefinitionText) ||
          str(c.introduction);
        if (def) row.definitionLen = def.length;
        if (num(c.commentCount) != null) row.commentCount = num(c.commentCount);
        row.shareCount = num(c.shareCount) ?? row.shareCount;
        row.textLength = num(c.textLength) ?? row.textLength;
        if (c.characterAge != null) row.characterAge = c.characterAge as string | number;
        if (c.figureId != null) row.figureId = String(c.figureId);
        row.hasSceneCard = Boolean(c.sceneCard && typeof c.sceneCard === "object");
      }
    } catch (e) {
      warnings.push(`detail ${bot.characterName}: ${e instanceof Error ? e.message : String(e)}`);
    }

    try {
      const c = await client.post<Record<string, unknown>>(
        "/yume/api/user/v1/character/comment/getCommentPage",
        {
          characterId: bot.characterId,
          pageNo: 1,
          pageSize: 20,
        },
      );
      if (c.success || c.code === "200") {
        const batch = asArray(c.data);
        row.commentSample = batch.length;
        if (typeof c.total === "number") row.commentCount = c.total;
        else if (row.commentCount == null) row.commentCount = batch.length;
      }
    } catch {
      /* comments optional */
    }

    out.push(row);
  }
  return out;
}

export async function scrapeCharacterRankings(
  client: JuicyClient,
  ownBotIds: Set<string>,
  warnings: string[],
  pages = 3,
): Promise<CharacterRankHit[]> {
  const hits: CharacterRankHit[] = [];
  for (let pageNo = 1; pageNo <= pages; pageNo++) {
    try {
      let r = await client.post<Record<string, unknown>[]>(
        "/yume/api/user/v1/character/getCharacterRankingList",
        { pageNo, pageSize: 50 },
      );
      if (!r.success && r.code !== "200") {
        r = await client.post("/yume/api/user/v1/character/getCharacterRankingList", {
          pageNo,
          pageSize: 50,
          rankingType: 1,
        });
      }
      if (!r.success && r.code !== "200") {
        warnings.push(`characterRanking: ${r.msg || r.code}`);
        break;
      }
      const batch = asArray(r.data);
      if (!batch.length) break;
      for (let i = 0; i < batch.length; i++) {
        const raw = batch[i];
        const id = str(raw.characterId);
        if (!id) continue;
        hits.push({
          rank: (pageNo - 1) * 50 + i + 1,
          characterId: id,
          characterName: str(raw.characterName) || "Untitled",
          userId: str(raw.userId),
          userName: str(raw.userName),
          chatCount: num(raw.chatCount) ?? num(raw.characterChatCount),
          likeCount: num(raw.likeCount),
          score10: num(raw.score10),
          isOwn: ownBotIds.has(id) || ownBotIds.has(String(raw.characterId)),
        });
      }
      if (batch.length < 50) break;
    } catch (e) {
      warnings.push(`characterRanking p${pageNo}: ${e instanceof Error ? e.message : String(e)}`);
      break;
    }
  }
  return hits;
}

export async function scrapeCreatorRankings(
  client: JuicyClient,
  youUserId: string | null,
  warnings: string[],
  path:
    | "/yume/api/user/v1/creator/ranking/getCreatorRanking"
    | "/yume/api/user/v1/creator/ranking/getDataCreatorRankingMonthly",
  pages = 2,
): Promise<CreatorRankHit[]> {
  const hits: CreatorRankHit[] = [];
  for (let pageNo = 1; pageNo <= pages; pageNo++) {
    try {
      const r = await client.post<Record<string, unknown>[]>(path, {
        pageNo,
        pageSize: 50,
      });
      if (!r.success && r.code !== "200") {
        warnings.push(`${path.split("/").pop()}: ${r.msg || r.code}`);
        break;
      }
      const batch = asArray(r.data);
      if (!batch.length) break;
      hits.push(
        ...parseCreatorHits(
          batch,
          youUserId,
          null,
          (pageNo - 1) * 50,
        ),
      );
      if (batch.length < 50) break;
    } catch (e) {
      warnings.push(`${path}: ${e instanceof Error ? e.message : String(e)}`);
      break;
    }
  }
  return hits;
}

function normName(v: string | null | undefined): string {
  return String(v || "")
    .toLowerCase()
    .replace(/^@+/, "")
    .trim();
}

function youMatch(raw: Record<string, unknown>, youUserId: string | null, youName: string | null): boolean {
  const uid = str(raw.userId) || str(raw.creatorId);
  if (youUserId && uid && String(youUserId) === uid) return true;
  const uname = normName(str(raw.userName) || str(raw.creatorName));
  const want = normName(youName);
  return Boolean(want && uname && want === uname);
}

function parseCreatorHits(
  batch: Record<string, unknown>[],
  youUserId: string | null,
  youName: string | null,
  offset = 0,
): CreatorRankHit[] {
  return batch.map((raw, i) => {
    const uid = str(raw.userId) || str(raw.creatorId) || `row-${offset + i}`;
    return {
      rank: offset + i + 1,
      apiRanking: num(raw.ranking) ?? num(raw.rank),
      userId: uid,
      userName: str(raw.userName) || str(raw.creatorName) || uid,
      chatCount: num(raw.characterChatCount) ?? num(raw.chatCount) ?? num(raw.totalChatCount),
      likeCount: num(raw.likeCount),
      followersCount: num(raw.followersCount) ?? num(raw.followerCount),
      characterCount: num(raw.characterCount) ?? num(raw.botCount),
      score: num(raw.score) ?? num(raw.hotScore),
      isYou: youMatch(raw, youUserId, youName),
    };
  });
}

async function scrapeCreatorBoard(
  client: JuicyClient,
  youUserId: string | null,
  youName: string | null,
  rankingType: number,
  pageSize: number,
  warnings: string[],
  meta: { id: string; label: string; period: string; cohort: string },
): Promise<LeaderboardBoard> {
  const board: LeaderboardBoard = {
    id: meta.id,
    label: meta.label,
    period: meta.period,
    cohort: meta.cohort,
    rankingType,
    yourRank: null,
    yourScore: null,
    scanned: 0,
    top: [],
    aroundYou: [],
    listings: [],
  };
  try {
    // pageNo>1 is ignored by JuicyChat — always page 1 with a large pageSize.
    const r = await client.post<Record<string, unknown>[]>(
      "/yume/api/user/v1/creator/ranking/getCreatorRanking",
      { pageNo: 1, pageSize, rankingType },
    );
    if (!r.success && r.code !== "200") {
      warnings.push(`${meta.id}: ${r.msg || r.code}`);
      return board;
    }
    const rawList = asArray(r.data).length ? asArray(r.data) : asArray(r as unknown as Record<string, unknown>);
    const hits = parseCreatorHits(rawList, youUserId, youName);
    board.scanned = hits.length;
    board.top = hits.slice(0, 8);
    const idx = hits.findIndex((h) => h.isYou);
    if (idx >= 0) {
      const me = hits[idx]!;
      board.yourRank = me.rank;
      board.yourScore = me.score ?? null;
      board.aroundYou = hits.slice(Math.max(0, idx - 4), Math.min(hits.length, idx + 5));
      const window = 32;
      const start = Math.max(0, Math.min(idx - 12, Math.max(0, hits.length - window)));
      board.listings = hits.slice(start, start + window);
    } else {
      board.listings = hits.slice(0, 32);
    }
  } catch (e) {
    warnings.push(`${meta.id}: ${e instanceof Error ? e.message : String(e)}`);
  }
  return board;
}

function monthKeysSince(yyyymm: number): number[] {
  const now = new Date();
  let y = Math.floor(yyyymm / 100);
  let m = yyyymm % 100;
  const out: number[] = [];
  for (let i = 0; i < 36; i++) {
    out.push(y * 100 + m);
    if (y > now.getFullYear() || (y === now.getFullYear() && m >= now.getMonth() + 1)) break;
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

async function scrapeMonthlyNewBoards(
  client: JuicyClient,
  youUserId: string | null,
  youName: string | null,
  warnings: string[],
): Promise<MonthlyNewHit[]> {
  const featured: MonthlyNewHit[] = [];
  for (const date of monthKeysSince(202605)) {
    const rankingType = date > 202605 ? 2 : 4;
    const path =
      date > 202605
        ? "/yume/api/user/v1/creator/ranking/getDataCreatorRankingMonthly"
        : "/yume/api/user/v1/creator/ranking/getCreatorRanking";
    try {
      const r = await client.post<Record<string, unknown>[]>(path, {
        pageNo: 1,
        pageSize: 50,
        rankingDate: date,
        rankingType,
      });
      if (!r.success && r.code !== "200") continue;
      const hits = parseCreatorHits(asArray(r.data), youUserId, youName);
      const me = hits.find((h) => h.isYou);
      if (me) {
        featured.push({
          rankingDate: date,
          label: `${String(date).slice(0, 4)}-${String(date).slice(4)}`,
          yourRank: me.rank,
          yourScore: me.score,
          topName: hits[0]?.userName ?? null,
        });
      }
    } catch (e) {
      warnings.push(`monthly ${date}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return featured;
}

async function scrapeCharacterBoards(
  client: JuicyClient,
  ownBotIds: Set<string>,
  warnings: string[],
): Promise<CharacterBoard[]> {
  const specs = [
    { id: "char_7d", label: "Characters · 7-day", rankingDays: 7 },
    { id: "char_30d", label: "Characters · 30-day", rankingDays: 30 },
  ];
  const boards: CharacterBoard[] = [];
  for (const sp of specs) {
    const own: CharacterBoard["own"] = [];
    try {
      const r = await client.post<Record<string, unknown>[]>(
        "/yume/api/user/v1/character/getCharacterRankingList",
        {
          pageNo: 1,
          pageSize: 100,
          sortName: "chatCount",
          rankingDays: sp.rankingDays,
          unfiltered: 1,
          ruleType: 20,
        },
      );
      if (!r.success && r.code !== "200") {
        warnings.push(`${sp.id}: ${r.msg || r.code}`);
        boards.push({ id: sp.id, label: sp.label, own });
        continue;
      }
      asArray(r.data).forEach((raw, i) => {
        const id = str(raw.characterId);
        if (!id || !ownBotIds.has(id)) return;
        own.push({
          rank: i + 1,
          characterId: id,
          characterName: str(raw.characterName) || "Untitled",
          chatCount: num(raw.chatCount),
        });
      });
    } catch (e) {
      warnings.push(`${sp.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
    boards.push({ id: sp.id, label: sp.label, own });
  }
  return boards;
}

export async function scrapeTagCompetition(
  client: JuicyClient,
  bots: JuicyBot[],
  warnings: string[],
  maxTags = 6,
): Promise<TagCompetition[]> {
  const tagMap = new Map<string, { bots: number; chats: number }>();
  for (const b of bots) {
    for (const t of b.characterTags || []) {
      const tag = String(t).trim();
      if (!tag) continue;
      const cur = tagMap.get(tag) || { bots: 0, chats: 0 };
      cur.bots += 1;
      cur.chats += b.chatCount ?? 0;
      tagMap.set(tag, cur);
    }
  }
  const topTags = [...tagMap.entries()]
    .sort((a, b) => b[1].chats - a[1].chats)
    .slice(0, maxTags)
    .map(([t]) => t);

  const ownIds = new Set(bots.map((b) => b.characterId));

  const fillFromBatch = (
    tag: string,
    yours: { bots: number; chats: number },
    batch: Record<string, unknown>[],
  ): TagCompetition => {
    const row: TagCompetition = {
      tag,
      yourBots: yours.bots,
      yourChats: yours.chats,
      sampleSize: batch.length,
      topInTag: batch.slice(0, 5).map((x) => ({
        name: str(x.characterName) || "—",
        chats: num(x.chatCount) || 0,
        characterId: str(x.characterId) || "",
        from: "feed",
      })),
      yourBestRank: null,
      competitionChats: batch.reduce((s, x) => s + (num(x.chatCount) || 0), 0),
    };
    for (let i = 0; i < batch.length; i++) {
      const id = str(batch[i]!.characterId);
      if (id && ownIds.has(id)) {
        row.yourBestRank = i + 1;
        break;
      }
    }
    return row;
  };

  const fetchTag = async (tag: string): Promise<TagCompetition> => {
    const yours = tagMap.get(tag)!;
    const empty: TagCompetition = {
      tag,
      yourBots: yours.bots,
      yourChats: yours.chats,
      sampleSize: 0,
      topInTag: [],
      yourBestRank: null,
      competitionChats: 0,
    };
    try {
      const r = await client.post<Record<string, unknown>[]>(
        "/yume/api/user/v1/character/getCharacterListByTag",
        {
          pageNo: 1,
          pageSize: 30,
          characterTags: [tag],
          sortName: "popular",
          visibility: null,
          searchContent: "",
        },
      );
      let batch = r.success || r.code === "200" ? asArray(r.data) : [];
      if (!batch.length) {
        const r2 = await client.post("/yume/api/user/v1/character/getCharacterList", {
          pageNo: 1,
          pageSize: 30,
          characterTags: [tag],
          sortName: "popular",
          visibility: null,
          auditType: null,
          searchContent: "",
          gender: null,
        });
        if (!r2.success && r2.code !== "200") {
          if (!r.success && r.code !== "200") {
            warnings.push(`tag ${tag}: ${r.msg || r2.msg || r.code}`);
          }
          return empty;
        }
        batch = asArray(r2.data);
      }
      return fillFromBatch(tag, yours, batch);
    } catch (e) {
      warnings.push(`tag ${tag}: ${e instanceof Error ? e.message : String(e)}`);
      return empty;
    }
  };

  return Promise.all(topTags.map((tag) => fetchTag(tag)));
}

export async function scrapeCommentPulse(
  client: JuicyClient,
  bots: JuicyBot[],
  warnings: string[],
  limit = 10,
): Promise<CommentPulse[]> {
  const top = [...bots]
    .sort((a, b) => (b.chatCount ?? 0) - (a.chatCount ?? 0))
    .slice(0, limit);
  const out: CommentPulse[] = [];
  for (const bot of top) {
    try {
      const c = await client.post<Record<string, unknown>>(
        "/yume/api/user/v1/character/comment/getCommentPage",
        { characterId: bot.characterId, pageNo: 1, pageSize: 20 },
      );
      if (!c.success && c.code !== "200") continue;
      const batch = asArray(c.data);
      const likes = batch.reduce((s, x) => s + (num(x.likeCount) || num(x.likes) || 0), 0);
      out.push({
        characterId: bot.characterId,
        characterName: bot.characterName,
        commentsFetched: batch.length,
        approxTotal: typeof c.total === "number" ? c.total : null,
        likesOnComments: likes,
      });
    } catch (e) {
      warnings.push(`comments ${bot.characterName}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return out;
}

function median(nums: number[]): number | null {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

export function headlineRanks(leaderboards: LeaderboardBoard[]): {
  yourCreatorRank: number | null;
  yourBestBoard: string | null;
} {
  const trending = leaderboards.find((b) => b.id === "c_30d_all" && b.yourRank != null);
  const allTime = leaderboards.find((b) => b.id === "c_all_all" && b.yourRank != null);
  const pick = trending || allTime || leaderboards.find((b) => b.yourRank != null);
  return {
    yourCreatorRank: pick?.yourRank ?? null,
    yourBestBoard: pick?.label ?? null,
  };
}

export async function scrapeRanklistBoards(
  client: JuicyClient,
  options: { youUserId: string | null; youName?: string | null },
): Promise<{ leaderboards: LeaderboardBoard[]; warnings: string[] }> {
  const warnings: string[] = [];
  const youName = options.youName ?? null;
  const leaderboards = await Promise.all(
    CREATOR_BOARD_SPECS.map((sp) =>
      scrapeCreatorBoard(
        client,
        options.youUserId,
        youName,
        sp.type,
        sp.size,
        warnings,
        sp,
      ),
    ),
  );
  return { leaderboards, warnings };
}

export async function scrapeDeepSignals(
  client: JuicyClient,
  options: {
    bots: JuicyBot[];
    youUserId: string | null;
    youName?: string | null;
    /** lighter mode for faster refresh — still fetches full ranklist boards */
    light?: boolean;
    /** only the 4 creator ranklist boards */
    ranklistOnly?: boolean;
  },
): Promise<DeepSignals> {
  const warnings: string[] = [];
  const ownBotIds = new Set(options.bots.map((b) => b.characterId));
  const light = options.light === true || options.ranklistOnly === true;
  const youName = options.youName ?? null;

  const userInfoCount = options.ranklistOnly
    ? null
    : await fetchUserInfoCount(client, warnings);

  // Ranklist first and independently so a later timeout cannot wipe boards.
  const { leaderboards, warnings: boardWarn } = await scrapeRanklistBoards(client, {
    youUserId: options.youUserId,
    youName,
  });
  warnings.push(...boardWarn);

  let botEnrichment: BotEnrichment[] = [];
  let characterRanks: CharacterRankHit[] = [];
  let monthlyNew: MonthlyNewHit[] = [];
  let characterBoards: CharacterBoard[] = [];
  let tagCompetition: TagCompetition[] = [];
  let commentPulse: CommentPulse[] = [];

  if (!options.ranklistOnly) {
    if (light) {
      const rest = await Promise.all([
        scrapeCharacterBoards(client, ownBotIds, warnings).catch((e) => {
          warnings.push(`characterBoards: ${e instanceof Error ? e.message : String(e)}`);
          return [] as CharacterBoard[];
        }),
        scrapeTagCompetition(client, options.bots, warnings, 6).catch((e) => {
          warnings.push(`tagCompetition: ${e instanceof Error ? e.message : String(e)}`);
          return [] as TagCompetition[];
        }),
      ]);
      characterBoards = rest[0];
      tagCompetition = rest[1];
    } else {
      const rest = await Promise.all([
        enrichTopBots(client, options.bots, warnings, 16).catch((e) => {
          warnings.push(`enrich: ${e instanceof Error ? e.message : String(e)}`);
          return [] as BotEnrichment[];
        }),
        scrapeCharacterRankings(client, ownBotIds, warnings, 3).catch((e) => {
          warnings.push(`characterRanks: ${e instanceof Error ? e.message : String(e)}`);
          return [] as CharacterRankHit[];
        }),
        scrapeMonthlyNewBoards(client, options.youUserId, youName, warnings).catch((e) => {
          warnings.push(`monthlyNew: ${e instanceof Error ? e.message : String(e)}`);
          return [] as MonthlyNewHit[];
        }),
        scrapeCharacterBoards(client, ownBotIds, warnings).catch((e) => {
          warnings.push(`characterBoards: ${e instanceof Error ? e.message : String(e)}`);
          return [] as CharacterBoard[];
        }),
        scrapeTagCompetition(client, options.bots, warnings, 6).catch((e) => {
          warnings.push(`tagCompetition: ${e instanceof Error ? e.message : String(e)}`);
          return [] as TagCompetition[];
        }),
        scrapeCommentPulse(client, options.bots, warnings, 10).catch((e) => {
          warnings.push(`commentPulse: ${e instanceof Error ? e.message : String(e)}`);
          return [] as CommentPulse[];
        }),
      ]);
      botEnrichment = rest[0];
      characterRanks = rest[1];
      monthlyNew = rest[2];
      characterBoards = rest[3];
      tagCompetition = rest[4];
      commentPulse = rest[5];
    }
  }

  const ownCharacterRanks = characterRanks.filter((h) => h.isOwn);
  const { yourCreatorRank, yourBestBoard } = headlineRanks(leaderboards);
  const creatorRanks = leaderboards[0]?.listings?.length
    ? leaderboards[0].listings
    : (leaderboards[0]?.top ?? []);
  const monthlyCreatorRanks: CreatorRankHit[] = [];

  const chats = options.bots.map((b) => b.chatCount ?? 0).sort((a, b) => b - a);
  const totalChats = chats.reduce((s, n) => s + n, 0);
  const top10 = chats.slice(0, 10).reduce((s, n) => s + n, 0);
  const scores = options.bots.map((b) => b.score10).filter((n): n is number => typeof n === "number");
  const likes = options.bots.reduce((s, b) => s + (b.likeCount ?? 0), 0);
  const favs = options.bots.reduce((s, b) => s + (b.favoriteCount ?? 0), 0);

  return {
    scrapedAt: new Date().toISOString(),
    userInfoCount,
    botEnrichment,
    characterRanks: characterRanks.slice(0, 40),
    ownCharacterRanks,
    creatorRanks: creatorRanks.slice(0, 30),
    yourCreatorRank,
    yourBestBoard,
    leaderboards,
    monthlyNew,
    characterBoards,
    monthlyCreatorRanks: monthlyCreatorRanks.slice(0, 30),
    tagCompetition,
    commentPulse,
    quality: {
      avgScore10: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null,
      medianChats: median(chats),
      top10ChatShare: totalChats > 0 ? top10 / totalChats : null,
      botsWithComments: commentPulse.filter((c) => (c.approxTotal ?? c.commentsFetched) > 0).length,
      botsRanked: ownCharacterRanks.length,
      engagementRate: totalChats > 0 ? (likes + favs) / totalChats : null,
    },
    warnings,
  };
}
