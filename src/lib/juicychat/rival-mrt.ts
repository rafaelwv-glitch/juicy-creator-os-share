/**
 * Rival MRT (market-research dossier) from public signals only.
 * Own-account APIs are never used here.
 */
import { liftBaseImmersive, type JuicyBot, type LoungeSnapshot } from "./types";
import type { LeaderboardBoard } from "./deep-signals";

const TZ = "Europe/Madrid";
const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export type RivalSource = "manual" | "neighbor";

export type RivalRankSeed = {
  chats?: number;
  likes?: number;
  followers?: number;
  bots?: number;
  score?: number;
};

export type RivalLaunchRecent = {
  characterId: string;
  characterName: string;
  publishedAt: string;
  ageDays: number;
  chats: number;
};

export type RivalTopicRow = {
  tag: string;
  yourBots: number;
  yourChats: number;
  rivalBots: number;
  rivalChats: number;
};

export type RivalInferredTopic = {
  topic: string;
  rivalBots: number;
  yourBots: number;
  rivalChats: number;
  yourChats: number;
};

export type RivalTrafficBot = {
  characterId: string;
  characterName: string;
  characterThumb?: string;
  chats: number;
  likes: number;
  favorites: number;
  score10?: number;
  ageDays: number | null;
  tags: string[];
  feeds: string[];
  publishedAt?: string | null;
};

export type RivalMrt = {
  analyzedAt: string;
  userId: string;
  userName: string;
  rank30d: number | null;
  rankAllTime: number | null;
  rankNew30d: number | null;
  profile: {
    chats: number;
    likes: number;
    favorites: number;
    followers: number;
    following: number | null;
    bots: number;
    publicBots: number;
    characterCount: number | null;
    bio: string | null;
  };
  vsYou: {
    chatRatio: number | null;
    likeRatio: number | null;
    followerRatio: number | null;
    botRatio: number | null;
    dodChats: number | null;
    d7Chats: number | null;
  };
  traffic: {
    top3Share: number | null;
    medianChats: number | null;
    chatsPerBot: number | null;
    engagement: number | null;
    topBots: RivalTrafficBot[];
  };
  launch: {
    withPublish: number;
    last7: number;
    last30: number;
    last90: number;
    meanGapDays: number | null;
    newestAgeDays: number | null;
    oldestAgeDays: number | null;
    cadence: "burst" | "steady" | "sparse" | "unknown";
    byDow: Array<{ day: number; label: string; n: number }>;
    byHour: Array<{ hour: number; n: number }>;
    bestSlot: string | null;
    recent: RivalLaunchRecent[];
  };
  topics: {
    overlap: RivalTopicRow[];
    rivalOnly: Array<{ tag: string; bots: number; chats: number }>;
    yourOnly: Array<{ tag: string; bots: number; chats: number }>;
    inferred: RivalInferredTopic[];
  };
  discovery: {
    onEditor: number;
    onTrending: number;
    onPopular: number;
    onRecent: number;
    onNew: number;
    onImmersive: number;
    bots: Array<{ characterId: string; characterName: string; feeds: string[]; ranks: Record<string, number> }>;
  };
  characterRanks30d: Array<{ characterId: string; characterName: string; rank: number; chats: number }>;
  enrichment: Array<{
    characterId: string;
    commentCount?: number | null;
    commentSample?: number | null;
    definitionLen?: number | null;
    score10?: number | null;
    memoryCount?: number | null;
    galleryCount?: number | null;
    genPictureCount?: number | null;
    shareCount?: number | null;
    hasSceneCard?: boolean | null;
  }>;
};

/** Compact daily MRT kept forever (90d/creator) so warehouse can answer later questions. */
export type RivalMrtDay = {
  date: string;
  analyzedAt: string;
  rank30d: number | null;
  rankAllTime: number | null;
  chats: number;
  likes: number;
  favorites: number;
  followers: number;
  bots: number;
  publicBots: number;
  launches7: number;
  launches30: number;
  launches90: number;
  cadence: RivalMrt["launch"]["cadence"];
  meanGapDays: number | null;
  bestSlot: string | null;
  byDow: Array<{ day: number; label: string; n: number }>;
  byHour: Array<{ hour: number; n: number }>;
  top3Share: number | null;
  medianChats: number | null;
  engagement: number | null;
  overlap: Array<{ tag: string; yourBots: number; rivalBots: number; yourChats: number; rivalChats: number }>;
  rivalOnly: Array<{ tag: string; bots: number; chats: number }>;
  inferred: Array<{ topic: string; rivalBots: number; yourBots: number }>;
  discovery: { onEditor: number; onTrending: number; onPopular: number; onRecent: number; onNew: number; onImmersive: number };
  topBots: Array<{
    characterId: string;
    characterName: string;
    chats: number;
    likes: number;
    ageDays: number | null;
    tags: string[];
    feeds: string[];
  }>;
  recent: Array<{ characterId: string; characterName: string; ageDays: number; chats: number }>;
  vsYou: { chatRatio: number | null; followerRatio: number | null; botRatio: number | null };
  characterRanks30d: Array<{ characterId: string; characterName: string; rank: number; chats: number }>;
  enrichment: RivalMrt["enrichment"];
};

export function compactRivalMrtDay(m: RivalMrt, date: string): RivalMrtDay {
  return {
    date,
    analyzedAt: m.analyzedAt,
    rank30d: m.rank30d,
    rankAllTime: m.rankAllTime,
    chats: m.profile.chats,
    likes: m.profile.likes,
    favorites: m.profile.favorites,
    followers: m.profile.followers,
    bots: m.profile.bots,
    publicBots: m.profile.publicBots,
    launches7: m.launch.last7,
    launches30: m.launch.last30,
    launches90: m.launch.last90,
    cadence: m.launch.cadence,
    meanGapDays: m.launch.meanGapDays,
    bestSlot: m.launch.bestSlot,
    byDow: m.launch.byDow,
    byHour: m.launch.byHour,
    top3Share: m.traffic.top3Share,
    medianChats: m.traffic.medianChats,
    engagement: m.traffic.engagement,
    overlap: m.topics.overlap.slice(0, 8).map((t) => ({
      tag: t.tag,
      yourBots: t.yourBots,
      rivalBots: t.rivalBots,
      yourChats: t.yourChats,
      rivalChats: t.rivalChats,
    })),
    rivalOnly: m.topics.rivalOnly.slice(0, 6),
    inferred: m.topics.inferred.slice(0, 6).map((t) => ({
      topic: t.topic,
      rivalBots: t.rivalBots,
      yourBots: t.yourBots,
    })),
    discovery: {
      onEditor: m.discovery.onEditor,
      onTrending: m.discovery.onTrending,
      onPopular: m.discovery.onPopular,
      onRecent: m.discovery.onRecent,
      onNew: m.discovery.onNew,
      onImmersive: m.discovery.onImmersive ?? 0,
    },
    topBots: m.traffic.topBots.slice(0, 8).map((b) => ({
      characterId: b.characterId,
      characterName: b.characterName,
      chats: b.chats,
      likes: b.likes,
      ageDays: b.ageDays,
      tags: (b.tags || []).slice(0, 4),
      feeds: b.feeds || [],
    })),
    recent: m.launch.recent.slice(0, 6).map((b) => ({
      characterId: b.characterId,
      characterName: b.characterName,
      ageDays: b.ageDays,
      chats: b.chats,
    })),
    vsYou: {
      chatRatio: m.vsYou.chatRatio,
      followerRatio: m.vsYou.followerRatio,
      botRatio: m.vsYou.botRatio,
    },
    characterRanks30d: (m.characterRanks30d || []).slice(0, 8),
    enrichment: (m.enrichment || []).slice(0, 8),
  };
}

export type NeighborPick = {
  you: { userId: string; userName: string; rank: number } | null;
  above: Array<{
    userId: string;
    userName: string;
    rank: number;
    chatCount?: number;
    likeCount?: number;
    followersCount?: number;
    characterCount?: number;
    score?: number;
  }>;
  below: Array<{
    userId: string;
    userName: string;
    rank: number;
    chatCount?: number;
    likeCount?: number;
    followersCount?: number;
    characterCount?: number;
    score?: number;
  }>;
};

function toMs(v: string | number | null | undefined): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n < 1e12 ? Math.round(n * 1000) : Math.round(n);
}

export function ageDays(v: string | number | null | undefined, now = Date.now()): number | null {
  const ms = toMs(v);
  if (ms == null) return null;
  return Math.max(0, (now - ms) / 86_400_000);
}

function madridParts(ms: number) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    weekday: "short",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(ms));
  const wd = parts.find((p) => p.type === "weekday")?.value || "";
  const hour = Number(parts.find((p) => p.type === "hour")?.value || 0);
  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { day: dayMap[wd] ?? 0, hour: Number.isFinite(hour) ? hour : 0 };
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

function ratio(a: number, b: number): number | null {
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= 0) return null;
  return a / b;
}

function tagKey(t: string) {
  return String(t || "")
    .trim()
    .toLowerCase();
}

const TOPIC_RULES: Array<{ topic: string; re: RegExp }> = [
  { topic: "NTR / cheating", re: /\b(ntr|pre-?ntr|netorare|cuck|cheating|affair|jealous)\b/i },
  { topic: "Hurt / heartbreak", re: /\b(hurt|heartbreak|broken|betrayal)\b/i },
  { topic: "Slow burn", re: /slow\s*burn/i },
  { topic: "CNC / kink", re: /\b(cnc|kink|femdom|bdsm)\b/i },
  { topic: "Healing / second chance", re: /\b(healing|second chance)\b/i },
  { topic: "Spouse / partner", re: /\b(wife|husband|spouse|married)\b/i },
  { topic: "Yandere", re: /yandere/i },
  { topic: "Dark romance", re: /\b(dark romance|dark)\b/i },
  { topic: "Comedy", re: /\b(comedy|funny)\b/i },
  { topic: "Wholesome", re: /wholesome/i },
  { topic: "Drama", re: /\bdrama\b/i },
  { topic: "Romance", re: /\bromance\b/i },
];

function inferTopics(name: string, intro: string, tags: string[]): string[] {
  const hay = `${name}\n${intro}\n${tags.join(" ")}`;
  const out = new Set<string>();
  for (const rule of TOPIC_RULES) {
    if (rule.re.test(hay)) out.add(rule.topic);
  }
  for (const t of tags) {
    const k = tagKey(t);
    if (k.includes("ntr") || k.includes("cheating") || k.includes("netorare")) out.add("NTR / cheating");
    if (k.includes("slow")) out.add("Slow burn");
    if (k.includes("comedy")) out.add("Comedy");
    if (k.includes("romance")) out.add("Romance");
    if (k.includes("drama")) out.add("Drama");
    if (k.includes("yandere")) out.add("Yandere");
    if (k.includes("wholesome")) out.add("Wholesome");
  }
  return [...out];
}

function tagBag(bots: JuicyBot[]) {
  const map = new Map<string, { tag: string; bots: number; chats: number }>();
  for (const b of bots) {
    for (const t of b.characterTags || []) {
      const k = tagKey(t);
      if (!k) continue;
      const cur = map.get(k) || { tag: String(t).trim(), bots: 0, chats: 0 };
      cur.bots += 1;
      cur.chats += b.chatCount ?? 0;
      if (cur.tag.length < String(t).trim().length) cur.tag = String(t).trim();
      map.set(k, cur);
    }
  }
  return map;
}

export function classifyCadence(last30: number, meanGapDays: number | null): RivalMrt["launch"]["cadence"] {
  if (last30 >= 9 || (meanGapDays != null && meanGapDays > 0 && meanGapDays < 4)) return "burst";
  if (last30 >= 3 || (meanGapDays != null && meanGapDays <= 14)) return "steady";
  if (last30 <= 0 && meanGapDays == null) return "unknown";
  return "sparse";
}

type RankHit = {
  userId: string;
  userName: string;
  rank: number;
  isYou?: boolean;
  chatCount?: number;
  likeCount?: number;
  followersCount?: number;
  characterCount?: number;
  score?: number;
};

export function pickNeighbors(board: LeaderboardBoard | null | undefined, n = 3): NeighborPick {
  const empty: NeighborPick = { you: null, above: [], below: [] };
  if (!board) return empty;
  const pool: RankHit[] = [];
  for (const list of [board.aroundYou, board.listings, board.top] as Array<RankHit[] | undefined>) {
    for (const h of list || []) {
      if (!h?.userId || !Number.isFinite(h.rank)) continue;
      pool.push(h);
    }
  }
  const byId = new Map<string, RankHit>();
  for (const h of pool) {
    if (!byId.has(h.userId)) byId.set(h.userId, h);
  }
  const youHit =
    [...byId.values()].find((h) => h.isYou) ||
    (board.yourRank != null
      ? [...byId.values()].find((h) => h.rank === board.yourRank)
      : undefined);
  if (!youHit) return empty;
  const youRank = youHit.rank;
  const others = [...byId.values()].filter((h) => !h.isYou && h.userId !== youHit.userId);
  const aboveHits = others
    .filter((h) => h.rank < youRank)
    .sort((a, b) => b.rank - a.rank)
    .slice(0, n)
    .sort((a, b) => a.rank - b.rank);
  const belowHits = others
    .filter((h) => h.rank > youRank)
    .sort((a, b) => a.rank - b.rank)
    .slice(0, n);
  const toRow = (h: RankHit) => ({
    userId: h.userId,
    userName: h.userName,
    rank: h.rank,
    chatCount: h.chatCount,
    likeCount: h.likeCount,
    followersCount: h.followersCount,
    characterCount: h.characterCount,
    score: h.score,
  });
  return {
    you: { userId: youHit.userId, userName: youHit.userName, rank: youRank },
    above: aboveHits.map(toRow),
    below: belowHits.map(toRow),
  };
}

export type DiscoveryLite = {
  feeds?: Array<{
    id: string;
    hits?: Array<{ characterId: string; characterName?: string; rank: number; userId?: string }>;
    allHits?: Array<{
      characterId: string;
      characterName?: string;
      rank: number;
      userId?: string;
      userName?: string;
      chats?: number;
    }>;
  }>;
} | null;

export type EnrichLite = Array<{
  characterId: string;
  commentCount?: number | null;
  commentSample?: number | null;
  definitionLen?: number | null;
  detailScore10?: number | null;
  score10?: number | null;
  memoryCount?: number | null;
  galleryCount?: number | null;
  genPictureCount?: number | null;
  shareCount?: number | null;
  hasSceneCard?: boolean | null;
}>;

export function analyzeRivalMrt(input: {
  rival: LoungeSnapshot;
  you?: LoungeSnapshot | null;
  dodChats?: number | null;
  d7Chats?: number | null;
  boards?: LeaderboardBoard[] | null;
  discovery?: DiscoveryLite;
  enrichment?: EnrichLite | null;
  characterRanks30d?: Array<{ characterId: string; characterName: string; rank: number; chats: number }>;
  rank30d?: number | null;
}): RivalMrt {
  const now = Date.now();
  const bots = input.rival.bots || [];
  const youBots = input.you?.bots || [];
  const p = input.rival.profile;
  const t = input.rival.totals;
  const chats = p?.chatCount ?? t?.chats ?? bots.reduce((s, b) => s + (b.chatCount ?? 0), 0);
  const likes = p?.likeCount ?? t?.likes ?? 0;
  const favorites = p?.favoriteCount ?? t?.favorites ?? 0;
  const followers = p?.followersCount ?? t?.followers ?? 0;
  const youChats = input.you?.profile?.chatCount ?? input.you?.totals?.chats ?? 0;
  const youLikes = input.you?.profile?.likeCount ?? input.you?.totals?.likes ?? 0;
  const youFollowers = input.you?.profile?.followersCount ?? input.you?.totals?.followers ?? 0;
  const youBotN = input.you?.totals?.bots ?? youBots.length;

  const chatList = bots.map((b) => b.chatCount ?? 0).sort((a, b) => b - a);
  const top3 = chatList.slice(0, 3).reduce((s, n) => s + n, 0);
  const chatSum = chatList.reduce((s, n) => s + n, 0);

  const pubMs = bots
    .map((b) => ({ b, ms: toMs(b.gmtFirstPublish ?? b.gmtCreate) }))
    .filter((x): x is { b: JuicyBot; ms: number } => x.ms != null)
    .sort((a, b) => a.ms - b.ms);

  const ages = pubMs.map((x) => (now - x.ms) / 86_400_000);
  const last7 = pubMs.filter((x) => now - x.ms <= 7 * 86_400_000).length;
  const last30 = pubMs.filter((x) => now - x.ms <= 30 * 86_400_000).length;
  const last90 = pubMs.filter((x) => now - x.ms <= 90 * 86_400_000).length;
  const gaps: number[] = [];
  for (let i = 1; i < pubMs.length; i++) {
    gaps.push((pubMs[i]!.ms - pubMs[i - 1]!.ms) / 86_400_000);
  }
  const meanGap = gaps.length ? gaps.reduce((s, n) => s + n, 0) / gaps.length : null;

  const byDow = DAY_LABELS.map((label, day) => ({ day, label, n: 0 }));
  const byHour = Array.from({ length: 24 }, (_, hour) => ({ hour, n: 0 }));
  const slot = new Map<string, number>();
  for (const x of pubMs) {
    const { day, hour } = madridParts(x.ms);
    byDow[day]!.n += 1;
    byHour[hour]!.n += 1;
    const key = `${DAY_LABELS[day]} ${String(hour).padStart(2, "0")}:00`;
    slot.set(key, (slot.get(key) || 0) + 1);
  }
  let bestSlot: string | null = null;
  let bestN = 0;
  for (const [k, n] of slot) {
    if (n > bestN) {
      bestN = n;
      bestSlot = k;
    }
  }

  const rivalTags = tagBag(bots);
  const yourTags = tagBag(youBots);
  const overlap: RivalTopicRow[] = [];
  const rivalOnly: Array<{ tag: string; bots: number; chats: number }> = [];
  for (const [k, row] of rivalTags) {
    const yours = yourTags.get(k);
    if (yours) {
      overlap.push({
        tag: row.tag,
        yourBots: yours.bots,
        yourChats: yours.chats,
        rivalBots: row.bots,
        rivalChats: row.chats,
      });
    } else {
      rivalOnly.push({ tag: row.tag, bots: row.bots, chats: row.chats });
    }
  }
  overlap.sort((a, b) => b.rivalChats + b.yourChats - (a.rivalChats + a.yourChats));
  rivalOnly.sort((a, b) => b.chats - a.chats);
  const yourOnly = [...yourTags.entries()]
    .filter(([k]) => !rivalTags.has(k))
    .map(([, row]) => ({ tag: row.tag, bots: row.bots, chats: row.chats }))
    .sort((a, b) => b.chats - a.chats);

  const inferBag = (list: JuicyBot[]) => {
    const m = new Map<string, { bots: number; chats: number }>();
    for (const b of list) {
      for (const topic of inferTopics(b.characterName || "", b.introduction || "", b.characterTags || [])) {
        const cur = m.get(topic) || { bots: 0, chats: 0 };
        cur.bots += 1;
        cur.chats += b.chatCount ?? 0;
        m.set(topic, cur);
      }
    }
    return m;
  };
  const rivalInf = inferBag(bots);
  const yourInf = inferBag(youBots);
  const inferred: RivalInferredTopic[] = [];
  const topics = new Set([...rivalInf.keys(), ...yourInf.keys()]);
  for (const topic of topics) {
    const r = rivalInf.get(topic) || { bots: 0, chats: 0 };
    const y = yourInf.get(topic) || { bots: 0, chats: 0 };
    if (r.bots + y.bots === 0) continue;
    inferred.push({
      topic,
      rivalBots: r.bots,
      yourBots: y.bots,
      rivalChats: r.chats,
      yourChats: y.chats,
    });
  }
  inferred.sort((a, b) => b.rivalChats + b.yourChats - (a.rivalChats + a.yourChats));

  const discHits = new Map<string, { name: string; feeds: string[]; ranks: Record<string, number> }>();
  const rivalUserId = String(input.rival.userId || p?.userId || "");
  const ownBotIds = new Set(bots.map((b) => b.characterId));
  for (const feed of input.discovery?.feeds || []) {
    const pool = [...(feed.hits || []), ...(feed.allHits || [])];
    for (const hit of pool) {
      const theirs =
        ownBotIds.has(hit.characterId) ||
        (hit.userId != null && rivalUserId !== "" && String(hit.userId) === rivalUserId);
      if (!theirs) continue;
      const cur = discHits.get(hit.characterId) || {
        name: hit.characterName || "",
        feeds: [],
        ranks: {},
      };
      if (!cur.feeds.includes(feed.id)) cur.feeds.push(feed.id);
      cur.ranks[feed.id] = hit.rank;
      if (hit.characterName) cur.name = hit.characterName;
      discHits.set(hit.characterId, cur);
    }
  }
  const countFeed = (id: string) => [...discHits.values()].filter((d) => d.feeds.includes(id)).length;

  const feedFromBase = (b: JuicyBot) => {
    const feeds: string[] = [];
    if ((b.baseEditor ?? 0) > 0) feeds.push("editor");
    if ((b.baseTrending ?? 0) > 0) feeds.push("trending");
    if ((liftBaseImmersive(b) ?? 0) > 0) feeds.push("immersive");
    if ((b.basePopular ?? 0) > 0) feeds.push("popular");
    if ((b.baseRecent ?? 0) > 0) feeds.push("recent");
    const extra = discHits.get(b.characterId);
    if (extra) for (const f of extra.feeds) if (!feeds.includes(f)) feeds.push(f);
    return feeds;
  };

  const topBots: RivalTrafficBot[] = [...bots]
    .sort((a, b) => (b.chatCount ?? 0) - (a.chatCount ?? 0))
    .slice(0, 12)
    .map((b) => ({
      characterId: b.characterId,
      characterName: b.characterName,
      characterThumb: b.characterThumb || b.characterPhoto,
      chats: b.chatCount ?? 0,
      likes: b.likeCount ?? 0,
      favorites: b.favoriteCount ?? 0,
      score10: b.score10,
      ageDays: ageDays(b.gmtFirstPublish ?? b.gmtCreate, now),
      tags: (b.characterTags || []).slice(0, 6),
      feeds: feedFromBase(b),
      publishedAt: toMs(b.gmtFirstPublish ?? b.gmtCreate)
        ? new Date(toMs(b.gmtFirstPublish ?? b.gmtCreate)!).toISOString()
        : null,
    }));

  const boards = input.boards || [];
  const rankOf = (id: string) => {
    const b = boards.find((x) => x.id === id);
    const hit = [...(b?.aroundYou || []), ...(b?.listings || []), ...(b?.top || [])].find(
      (h) => h.userId === input.rival.userId,
    );
    return hit?.rank ?? (input.rank30d != null && id === "c_30d_all" ? input.rank30d : null);
  };

  return {
    analyzedAt: new Date().toISOString(),
    userId: input.rival.userId,
    userName: p?.userName || input.rival.userId,
    rank30d: rankOf("c_30d_all"),
    rankAllTime: rankOf("c_all_all"),
    rankNew30d: rankOf("c_30d_new"),
    profile: {
      chats,
      likes,
      favorites,
      followers,
      following: p?.followingCount ?? null,
      bots: t?.bots ?? bots.length,
      publicBots: t?.publicBots ?? bots.filter((b) => b.visibility === 2 || b.visibility == null).length,
      characterCount: p?.characterCount ?? null,
      bio: p?.userBio ? String(p.userBio).slice(0, 280) : null,
    },
    vsYou: {
      chatRatio: ratio(chats, youChats),
      likeRatio: ratio(likes, youLikes),
      followerRatio: ratio(followers, youFollowers),
      botRatio: ratio(t?.bots ?? bots.length, youBotN),
      dodChats: input.dodChats ?? null,
      d7Chats: input.d7Chats ?? null,
    },
    traffic: {
      top3Share: chatSum > 0 ? top3 / chatSum : null,
      medianChats: median(chatList),
      chatsPerBot: bots.length ? chats / bots.length : null,
      engagement: chats > 0 ? (likes + favorites) / chats : null,
      topBots,
    },
    launch: {
      withPublish: pubMs.length,
      last7,
      last30,
      last90,
      meanGapDays: meanGap,
      newestAgeDays: ages.length ? Math.min(...ages) : null,
      oldestAgeDays: ages.length ? Math.max(...ages) : null,
      cadence: classifyCadence(last30, meanGap),
      byDow,
      byHour,
      bestSlot: bestN >= 2 ? bestSlot : null,
      recent: [...pubMs]
        .reverse()
        .slice(0, 8)
        .map((x) => ({
          characterId: x.b.characterId,
          characterName: x.b.characterName,
          publishedAt: new Date(x.ms).toISOString(),
          ageDays: (now - x.ms) / 86_400_000,
          chats: x.b.chatCount ?? 0,
        })),
    },
    topics: {
      overlap: overlap.slice(0, 16),
      rivalOnly: rivalOnly.slice(0, 12),
      yourOnly: yourOnly.slice(0, 8),
      inferred: inferred.slice(0, 10),
    },
    discovery: {
      onEditor: countFeed("editor") || bots.filter((b) => (b.baseEditor ?? 0) > 0).length,
      onTrending: countFeed("trending") || bots.filter((b) => (b.baseTrending ?? 0) > 0).length,
      onImmersive: countFeed("immersive") || bots.filter((b) => (liftBaseImmersive(b) ?? 0) > 0).length,
      onPopular: countFeed("popular") || bots.filter((b) => (b.basePopular ?? 0) > 0).length,
      onRecent: countFeed("recent") || bots.filter((b) => (b.baseRecent ?? 0) > 0).length,
      onNew: countFeed("new"),
      bots: [...discHits.entries()].map(([id, v]) => ({
        characterId: id,
        characterName: v.name,
        feeds: v.feeds,
        ranks: v.ranks,
      })),
    },
    characterRanks30d: input.characterRanks30d || [],
    enrichment: (input.enrichment || []).map((e) => ({
      characterId: e.characterId,
      commentCount: e.commentCount ?? null,
      commentSample: e.commentSample ?? null,
      definitionLen: e.definitionLen ?? null,
      score10: e.detailScore10 ?? e.score10 ?? null,
      memoryCount: e.memoryCount ?? null,
      galleryCount: e.galleryCount ?? null,
      genPictureCount: e.genPictureCount ?? null,
      shareCount: e.shareCount ?? null,
      hasSceneCard: e.hasSceneCard ?? null,
    })),
  };
}
