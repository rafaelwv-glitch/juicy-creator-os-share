/**
 * Bot forensics archive.
 *
 * Store every useful signal we can reach (tags, topics, metrics, discovery,
 * notifications-by-day, extras). Analysis (why / when) is derived on read so
 * we can invent new questions later without having missed the raw history.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dataPath, ensureDataDir } from "./paths";
import { loadHistory, dayKey } from "./history";
import { loadNotifStore, type NotifEvent } from "./notifications";
import { loadCreatorInsights, type CreatorInsights, type DiscoveryFeedId } from "./insights";
import { liftBaseImmersive, type JuicyBot, type LoungeSnapshot } from "./types";
import type { DeepSignals } from "./deep-signals";
import type { TimingAnalysis } from "./notifications";
import type { PublishAnalysis } from "./publish-analysis";
import type { TagForensics } from "./tag-forensics";
import { loungeTimezone } from "./timezone-server";
import { timezoneCity } from "./timezone";

const FILE = "bot-forensics.json";
const MAX_IDENTITY_REVISIONS = 48;

export type ForensicNotifBucket = {
  likes: number;
  favorites: number;
  comments: number;
  gifts: number;
  follows: number;
  other: number;
  hourHist: number[];
};

export type ForensicDayPoint = {
  date: string;
  scrapedAt: string;
  chats: number;
  likes: number;
  favorites: number;
  interactions: number;
  dChats?: number;
  dLikes?: number;
  dFavorites?: number;
  score10?: number;
  score20?: number;
  comments?: number;
  memoryCount?: number;
  galleryCount?: number;
  genPictureCount?: number;
  visibility?: number | null;
  basePopular?: number;
  baseTrending?: number;
  baseRecent?: number;
  baseEditor?: number;
  baseImmersive?: number;
  discovery?: Partial<Record<DiscoveryFeedId, number>>;
  characterRank?: number;
  notifs?: ForensicNotifBucket;
  extrasKeys?: string[];
  shareCount?: number;
  textLength?: number;
  galleryPageView?: number;
  revenueGems?: number;
};

export type ForensicIdentity = {
  characterId: string;
  characterName: string;
  characterThumb?: string;
  introduction?: string;
  personality?: string;
  tags: string[];
  topics: string[];
  gender?: number;
  rating?: string | number | null;
  visibility?: number | null;
  gmtCreate?: string | number;
  gmtFirstPublish?: string | number;
  gmtModified?: string | number;
  figureId?: string;
  extras: Record<string, unknown>;
  updatedAt: string;
};

export type IdentityRevision = {
  at: string;
  name: string;
  tags: string[];
  topics: string[];
  intro?: string;
};

export type ForensicFan = {
  senderId: string;
  senderName?: string;
  likes: number;
  favorites: number;
  comments: number;
  gifts: number;
  firstTs: number;
  lastTs: number;
};

export type ForensicBot = {
  identity: ForensicIdentity;
  identityRevisions: IdentityRevision[];
  days: ForensicDayPoint[];
  commenters?: Array<{ ts: number; senderName?: string; messageId: string }>;
  /** Who liked / starred / commented — unique people, never trimmed. */
  fans?: Record<string, ForensicFan>;
};

export type ForensicCreatorDay = {
  date: string;
  scrapedAt: string;
  chats: number;
  likes: number;
  favorites: number;
  interactions: number;
  followers: number;
  bots: number;
  publicBots?: number;
  privateBots?: number;
  unlistedBots?: number;
  stats?: Record<string, unknown>;
  benefit?: Record<string, unknown>;
  ownCharacterData?: Record<string, unknown>;
  space?: Record<string, unknown>;
  economy?: {
    coin?: number;
    gems?: number;
    gemsTotal?: number;
    incomeGems?: number;
    frozenGems?: number;
    vipMaxCoin?: number;
    checkInStreak?: number;
    campaignCount?: number;
    spacePublicChars?: number;
    plazaUserPics?: number;
    memoriesPublic?: number;
    memoriesPrivate?: number;
    figuresOwned?: number;
    videosOwned?: number;
    backpackItems?: number;
  };
};

export type ForensicFile = {
  version: 1;
  timezone: string;
  lastIngestAt: string | null;
  sources: Record<string, string | null>;
  seenExtraKeys: string[];
  followDays: Record<string, ForensicNotifBucket>;
  creatorDays: Record<string, ForensicCreatorDay>;
  bots: Record<string, ForensicBot>;
};

export type WhyFactor = {
  kind:
    | "tag"
    | "topic"
    | "publish-slot"
    | "discovery"
    | "velocity"
    | "score"
    | "comments"
    | "age"
    | "evergreen"
    | "timing"
    | "audience";
  label: string;
  detail: string;
  lift: number | null;
  weight: number;
};

export type WhenSignal = {
  kind: "publish" | "spike" | "quiet" | "best-hour" | "best-day" | "first-week" | "latest";
  at: string;
  label: string;
  value?: number;
};

export type TagBoardRow = {
  tag: string;
  bots: number;
  chats: number;
  chatsPerDay: number;
  dChats: number;
  lift: number;
};

export type TopicBoardRow = {
  topic: string;
  bots: number;
  chats: number;
  chatsPerDay: number;
  dChats: number;
  lift: number;
};

export type ForensicBotSummary = {
  characterId: string;
  characterName: string;
  characterThumb?: string;
  tags: string[];
  topics: string[];
  chats: number;
  likes: number;
  favorites: number;
  dChats: number;
  chatsPerDay: number;
  ageDays: number | null;
  topWhy: string | null;
  publishedAt: string | null;
  uniqueLikers?: number;
  uniqueStarrers?: number;
  uniquePeople?: number;
  returningFans?: number;
};

export type ForensicIndex = {
  scrapedAt: string;
  daysTracked: number;
  botCount: number;
  seenExtraKeys: string[];
  sources: Record<string, string | null>;
  followDays: number;
  creatorDays: number;
  tagBoard: TagBoardRow[];
  topicBoard: TopicBoardRow[];
  bots: ForensicBotSummary[];
  audience: AudienceIndex;
  warehouse?: TagForensics;
};

export type AudiencePerson = {
  senderId: string;
  senderName?: string;
  likes: number;
  favorites: number;
  comments: number;
  gifts: number;
  bots: number;
  lastTs: number;
};

export type AudienceCrossover = {
  aId: string;
  aName: string;
  bId: string;
  bName: string;
  shared: number;
  likes: number;
  stars: number;
};

export type AudiencePattern = {
  id: string;
  label: string;
  detail: string;
  n: number;
};

export type AudienceIndex = {
  uniqueLikers: number;
  uniqueStarrers: number;
  uniquePeople: number;
  recurringPeople: number;
  returningOnSameBot: number;
  likeThenStar: number;
  events: number;
  topFans: AudiencePerson[];
  crossovers: AudienceCrossover[];
  patterns: AudiencePattern[];
};

export type BotFanRow = {
  senderId: string;
  senderName?: string;
  likes: number;
  favorites: number;
  comments: number;
  gifts: number;
  firstTs: number;
  lastTs: number;
};

export type BotAudience = {
  uniqueLikers: number;
  uniqueStarrers: number;
  uniquePeople: number;
  returning: number;
  likeThenStar: number;
  likers: BotFanRow[];
  starrers: BotFanRow[];
  topFans: BotFanRow[];
  alsoOn: Array<{ characterId: string; characterName: string; shared: number }>;
};

export type ForensicReport = {
  summary: ForensicBotSummary;
  identity: ForensicIdentity;
  why: WhyFactor[];
  when: WhenSignal[];
  timeline: ForensicDayPoint[];
  tags: TagBoardRow[];
  topics: TopicBoardRow[];
  hourHist: number[];
  byDay: number[];
  recentNotifs: Array<{ ts: number; kind: string; senderId?: string; senderName?: string }>;
  commenters: Array<{ ts: number; senderName?: string; messageId: string }>;
  audience: BotAudience;
};

const TOPIC_RULES: Array<{ topic: string; re?: RegExp; tags?: string[] }> = [
  { topic: "NTR / cheating", re: /\b(ntr|pre-?ntr|netorare|cuck|cheating|affair|jelaous|jealous)\b/i, tags: ["Netorare", "Cheating"] },
  { topic: "Hurt / heartbreak", re: /\b(hurt|heartbreak|broken|betrayal|came back)\b/i },
  { topic: "Slow burn", re: /slow\s*burn/i, tags: ["Slow Burn"] },
  { topic: "CNC / kink", re: /\b(cnc|kink|femdom|bdsm)\b/i, tags: ["CNC", "Kinky"] },
  { topic: "Healing / second chance", re: /\b(healing|second chance|tried twice)\b/i },
  { topic: "Corruption", re: /corruption/i },
  { topic: "Wholesome", re: /wholesome/i, tags: ["Wholesome"] },
  { topic: "Toxic", re: /toxic/i },
  { topic: "Yandere", re: /yandere/i, tags: ["Yandere"] },
  { topic: "Spouse / partner", re: /\b(wife|husband|spouse|married|our bed)\b/i, tags: ["Spouse/Partner"] },
  { topic: "Dark romance", re: /dark/i, tags: ["Dark", "Dark Romance"] },
  { topic: "Drama", tags: ["Drama"] },
  { topic: "Romance", tags: ["Romance"] },
  { topic: "Slice of life", tags: ["Slice of Life"] },
  { topic: "Comedy", tags: ["Comedy"] },
  { topic: "RPG / sandbox", tags: ["RPG", "Sandbox"] },
  { topic: "Affectionate", tags: ["Affectionate"] },
  { topic: "Story / scene", tags: ["Story/Scene"] },
  { topic: "Multiple", tags: ["Multiple"] },
];

function titleCase(s: string) {
  return s
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(" ");
}

export function inferTopics(name: string, intro: string, tags: string[]): string[] {
  const hay = `${name}\n${intro}\n${tags.join(" ")}`;
  const out = new Set<string>();
  const alias: Record<string, string> = {
    ntr: "NTR / cheating",
    "pre-ntr": "NTR / cheating",
    prenetr: "NTR / cheating",
    netorare: "NTR / cheating",
    cheating: "NTR / cheating",
    cuck: "NTR / cheating",
    hurt: "Hurt / heartbreak",
    heartbreak: "Hurt / heartbreak",
    betrayal: "Hurt / heartbreak",
    "slow burn": "Slow burn",
    slowburn: "Slow burn",
    cnc: "CNC / kink",
    kink: "CNC / kink",
    kinky: "CNC / kink",
    femdom: "CNC / kink",
    bdsm: "CNC / kink",
    healing: "Healing / second chance",
    "second chance": "Healing / second chance",
    corruption: "Corruption",
    wholesome: "Wholesome",
    toxic: "Toxic",
    yandere: "Yandere",
    wife: "Spouse / partner",
    husband: "Spouse / partner",
    spouse: "Spouse / partner",
    partner: "Spouse / partner",
    "spouse/partner": "Spouse / partner",
    dark: "Dark romance",
    "dark romance": "Dark romance",
    drama: "Drama",
    romance: "Romance",
    "slice of life": "Slice of life",
    comedy: "Comedy",
    rpg: "RPG / sandbox",
    sandbox: "RPG / sandbox",
    affectionate: "Affectionate",
    "story/scene": "Story / scene",
    story: "Story / scene",
    multiple: "Multiple",
  };
  const canon = (t: string) => alias[t.trim().toLowerCase()] || titleCase(t.trim());
  const bracket = name.match(/^\[([^\]]+)\]/);
  if (bracket) {
    for (const part of bracket[1].split(/[/,|]+/)) {
      const t = part.trim();
      if (t && t.length <= 32) out.add(canon(t));
    }
  }
  for (const rule of TOPIC_RULES) {
    if (rule.re && rule.re.test(hay)) out.add(rule.topic);
    if (rule.tags?.some((t) => tags.includes(t))) out.add(rule.topic);
  }
  return [...out];
}

function emptyFile(): ForensicFile {
  return {
    version: 1,
    timezone: loungeTimezone(),
    lastIngestAt: null,
    sources: {},
    seenExtraKeys: [],
    followDays: {},
    creatorDays: {},
    bots: {},
  };
}

export function loadForensics(): ForensicFile {
  try {
    const p = dataPath(FILE);
    if (!existsSync(p)) return emptyFile();
    const raw = JSON.parse(readFileSync(p, "utf8")) as ForensicFile;
    if (!raw || raw.version !== 1 || !raw.bots) return emptyFile();
    return {
      version: 1,
      timezone: raw.timezone || loungeTimezone(),
      lastIngestAt: raw.lastIngestAt ?? null,
      sources: raw.sources || {},
      seenExtraKeys: Array.isArray(raw.seenExtraKeys) ? raw.seenExtraKeys : [],
      followDays: raw.followDays || {},
      creatorDays: raw.creatorDays || {},
      bots: raw.bots,
    };
  } catch {
    return emptyFile();
  }
}

function saveForensics(file: ForensicFile) {
  ensureDataDir();
  writeFileSync(dataPath(FILE), JSON.stringify(file), "utf8");
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

function madridHour(ts: number): { date: string; hour: number; day: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: loungeTimezone(),
    weekday: "short",
    hour: "2-digit",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const bag: Record<string, string> = {};
  for (const p of fmt.formatToParts(new Date(ts))) {
    if (p.type !== "literal") bag[p.type] = p.value;
  }
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return {
    date: `${bag.year}-${bag.month}-${bag.day}`,
    hour: Number(bag.hour || 0),
    day: Math.max(0, days.indexOf(bag.weekday || "Sun")),
  };
}

function emptyNotif(): ForensicNotifBucket {
  return { likes: 0, favorites: 0, comments: 0, gifts: 0, follows: 0, other: 0, hourHist: Array(24).fill(0) };
}

function bumpNotif(b: ForensicNotifBucket, ev: NotifEvent) {
  if (ev.kind === "like") b.likes += 1;
  else if (ev.kind === "favorite") b.favorites += 1;
  else if (ev.kind === "comment") b.comments += 1;
  else if (ev.kind === "gift") b.gifts += 1;
  else if (ev.kind === "follow") b.follows += 1;
  else b.other += 1;
  const { hour } = madridHour(ev.ts);
  if (hour >= 0 && hour < 24) b.hourHist[hour] = (b.hourHist[hour] || 0) + 1;
}

function personKey(ev: { senderId?: string; senderName?: string }): string | null {
  const id = ev.senderId?.trim();
  if (id && id !== "unknown") return id;
  const name = ev.senderName?.trim();
  if (name) return `n:${name}`;
  return null;
}

function touchFan(
  bot: ForensicBot,
  ev: { senderId?: string; senderName?: string; kind?: string; ts: number },
) {
  const key = personKey(ev);
  if (!key) return;
  if (ev.kind === "follow" || ev.kind === "audit" || ev.kind === "other") return;
  if (!bot.fans) bot.fans = {};
  const prev = bot.fans[key] || {
    senderId: ev.senderId || key,
    senderName: ev.senderName,
    likes: 0,
    favorites: 0,
    comments: 0,
    gifts: 0,
    firstTs: ev.ts,
    lastTs: ev.ts,
  };
  if (ev.kind === "like") prev.likes += 1;
  else if (ev.kind === "favorite") prev.favorites += 1;
  else if (ev.kind === "comment") prev.comments += 1;
  else if (ev.kind === "gift") prev.gifts += 1;
  else return;
  if (ev.senderName) prev.senderName = ev.senderName;
  if (ev.senderId && !prev.senderId.startsWith("n:")) prev.senderId = ev.senderId;
  if (ev.ts < prev.firstTs) prev.firstTs = ev.ts;
  if (ev.ts > prev.lastTs) prev.lastTs = ev.ts;
  bot.fans[key] = prev;
}

function sameTags(a: string[], b: string[]) {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every((x) => s.has(x));
}

function ensureBot(file: ForensicFile, id: string, name: string): ForensicBot {
  let bot = file.bots[id];
  if (!bot) {
    bot = {
      identity: {
        characterId: id,
        characterName: name,
        tags: [],
        topics: [],
        extras: {},
        updatedAt: new Date().toISOString(),
      },
      identityRevisions: [],
      days: [],
    };
    file.bots[id] = bot;
  }
  return bot;
}

function upsertDay(bot: ForensicBot, point: ForensicDayPoint) {
  const idx = bot.days.findIndex((d) => d.date === point.date);
  if (idx < 0) {
    bot.days.push(point);
    bot.days.sort((a, b) => a.date.localeCompare(b.date));
    return;
  }
  const prev = bot.days[idx]!;
  bot.days[idx] = {
    ...prev,
    ...point,
    discovery: { ...(prev.discovery || {}), ...(point.discovery || {}) },
    notifs: point.notifs || prev.notifs,
    extrasKeys: [...new Set([...(prev.extrasKeys || []), ...(point.extrasKeys || [])])],
    characterRank: point.characterRank ?? prev.characterRank,
    comments: point.comments ?? prev.comments,
    score10: point.score10 ?? prev.score10,
    score20: point.score20 ?? prev.score20,
    shareCount: point.shareCount ?? prev.shareCount,
    textLength: point.textLength ?? prev.textLength,
    galleryPageView: point.galleryPageView ?? prev.galleryPageView,
    revenueGems: point.revenueGems ?? prev.revenueGems,
  };
}

function applyDeltas(bot: ForensicBot) {
  bot.days.sort((a, b) => a.date.localeCompare(b.date));
  for (let i = 0; i < bot.days.length; i++) {
    const cur = bot.days[i]!;
    const prev = i > 0 ? bot.days[i - 1] : null;
    if (!prev) {
      cur.dChats = undefined;
      cur.dLikes = undefined;
      cur.dFavorites = undefined;
      continue;
    }
    cur.dChats = cur.chats - prev.chats;
    cur.dLikes = cur.likes - prev.likes;
    cur.dFavorites = cur.favorites - prev.favorites;
  }
}

function loadJson<T>(name: string): T | null {
  try {
    const p = dataPath(name);
    if (!existsSync(p)) return null;
    return JSON.parse(readFileSync(p, "utf8")) as T;
  } catch {
    return null;
  }
}

function loadSnapshotFile(): LoungeSnapshot | null {
  return loadJson<LoungeSnapshot>("last-snapshot.json");
}

export type IngestLive = {
  snapshot?: LoungeSnapshot | null;
  deep?: DeepSignals | null;
  insights?: CreatorInsights | null;
  timing?: TimingAnalysis | null;
  publish?: PublishAnalysis | null;
  economy?: EconomySnapshot | null;
};

export function ingestForensics(live: IngestLive = {}): ForensicFile {
  const file = loadForensics();
  const now = new Date().toISOString();
  const snapshot = live.snapshot ?? loadSnapshotFile();
  const history = loadHistory();
  const insights = live.insights ?? loadCreatorInsights();
  const dash = loadJson<{ deep?: DeepSignals | null; scrapedAt?: string }>("creator-dashboard.json");
  const deep = live.deep ?? dash?.deep ?? null;
  const ranklist = loadJson<{ scrapedAt?: string }>("creator-ranklist.json");
  const notifs = loadNotifStore();

  file.sources = {
    snapshot: snapshot?.scrapedAt ?? file.sources.snapshot ?? null,
    history: history.lastScrape?.scrapedAt ?? file.sources.history ?? null,
    insights: insights?.scrapedAt ?? file.sources.insights ?? null,
    deep: deep?.scrapedAt ?? file.sources.deep ?? null,
    ranklist: ranklist?.scrapedAt ?? file.sources.ranklist ?? null,
    notifications: notifs.lastScrapedAt ?? file.sources.notifications ?? null,
    publish: live.publish?.analyzedAt ?? file.sources.publish ?? null,
    economy: live.economy?.scrapedAt ?? file.sources.economy ?? null,
  };

  const extraKeys = new Set(file.seenExtraKeys);

  for (const day of history.days) {
    const totals = day.totals;
    if (totals && !file.creatorDays[day.date]) {
      file.creatorDays[day.date] = {
        date: day.date,
        scrapedAt: day.scrapedAt,
        chats: totals.chats,
        likes: totals.likes,
        favorites: totals.favorites,
        interactions: totals.interactions,
        followers: totals.followers,
        bots: totals.bots,
      };
    }
    for (const [id, row] of Object.entries(day.bots || {})) {
      const bot = ensureBot(file, id, row.characterName || id);
      upsertDay(bot, {
        date: day.date,
        scrapedAt: day.scrapedAt,
        chats: row.chats,
        likes: row.likes,
        favorites: row.favorites,
        interactions: row.interactions,
        score10: row.score10,
        score20: row.score20,
        visibility: row.visibility,
        comments: row.comments,
        memoryCount: row.memoryCount,
        galleryCount: row.galleryCount,
        genPictureCount: row.genPictureCount,
        basePopular: row.basePopular,
        baseTrending: row.baseTrending,
        baseRecent: row.baseRecent,
        baseEditor: row.baseEditor,
        baseImmersive: row.baseImmersive,
        extrasKeys: row.extrasKeys,
      });
      if (row.characterThumb && !bot.identity.characterThumb) bot.identity.characterThumb = row.characterThumb;
      if (row.gmtFirstPublish && !bot.identity.gmtFirstPublish) bot.identity.gmtFirstPublish = row.gmtFirstPublish;
      if (row.gmtCreate && !bot.identity.gmtCreate) bot.identity.gmtCreate = row.gmtCreate;
      if (row.figureId && !bot.identity.figureId) bot.identity.figureId = row.figureId;
      if (row.tags?.length && !bot.identity.tags.length) {
        bot.identity.tags = [...row.tags];
        bot.identity.topics = inferTopics(bot.identity.characterName, "", row.tags);
      }
    }
  }

  if (snapshot?.bots?.length) {
    const date = dayKey(snapshot.scrapedAt);
    file.creatorDays[date] = {
      date,
      scrapedAt: snapshot.scrapedAt,
      chats: snapshot.totals?.chats ?? 0,
      likes: snapshot.totals?.likes ?? 0,
      favorites: snapshot.totals?.favorites ?? 0,
      interactions: snapshot.totals?.interactions ?? 0,
      followers: snapshot.totals?.followers ?? 0,
      bots: snapshot.totals?.bots ?? snapshot.bots.length,
      publicBots: snapshot.totals?.publicBots,
      privateBots: snapshot.totals?.privateBots,
      unlistedBots: snapshot.totals?.unlistedBots,
      stats: snapshot.stats || undefined,
      benefit: snapshot.benefit || undefined,
      ownCharacterData: snapshot.ownCharacterData || undefined,
      space: snapshot.space || undefined,
    };
    for (const b of snapshot.bots) {
      if (!b.characterId) continue;
      const bot = ensureBot(file, b.characterId, b.characterName);
      applyIdentity(bot, b, now, extraKeys);
      upsertDay(bot, {
        date,
        scrapedAt: snapshot.scrapedAt,
        chats: b.chatCount ?? 0,
        likes: b.likeCount ?? 0,
        favorites: b.favoriteCount ?? 0,
        interactions: (b.chatCount ?? 0) + (b.likeCount ?? 0) + (b.favoriteCount ?? 0),
        score10: b.score10,
        score20: b.score20,
        memoryCount: b.memoryCount,
        galleryCount: b.galleryCount,
        genPictureCount: b.genPictureCount,
        visibility: b.visibility,
        basePopular: b.basePopular,
        baseTrending: b.baseTrending,
        baseRecent: b.baseRecent,
        baseEditor: b.baseEditor,
        baseImmersive: liftBaseImmersive(b),
        extrasKeys: b.extras ? Object.keys(b.extras) : undefined,
        shareCount: b.shareCount,
        textLength: b.textLength,
      });
    }
  }

  if (insights) {
    const date = dayKey(insights.scrapedAt);
    const commentCount = new Map<string, number>();
    for (const ev of insights.comments || []) {
      commentCount.set(ev.characterId, (commentCount.get(ev.characterId) || 0) + 1);
    }
    for (const row of insights.botDepth || []) {
      const bot = ensureBot(file, row.characterId, row.characterName);
      if (row.tags?.length) {
        bot.identity.tags = [...new Set([...bot.identity.tags, ...row.tags])];
        bot.identity.topics = inferTopics(bot.identity.characterName, bot.identity.introduction || "", bot.identity.tags);
      }
      upsertDay(bot, {
        date,
        scrapedAt: insights.scrapedAt,
        chats: row.chats,
        likes: row.likes,
        favorites: row.favorites,
        interactions: row.chats + row.likes + row.favorites,
        score10: row.score10,
        score20: row.score20,
        memoryCount: row.memoryCount,
        galleryCount: row.galleryCount,
        genPictureCount: row.genPictureCount,
        comments: commentCount.get(row.characterId),
        discovery: row.discoveryRanks,
        basePopular: row.basePopular,
        baseTrending: row.baseTrending,
        baseRecent: row.baseRecent,
        baseEditor: row.baseEditor,
        baseImmersive: row.baseImmersive,
      });
    }
    for (const hit of insights.discovery?.matrix || []) {
      const bot = file.bots[hit.characterId];
      if (!bot) continue;
      const day = bot.days.find((d) => d.date === date);
      if (day) day.discovery = { ...(day.discovery || {}), ...(hit.ranks || {}) };
    }
    for (const c of insights.comments || []) {
      if (!c.characterId || !c.messageId) continue;
      const bot = file.bots[c.characterId] || ensureBot(file, c.characterId, c.characterName || c.characterId);
      bot.commenters = bot.commenters || [];
      if (bot.commenters.some((x) => x.messageId === c.messageId)) continue;
      bot.commenters.push({ ts: c.ts, senderName: c.senderName, messageId: c.messageId });
      if (bot.commenters.length > 250) {
        bot.commenters = bot.commenters.sort((a, b) => a.ts - b.ts).slice(-250);
      }
    }
  }

  if (deep) {
    const date = dayKey(deep.scrapedAt);
    for (const row of deep.botEnrichment || []) {
      const bot = file.bots[row.characterId];
      if (!bot) continue;
      const existing = bot.days.find((d) => d.date === date);
      upsertDay(bot, {
        date,
        scrapedAt: deep.scrapedAt,
        chats: existing?.chats ?? 0,
        likes: existing?.likes ?? 0,
        favorites: existing?.favorites ?? 0,
        interactions: existing?.interactions ?? 0,
        score10: row.detailScore10,
        score20: row.detailScore20,
        comments: row.commentCount ?? row.commentSample,
        memoryCount: row.memoryCount,
        galleryCount: row.galleryCount,
        genPictureCount: row.genPictureCount,
      });
    }
    for (const board of deep.characterBoards || []) {
      for (const own of board.own) {
        const bot = file.bots[own.characterId];
        if (!bot) continue;
        const day = bot.days.find((d) => d.date === date);
        if (day) day.characterRank = own.rank;
      }
    }
    for (const own of deep.ownCharacterRanks || []) {
      const bot = file.bots[own.characterId];
      if (!bot) continue;
      const day = bot.days.find((d) => d.date === date);
      if (day && day.characterRank == null) day.characterRank = own.rank;
    }
  }

  const byBotDate = new Map<string, ForensicNotifBucket>();
  for (const bot of Object.values(file.bots)) bot.fans = {};
  for (const ev of notifs.events || []) {
    if (!ev.characterId || ev.characterId === "unknown") continue;
    const { date } = madridHour(ev.ts);
    if (ev.kind === "follow") {
      // Follow payloads use the follower's user id as businessId — archive at
      // creator level so we don't mint 1k+ fake bots, but we still keep the day.
      const prev = file.followDays[date] || emptyNotif();
      bumpNotif(prev, ev);
      file.followDays[date] = prev;
      if (file.bots[ev.characterId]) {
        const key = `${ev.characterId}|${date}`;
        let bucket = byBotDate.get(key);
        if (!bucket) {
          bucket = emptyNotif();
          byBotDate.set(key, bucket);
        }
        bumpNotif(bucket, ev);
      }
      continue;
    }
    const key = `${ev.characterId}|${date}`;
    let bucket = byBotDate.get(key);
    if (!bucket) {
      bucket = emptyNotif();
      byBotDate.set(key, bucket);
    }
    bumpNotif(bucket, ev);
    const name =
      ev.characterName && ev.characterName !== "Unknown" && ev.characterName !== "Follower"
        ? ev.characterName
        : ev.characterId;
    const bot = file.bots[ev.characterId] || ensureBot(file, ev.characterId, name);
    touchFan(bot, ev);
  }

  const economy = live.economy ?? loadJson<{ last?: EconomySnapshot; days?: EconomySnapshot[] }>("creator-economy.json")?.last ?? null;
  if (economy) {
    const date = economy.date || dayKey(economy.scrapedAt);
    const prev = file.creatorDays[date];
    file.creatorDays[date] = {
      date,
      scrapedAt: economy.scrapedAt || prev?.scrapedAt || now,
      chats: prev?.chats ?? 0,
      likes: prev?.likes ?? 0,
      favorites: prev?.favorites ?? 0,
      interactions: prev?.interactions ?? 0,
      followers: prev?.followers ?? 0,
      bots: prev?.bots ?? 0,
      publicBots: prev?.publicBots,
      privateBots: prev?.privateBots,
      unlistedBots: prev?.unlistedBots,
      stats: prev?.stats,
      benefit: prev?.benefit,
      ownCharacterData: prev?.ownCharacterData,
      space: prev?.space,
      economy: {
        coin: economy.vip?.coin,
        gems: economy.vip?.gems,
        gemsTotal: economy.vip?.gemsTotal,
        incomeGems: economy.vip?.incomeGems,
        frozenGems: economy.vip?.frozenGems,
        vipMaxCoin: economy.vip?.vipMaxCoin,
        checkInStreak: economy.checkInStreak,
        campaignCount: economy.campaignCount,
        spacePublicChars: economy.inventory?.spacePublicChars,
        plazaUserPics: economy.inventory?.plazaUserPics,
        memoriesPublic: economy.inventory?.memoriesPublic,
        memoriesPrivate: economy.inventory?.memoriesPrivate,
        figuresOwned: economy.inventory?.figuresOwned,
        videosOwned: economy.inventory?.videosOwned,
        backpackItems: economy.inventory?.backpackItems,
      },
    };
    for (const sig of economy.botSignals || []) {
      const bot = file.bots[sig.characterId] || ensureBot(file, sig.characterId, sig.characterName);
      const existing = bot.days.find((d) => d.date === date);
      upsertDay(bot, {
        date,
        scrapedAt: economy.scrapedAt,
        chats: existing?.chats ?? 0,
        likes: existing?.likes ?? 0,
        favorites: existing?.favorites ?? 0,
        interactions: existing?.interactions ?? 0,
        comments: sig.commentCount ?? existing?.comments,
        shareCount: sig.shareCount,
        textLength: sig.textLength,
        galleryPageView: sig.galleryPageView,
        revenueGems: sig.revenueGems,
        genPictureCount: sig.genAll ?? existing?.genPictureCount,
      });
      if (sig.figureId && !bot.identity.figureId) bot.identity.figureId = sig.figureId;
      if (sig.shareCount != null) bot.identity.extras.shareCount = sig.shareCount;
      if (sig.textLength != null) bot.identity.extras.textLength = sig.textLength;
      if (sig.galleryPageView != null) bot.identity.extras.galleryPageView = sig.galleryPageView;
    }
  }

  for (const [key, bucket] of byBotDate) {
    const [id, date] = key.split("|");
    if (!id || !date) continue;
    const name =
      notifs.events.find((e) => e.characterId === id && e.characterName)?.characterName || id;
    const bot = file.bots[id] || ensureBot(file, id, name);
    const existing = bot.days.find((d) => d.date === date);
    if (existing) {
      existing.notifs = mergeNotif(existing.notifs, bucket);
    } else {
      const last = bot.days[bot.days.length - 1];
      upsertDay(bot, {
        date,
        scrapedAt: now,
        chats: last?.chats ?? 0,
        likes: last?.likes ?? 0,
        favorites: last?.favorites ?? 0,
        interactions: last?.interactions ?? 0,
        notifs: bucket,
      });
    }
  }

  for (const bot of Object.values(file.bots)) applyDeltas(bot);

  file.seenExtraKeys = [...extraKeys].sort();
  file.lastIngestAt = now;
  saveForensics(file);
  return file;
}

export function ingestForensicsIfStale(live: IngestLive = {}): ForensicFile {
  const f = loadForensics();
  const snapAt = live.snapshot?.scrapedAt || loadSnapshotFile()?.scrapedAt || "";
  const history = loadHistory();
  const insights = live.insights ?? loadCreatorInsights();
  const dash = loadJson<{ deep?: { scrapedAt?: string } | null }>("creator-dashboard.json");
  const notifs = loadNotifStore();
  const newest = [
    snapAt,
    history.lastScrape?.scrapedAt,
    insights?.scrapedAt,
    live.deep?.scrapedAt,
    dash?.deep?.scrapedAt,
    notifs.lastScrapedAt,
    live.publish?.analyzedAt,
    live.timing?.lastScrapedAt,
    live.economy?.scrapedAt,
  ]
    .filter((s): s is string => Boolean(s))
    .sort()
    .at(-1) || "";
  const namedNotifs = (notifs.events || []).some(
    (e) =>
      Boolean(e.senderId) &&
      (e.kind === "like" || e.kind === "favorite") &&
      e.characterId &&
      e.characterId !== "unknown",
  );
  const fansPresent = Object.values(f.bots).some((b) => b.fans && Object.keys(b.fans).length > 0);
  if (
    f.lastIngestAt &&
    Object.keys(f.bots).length &&
    newest &&
    f.lastIngestAt >= newest &&
    !(namedNotifs && !fansPresent)
  ) {
    return f;
  }
  return ingestForensics(live);
}

function mergeNotif(prev: ForensicNotifBucket | undefined, next: ForensicNotifBucket): ForensicNotifBucket {
  if (!prev) return next;
  const hourHist = Array(24).fill(0).map((_, i) => Math.max(prev.hourHist[i] || 0, next.hourHist[i] || 0));
  return {
    likes: Math.max(prev.likes, next.likes),
    favorites: Math.max(prev.favorites, next.favorites),
    comments: Math.max(prev.comments, next.comments),
    gifts: Math.max(prev.gifts, next.gifts),
    follows: Math.max(prev.follows, next.follows),
    other: Math.max(prev.other, next.other),
    hourHist,
  };
}

function applyIdentity(bot: ForensicBot, b: JuicyBot, now: string, extraKeys: Set<string>) {
  const tags = b.characterTags ? [...b.characterTags] : bot.identity.tags;
  const topics = inferTopics(b.characterName, b.introduction || "", tags);
  const extras = { ...(bot.identity.extras || {}), ...(b.extras || {}) };
  if (b.figureId) extras.figureId = b.figureId;
  if (b.shareCount != null) extras.shareCount = b.shareCount;
  if (b.characterAge != null) extras.characterAge = b.characterAge;
  if (b.textLength != null) extras.textLength = b.textLength;
  for (const k of Object.keys(extras)) extraKeys.add(k);

  const changed =
    bot.identity.characterName !== b.characterName ||
    !sameTags(bot.identity.tags, tags) ||
    Boolean(b.introduction && b.introduction !== bot.identity.introduction);

  if (changed && (bot.identity.tags.length || bot.identity.characterName !== "Untitled")) {
    bot.identityRevisions.push({
      at: now,
      name: bot.identity.characterName,
      tags: bot.identity.tags,
      topics: bot.identity.topics,
      intro: bot.identity.introduction,
    });
    if (bot.identityRevisions.length > MAX_IDENTITY_REVISIONS) {
      bot.identityRevisions = bot.identityRevisions.slice(-MAX_IDENTITY_REVISIONS);
    }
  }

  bot.identity = {
    characterId: b.characterId,
    characterName: b.characterName,
    characterThumb: b.characterThumb || b.characterPhoto || bot.identity.characterThumb,
    introduction: b.introduction ?? bot.identity.introduction,
    personality: b.personality ?? bot.identity.personality,
    tags,
    topics,
    gender: b.gender ?? bot.identity.gender,
    rating: b.rating ?? bot.identity.rating,
    visibility: b.visibility ?? bot.identity.visibility,
    gmtCreate: b.gmtCreate ?? bot.identity.gmtCreate,
    gmtFirstPublish: b.gmtFirstPublish ?? bot.identity.gmtFirstPublish,
    gmtModified: b.gmtModified ?? bot.identity.gmtModified,
    figureId: b.figureId ?? bot.identity.figureId,
    extras,
    updatedAt: now,
  };
}

function median(nums: number[]): number {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

function latestDay(bot: ForensicBot): ForensicDayPoint | null {
  return bot.days.length ? bot.days[bot.days.length - 1]! : null;
}

function botChatsPerDay(bot: ForensicBot): number {
  const last = latestDay(bot);
  if (!last) return 0;
  const age = ageDays(toMs(bot.identity.gmtFirstPublish ?? bot.identity.gmtCreate));
  if (age && age > 0.5) return last.chats / age;
  if (bot.days.length >= 2) {
    const span = Math.max(1, bot.days.length - 1);
    return (last.chats - bot.days[0]!.chats) / span;
  }
  return last.chats;
}

function fanList(bot: ForensicBot): ForensicFan[] {
  return Object.values(bot.fans || {});
}

function scoreFan(f: { likes: number; favorites: number; comments: number; gifts?: number; bots?: number }) {
  return f.likes + f.favorites * 2 + (f.comments || 0) + (f.gifts || 0) * 2 + (f.bots || 1) * 3;
}

function buildAudience(file: ForensicFile): AudienceIndex {
  type Agg = {
    senderId: string;
    senderName?: string;
    likes: number;
    favorites: number;
    comments: number;
    gifts: number;
    lastTs: number;
    bots: Map<string, { name: string; likes: number; favorites: number }>;
  };
  const people = new Map<string, Agg>();
  let events = 0;
  let returningOnSameBot = 0;
  let likeThenStar = 0;

  for (const bot of Object.values(file.bots)) {
    const name = bot.identity.characterName;
    const id = bot.identity.characterId;
    for (const fan of fanList(bot)) {
      const hits = fan.likes + fan.favorites + fan.comments + fan.gifts;
      events += hits;
      if (fan.likes > 0 && fan.favorites > 0) likeThenStar += 1;
      if (hits >= 2 || (fan.likes > 0 && fan.favorites > 0)) returningOnSameBot += 1;
      const prev = people.get(fan.senderId) || {
        senderId: fan.senderId,
        senderName: fan.senderName,
        likes: 0,
        favorites: 0,
        comments: 0,
        gifts: 0,
        lastTs: fan.lastTs,
        bots: new Map(),
      };
      prev.likes += fan.likes;
      prev.favorites += fan.favorites;
      prev.comments += fan.comments;
      prev.gifts += fan.gifts;
      if (fan.senderName) prev.senderName = fan.senderName;
      if (fan.lastTs > prev.lastTs) prev.lastTs = fan.lastTs;
      const cell = prev.bots.get(id) || { name, likes: 0, favorites: 0 };
      cell.likes += fan.likes;
      cell.favorites += fan.favorites;
      prev.bots.set(id, cell);
      people.set(fan.senderId, prev);
    }
  }

  const likerIds = new Set<string>();
  const starIds = new Set<string>();
  for (const p of people.values()) {
    if (p.likes > 0) likerIds.add(p.senderId);
    if (p.favorites > 0) starIds.add(p.senderId);
  }

  const pairMap = new Map<string, AudienceCrossover>();
  for (const p of people.values()) {
    if (p.bots.size < 2) continue;
    const ids = [...p.bots.keys()].sort();
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = ids[i]!;
        const b = ids[j]!;
        const key = `${a}|${b}`;
        const row =
          pairMap.get(key) ||
          {
            aId: a,
            aName: p.bots.get(a)?.name || a,
            bId: b,
            bName: p.bots.get(b)?.name || b,
            shared: 0,
            likes: 0,
            stars: 0,
          };
        row.shared += 1;
        row.likes += (p.bots.get(a)?.likes || 0) + (p.bots.get(b)?.likes || 0);
        row.stars += (p.bots.get(a)?.favorites || 0) + (p.bots.get(b)?.favorites || 0);
        pairMap.set(key, row);
      }
    }
  }

  const recurringPeople = [...people.values()].filter((p) => p.bots.size >= 2).length;
  const superFans = [...people.values()].filter((p) => p.bots.size >= 3).length;
  const starOnly = [...people.values()].filter((p) => p.favorites > 0 && p.likes === 0).length;
  const crossovers = [...pairMap.values()].sort((a, b) => b.shared - a.shared).slice(0, 16);
  const topFans: AudiencePerson[] = [...people.values()]
    .map((p) => ({
      senderId: p.senderId,
      senderName: p.senderName,
      likes: p.likes,
      favorites: p.favorites,
      comments: p.comments,
      gifts: p.gifts,
      bots: p.bots.size,
      lastTs: p.lastTs,
    }))
    .sort((a, b) => scoreFan(b) - scoreFan(a))
    .slice(0, 30);

  const patterns: AudiencePattern[] = [];
  if (recurringPeople) {
    patterns.push({
      id: "recurring",
      label: `${recurringPeople} people come back across bots`,
      detail: "Same JuicyChat accounts liked or starred more than one of your characters.",
      n: recurringPeople,
    });
  }
  if (likeThenStar) {
    patterns.push({
      id: "like-star",
      label: `${likeThenStar} liked, then starred the same bot`,
      detail: "They didn't just tap like — they came back to favorite. That's a returning fan, not a drive-by.",
      n: likeThenStar,
    });
  }
  if (superFans) {
    patterns.push({
      id: "superfan",
      label: `${superFans} people engage 3+ bots`,
      detail: "Portfolio regulars. They follow the lounge, not a one-off card.",
      n: superFans,
    });
  }
  if (crossovers[0] && crossovers[0].shared >= 3) {
    patterns.push({
      id: "pair",
      label: `Strongest overlap: ${crossovers[0].aName} × ${crossovers[0].bName}`,
      detail: `${crossovers[0].shared} of the same people engaged both. Shared tags or adjacent plots are pulling the same crowd.`,
      n: crossovers[0].shared,
    });
  }
  if (starOnly) {
    patterns.push({
      id: "star-only",
      label: `${starOnly} star without liking first`,
      detail: "They skip the like and go straight to favorite — often a bookmark for later, or a silent regular.",
      n: starOnly,
    });
  }

  return {
    uniqueLikers: likerIds.size,
    uniqueStarrers: starIds.size,
    uniquePeople: people.size,
    recurringPeople,
    returningOnSameBot,
    likeThenStar,
    events,
    topFans,
    crossovers,
    patterns,
  };
}

function buildBotAudience(bot: ForensicBot, file: ForensicFile): BotAudience {
  const fans = fanList(bot).sort((a, b) => scoreFan(b) - scoreFan(a));
  const uniqueLikers = fans.filter((f) => f.likes > 0).length;
  const uniqueStarrers = fans.filter((f) => f.favorites > 0).length;
  const returning = fans.filter(
    (f) => f.likes + f.favorites + f.comments + f.gifts >= 2 || (f.likes > 0 && f.favorites > 0),
  ).length;
  const likeThenStar = fans.filter((f) => f.likes > 0 && f.favorites > 0).length;

  const myIds = new Set(fans.map((f) => f.senderId));
  const also: Array<{ characterId: string; characterName: string; shared: number }> = [];
  for (const other of Object.values(file.bots)) {
    if (other.identity.characterId === bot.identity.characterId) continue;
    let shared = 0;
    for (const f of fanList(other)) if (myIds.has(f.senderId)) shared += 1;
    if (shared >= 2) {
      also.push({
        characterId: other.identity.characterId,
        characterName: other.identity.characterName,
        shared,
      });
    }
  }
  also.sort((a, b) => b.shared - a.shared);

  const toRow = (f: ForensicFan): BotFanRow => ({
    senderId: f.senderId,
    senderName: f.senderName,
    likes: f.likes,
    favorites: f.favorites,
    comments: f.comments,
    gifts: f.gifts,
    firstTs: f.firstTs,
    lastTs: f.lastTs,
  });

  return {
    uniqueLikers,
    uniqueStarrers,
    uniquePeople: fans.length,
    returning,
    likeThenStar,
    likers: fans.filter((f) => f.likes > 0).slice(0, 40).map(toRow),
    starrers: fans
      .filter((f) => f.favorites > 0)
      .sort((a, b) => b.favorites - a.favorites || b.lastTs - a.lastTs)
      .slice(0, 40)
      .map(toRow),
    topFans: fans.slice(0, 24).map(toRow),
    alsoOn: also.slice(0, 10),
  };
}

function buildBoards(file: ForensicFile): { tags: TagBoardRow[]; topics: TopicBoardRow[]; cpdMed: number } {
  const lastCpd: number[] = [];
  const tagMap = new Map<string, { bots: number; chats: number; cpd: number; dChats: number }>();
  const topicMap = new Map<string, { bots: number; chats: number; cpd: number; dChats: number }>();
  for (const bot of Object.values(file.bots)) {
    const last = latestDay(bot);
    if (!last) continue;
    const cpd = botChatsPerDay(bot);
    lastCpd.push(cpd);
    const dChats = last.dChats ?? 0;
    for (const tag of bot.identity.tags) {
      const cur = tagMap.get(tag) || { bots: 0, chats: 0, cpd: 0, dChats: 0 };
      cur.bots += 1;
      cur.chats += last.chats;
      cur.cpd += cpd;
      cur.dChats += dChats;
      tagMap.set(tag, cur);
    }
    for (const topic of bot.identity.topics) {
      const cur = topicMap.get(topic) || { bots: 0, chats: 0, cpd: 0, dChats: 0 };
      cur.bots += 1;
      cur.chats += last.chats;
      cur.cpd += cpd;
      cur.dChats += dChats;
      topicMap.set(topic, cur);
    }
  }
  const cpdMed = median(lastCpd.filter((n) => n > 0)) || 1;
  const tags: TagBoardRow[] = [...tagMap.entries()]
    .map(([tag, v]) => ({
      tag,
      bots: v.bots,
      chats: v.chats,
      chatsPerDay: v.bots ? v.cpd / v.bots : 0,
      dChats: v.dChats,
      lift: cpdMed ? (v.bots ? v.cpd / v.bots : 0) / cpdMed : 1,
    }))
    .sort((a, b) => b.chats - a.chats);
  const topics: TopicBoardRow[] = [...topicMap.entries()]
    .map(([topic, v]) => ({
      topic,
      bots: v.bots,
      chats: v.chats,
      chatsPerDay: v.bots ? v.cpd / v.bots : 0,
      dChats: v.dChats,
      lift: cpdMed ? (v.bots ? v.cpd / v.bots : 0) / cpdMed : 1,
    }))
    .sort((a, b) => b.chats - a.chats);
  return { tags, topics, cpdMed };
}

function summarizeBot(bot: ForensicBot, tagBoard: TagBoardRow[], topicBoard: TopicBoardRow[], cpdMed: number): ForensicBotSummary {
  const last = latestDay(bot);
  const cpd = botChatsPerDay(bot);
  const why = whyFactors(bot, tagBoard, topicBoard, cpdMed);
  const pub = toMs(bot.identity.gmtFirstPublish ?? bot.identity.gmtCreate);
  const fans = fanList(bot);
  return {
    characterId: bot.identity.characterId,
    characterName: bot.identity.characterName,
    characterThumb: bot.identity.characterThumb,
    tags: bot.identity.tags,
    topics: bot.identity.topics,
    chats: last?.chats ?? 0,
    likes: last?.likes ?? 0,
    favorites: last?.favorites ?? 0,
    dChats: last?.dChats ?? 0,
    chatsPerDay: cpd,
    ageDays: ageDays(pub),
    topWhy: why[0]?.label ?? null,
    publishedAt: pub ? new Date(pub).toISOString() : null,
    uniqueLikers: fans.filter((f) => f.likes > 0).length,
    uniqueStarrers: fans.filter((f) => f.favorites > 0).length,
    uniquePeople: fans.length,
    returningFans: fans.filter(
      (f) => f.likes + f.favorites + f.comments + f.gifts >= 2 || (f.likes > 0 && f.favorites > 0),
    ).length,
  };
}

function publishLabel(bot: ForensicBot): { label: string; detail: string } | null {
  const ms = toMs(bot.identity.gmtFirstPublish ?? bot.identity.gmtCreate);
  if (!ms) return null;
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: loungeTimezone(),
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const src = bot.identity.gmtFirstPublish ? "gmtFirstPublish" : "gmtCreate";
  return { label: `Published ${fmt.format(new Date(ms))}`, detail: `${src} · lounge timezone` };
}

function whyFactors(bot: ForensicBot, tagBoard: TagBoardRow[], topicBoard: TopicBoardRow[], cpdMed: number): WhyFactor[] {
  const last = latestDay(bot);
  const out: WhyFactor[] = [];
  const cpd = botChatsPerDay(bot);
  const age = ageDays(toMs(bot.identity.gmtFirstPublish ?? bot.identity.gmtCreate));

  if (last?.dChats != null && last.dChats > 0) {
    out.push({
      kind: "velocity",
      label: `+${Math.round(last.dChats).toLocaleString("en-US")} chats vs prior scrape`,
      detail: "Day-over-day chat gain from the lounge history series.",
      lift: cpdMed ? cpd / cpdMed : 1,
      weight: Math.min(1, Math.abs(last.dChats) / Math.max(200, cpdMed * 3)),
    });
  }

  for (const tag of bot.identity.tags) {
    const row = tagBoard.find((t) => t.tag === tag);
    if (!row || row.bots < 2 || row.lift < 1.08) continue;
    out.push({
      kind: "tag",
      label: tag,
      detail: `${row.bots} of your bots · ${row.lift.toFixed(2)}× chats/day vs portfolio median`,
      lift: row.lift,
      weight: Math.min(1, (row.lift - 1) * 0.8),
    });
  }

  for (const topic of bot.identity.topics) {
    const row = topicBoard.find((t) => t.topic === topic);
    if (!row || row.bots < 2 || row.lift < 1.08) continue;
    out.push({
      kind: "topic",
      label: topic,
      detail: `${row.bots} bots in this topic · ${row.lift.toFixed(2)}× chats/day vs median`,
      lift: row.lift,
      weight: Math.min(1, (row.lift - 1) * 0.85),
    });
  }

  const disc = last?.discovery;
  if (disc) {
    const placed = Object.entries(disc).filter(([, r]) => r != null) as Array<[string, number]>;
    if (placed.length) {
      const best = placed.sort((a, b) => a[1] - b[1])[0]!;
      out.push({
        kind: "discovery",
        label: `${best[0]} #${best[1]}`,
        detail: `On JuicyChat ${placed.map(([k, v]) => `${k} #${v}`).join(" · ")}`,
        lift: best[1] <= 50 ? 1.4 : 1.1,
        weight: best[1] <= 20 ? 0.85 : 0.45,
      });
    }
  }

  if (last?.score10 != null) {
    const raw = last.score10;
    const shown = raw > 1000 ? (raw / 100_000).toFixed(2) : raw.toFixed(1);
    const lift = (raw > 1000 ? raw / 100_000 : raw) >= 8 ? 1.2 : (raw > 1000 ? raw / 100_000 : raw) >= 6 ? 1 : 0.8;
    out.push({
      kind: "score",
      label: `score10 ${shown}`,
      detail: "JuicyChat quality score from the character list.",
      lift,
      weight: lift >= 1.2 ? 0.35 : 0.15,
    });
  }

  if (last?.comments != null && last.comments > 0) {
    out.push({
      kind: "comments",
      label: `${last.comments} comments sampled`,
      detail: "Comment pulse from character comment pages / notifications.",
      lift: null,
      weight: Math.min(0.5, last.comments / 40),
    });
  }

  const fans = fanList(bot);
  const likeStar = fans.filter((f) => f.likes > 0 && f.favorites > 0).length;
  if (likeStar >= 3) {
    out.push({
      kind: "audience",
      label: `${likeStar} liked then starred`,
      detail: "The same people came back to favorite after liking — recurring fans, not drive-by taps.",
      lift: fans.length ? likeStar / fans.length : null,
      weight: Math.min(0.7, likeStar / 20),
    });
  } else if (fans.length >= 8) {
    const returning = fans.filter((f) => f.likes + f.favorites + f.comments >= 2).length;
    if (returning / fans.length >= 0.18) {
      out.push({
        kind: "audience",
        label: `${returning} returning people`,
        detail: `${Math.round((returning / fans.length) * 100)}% of known likers/starrers engaged more than once.`,
        lift: returning / fans.length,
        weight: 0.35,
      });
    }
  }

  if (age != null) {
    if (age <= 14 && cpd > cpdMed) {
      out.push({
        kind: "age",
        label: `New · ${age.toFixed(0)}d old`,
        detail: "Still in the launch window and outrunning median chats/day.",
        lift: cpdMed ? cpd / cpdMed : null,
        weight: 0.55,
      });
    } else if (age >= 60 && (last?.dChats ?? 0) > 0) {
      out.push({
        kind: "evergreen",
        label: `Evergreen · ${age.toFixed(0)}d`,
        detail: "Still adding chats long after publish.",
        lift: cpdMed ? cpd / cpdMed : null,
        weight: 0.4,
      });
    }
  }

  const slot = publishLabel(bot);
  if (slot) {
    out.push({
      kind: "publish-slot",
      label: slot.label,
      detail: slot.detail,
      lift: null,
      weight: 0.2,
    });
  }

  const hours = Array(24).fill(0);
  for (const d of bot.days) {
    const hist = d.notifs?.hourHist;
    if (!hist) continue;
    for (let h = 0; h < 24; h++) hours[h] += hist[h] || 0;
  }
  const peakH = hours.indexOf(Math.max(...hours));
  const peakV = hours[peakH] || 0;
  if (peakV >= 3) {
    out.push({
      kind: "timing",
      label: `Engagement peak ${String(peakH).padStart(2, "0")}:00`,
      detail: `${peakV} like/fav/comment events in that hour (${timezoneCity(loungeTimezone())}) across archived days.`,
      lift: null,
      weight: Math.min(0.5, peakV / 40),
    });
  }

  out.sort((a, b) => b.weight - a.weight);
  return out.slice(0, 10);
}

function whenSignals(bot: ForensicBot): WhenSignal[] {
  const out: WhenSignal[] = [];
  const pub = toMs(bot.identity.gmtFirstPublish ?? bot.identity.gmtCreate);
  if (pub) {
    out.push({ kind: "publish", at: new Date(pub).toISOString(), label: "First published" });
    const weekEnd = pub + 7 * 86_400_000;
    const firstWeek = bot.days.filter((d) => {
      const t = Date.parse(d.scrapedAt || d.date);
      return Number.isFinite(t) && t >= pub && t <= weekEnd;
    });
    if (firstWeek.length) {
      const gain = firstWeek[firstWeek.length - 1]!.chats - firstWeek[0]!.chats;
      out.push({
        kind: "first-week",
        at: new Date(pub).toISOString(),
        label: `First-week chats ${gain >= 0 ? "+" : ""}${Math.round(gain).toLocaleString("en-US")}`,
        value: gain,
      });
    }
  }

  const deltas = bot.days.map((d) => d.dChats ?? 0).filter((n) => n !== 0);
  const med = median(deltas.map(Math.abs)) || 0;
  for (const d of bot.days) {
    const v = d.dChats ?? 0;
    if (med > 0 && v >= Math.max(med * 2.5, 80)) {
      out.push({
        kind: "spike",
        at: d.scrapedAt || `${d.date}T12:00:00.000Z`,
        label: `Spike ${d.date} · +${Math.round(v).toLocaleString("en-US")} chats`,
        value: v,
      });
    } else if (med > 0 && v <= -Math.max(med * 2, 40)) {
      out.push({
        kind: "quiet",
        at: d.scrapedAt || `${d.date}T12:00:00.000Z`,
        label: `Dip ${d.date} · ${Math.round(v).toLocaleString("en-US")} chats`,
        value: v,
      });
    }
  }

  const hours = Array(24).fill(0);
  const days = Array(7).fill(0);
  const dayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  for (const d of bot.days) {
    const hist = d.notifs?.hourHist;
    if (hist) for (let h = 0; h < 24; h++) hours[h] += hist[h] || 0;
    const tot = (d.notifs?.likes || 0) + (d.notifs?.favorites || 0) + (d.notifs?.comments || 0);
    const dow = new Date(`${d.date}T12:00:00Z`).getUTCDay();
    if (dow >= 0 && dow < 7) days[dow] += tot;
  }
  const peakH = hours.indexOf(Math.max(...hours));
  if ((hours[peakH] || 0) > 0) {
    out.push({
      kind: "best-hour",
      at: `hour:${peakH}`,
      label: `Best hour ${String(peakH).padStart(2, "0")}:00 ${timezoneCity(loungeTimezone())}`,
      value: hours[peakH],
    });
  }
  const peakD = days.indexOf(Math.max(...days));
  if ((days[peakD] || 0) > 0) {
    out.push({
      kind: "best-day",
      at: `dow:${peakD}`,
      label: `Best weekday ${dayLabels[peakD]}`,
      value: days[peakD],
    });
  }

  const last = latestDay(bot);
  if (last) {
    out.push({
      kind: "latest",
      at: last.scrapedAt,
      label: `Latest scrape ${last.date}`,
      value: last.dChats,
    });
  }
  return out.slice(0, 14);
}

export function buildForensicIndex(file?: ForensicFile): ForensicIndex {
  const f = file ?? loadForensics();
  const { tags, topics, cpdMed } = buildBoards(f);
  const bots = Object.values(f.bots)
    .map((b) => summarizeBot(b, tags, topics, cpdMed))
    .sort((a, b) => b.chats - a.chats);
  const days = new Set<string>();
  for (const b of Object.values(f.bots)) for (const d of b.days) days.add(d.date);
  return {
    scrapedAt: f.lastIngestAt || new Date().toISOString(),
    daysTracked: days.size,
    botCount: bots.length,
    seenExtraKeys: f.seenExtraKeys,
    sources: f.sources,
    followDays: Object.keys(f.followDays || {}).length,
    creatorDays: Object.keys(f.creatorDays || {}).length,
    tagBoard: tags.slice(0, 40),
    topicBoard: topics.slice(0, 24),
    bots,
    audience: buildAudience(f),
  };
}

export function buildForensicReport(characterId: string, file?: ForensicFile): ForensicReport | null {
  const f = file ?? loadForensics();
  const bot = f.bots[characterId];
  if (!bot) return null;
  const { tags, topics, cpdMed } = buildBoards(f);
  const hours = Array(24).fill(0);
  const byDay = Array(7).fill(0);
  for (const d of bot.days) {
    const hist = d.notifs?.hourHist;
    if (hist) for (let h = 0; h < 24; h++) hours[h] += hist[h] || 0;
    const tot = (d.notifs?.likes || 0) + (d.notifs?.favorites || 0) + (d.notifs?.comments || 0);
    const dow = new Date(`${d.date}T12:00:00Z`).getUTCDay();
    if (dow >= 0 && dow < 7) byDay[dow] += tot;
  }
  const notifs = loadNotifStore().events.filter((e) => e.characterId === characterId);
  const audience = buildBotAudience(bot, f);
  const why = whyFactors(bot, tags, topics, cpdMed);
  if (audience.alsoOn[0] && audience.alsoOn[0].shared >= 4) {
    why.push({
      kind: "audience",
      label: `Shared fans with ${audience.alsoOn[0].characterName}`,
      detail: `${audience.alsoOn[0].shared} of the same people liked or starred both bots.`,
      lift: audience.uniquePeople ? audience.alsoOn[0].shared / audience.uniquePeople : null,
      weight: Math.min(0.65, audience.alsoOn[0].shared / 25),
    });
    why.sort((a, b) => b.weight - a.weight);
  }
  return {
    summary: summarizeBot(bot, tags, topics, cpdMed),
    identity: bot.identity,
    why: why.slice(0, 10),
    when: whenSignals(bot),
    timeline: bot.days,
    tags: tags.filter((t) => bot.identity.tags.includes(t.tag)),
    topics: topics.filter((t) => bot.identity.topics.includes(t.topic)),
    hourHist: hours,
    byDay,
    recentNotifs: notifs
      .slice()
      .sort((a, b) => b.ts - a.ts)
      .slice(0, 25)
      .map((e) => ({ ts: e.ts, kind: e.kind, senderId: e.senderId, senderName: e.senderName })),
    commenters: (bot.commenters || [])
      .slice()
      .sort((a, b) => b.ts - a.ts)
      .slice(0, 40),
    audience,
  };
}

export function forensicDayCount(v: unknown): number {
  if (!v || typeof v !== "object") return 0;
  const bots = (v as ForensicFile).bots;
  if (!bots) return 0;
  let n = 0;
  for (const b of Object.values(bots)) n += b.days?.length || 0;
  return n;
}

export function forensicBotCount(v: unknown): number {
  if (!v || typeof v !== "object") return 0;
  return Object.keys((v as ForensicFile).bots || {}).length;
}
