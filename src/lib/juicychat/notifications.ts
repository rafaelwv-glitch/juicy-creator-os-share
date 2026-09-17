import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { JuicyClient } from "./client";
import { loadSession } from "./session";
import type { LoungeSnapshot } from "./types";
import { dataPath, ensureDataDir } from "./paths";
import { repairNotifs } from "./repair";

const TZ = "Europe/Madrid";

function storePath() {
  return dataPath("notification-events.json");
}
function snapPath() {
  return dataPath("last-snapshot.json");
}

/** Notification action types (from JuicyChat clear-history map). */
export const ACTION_FOLLOW = 1;
export const ACTION_FAVORITE = 2;
export const ACTION_LIKE = 3;
export const ACTION_FAVORITE_ALT = 4;
export const ACTION_COMMENT = 10;
export const ACTION_FOLLOWING = 12;
export const ACTION_GIFT = 13;
export const ACTION_LIKE_ALT = 15;
export const ACTION_COMMENT_ALT = 16;
export const ACTION_REWARD = 17;
export const ACTION_AUDIT = 18;

/** All interaction types we scrape for creator insights. */
export const CREATOR_ACTION_TYPES = [
  ACTION_FOLLOW,
  ACTION_FAVORITE,
  ACTION_LIKE,
  ACTION_FAVORITE_ALT,
  ACTION_COMMENT,
  ACTION_GIFT,
  ACTION_LIKE_ALT,
  ACTION_COMMENT_ALT,
  ACTION_REWARD,
  ACTION_AUDIT,
] as const;

export type NotifKind =
  | "follow"
  | "favorite"
  | "like"
  | "comment"
  | "gift"
  | "reward"
  | "audit"
  | "other";

export type NotifEvent = {
  messageId: string;
  actionType: number;
  kind: NotifKind;
  characterId: string;
  characterName: string;
  ts: number; // epoch ms
  senderId?: string;
  senderName?: string;
  /** Leftover API fields — keep them; lookback is only 30 days on the feed. */
  extras?: Record<string, unknown>;
};

export function kindFromActionType(actionType: number): NotifKind {
  if (actionType === ACTION_FOLLOW) return "follow";
  if (actionType === ACTION_FAVORITE || actionType === ACTION_FAVORITE_ALT) return "favorite";
  if (actionType === ACTION_LIKE || actionType === ACTION_LIKE_ALT) return "like";
  if (actionType === ACTION_COMMENT || actionType === ACTION_COMMENT_ALT) return "comment";
  if (actionType === ACTION_GIFT) return "gift";
  if (actionType === ACTION_REWARD) return "reward";
  if (actionType === ACTION_AUDIT) return "audit";
  return "other";
}

export type NotifStore = {
  version: 1;
  timezone: string;
  events: NotifEvent[];
  lastScrapedAt: string | null;
  lastApiTotal: number | null;
  pagesFetched: number;
  lookbackDays: number;
};

export type HeatCell = { day: number; hour: number; likes: number; favorites: number; follows: number; comments: number; gifts: number; total: number };

export type SlotScore = {
  day: number; // 0=Sun .. 6=Sat (JS)
  hour: number;
  dayLabel: string;
  label: string; // e.g. "Wed 18:00–19:00"
  likes: number;
  favorites: number;
  total: number;
  score: number; // weighted
};

export type BotTimingRow = {
  characterId: string;
  characterName: string;
  tags: string[];
  likes: number;
  favorites: number;
  total: number;
  bestSlots: SlotScore[];
  byDay: number[]; // 7
  byHour: number[]; // 24
};

export type TagTimingRow = {
  tag: string;
  bots: number;
  likes: number;
  favorites: number;
  total: number;
  bestSlots: SlotScore[];
  byDay: number[];
  byHour: number[];
};

export type TimingAnalysis = {
  timezone: string;
  eventCount: number;
  likeCount: number;
  favoriteCount: number;
  followCount: number;
  commentCount: number;
  giftCount: number;
  rewardCount: number;
  auditCount: number;
  byKind: Record<string, number>;
  uniqueBots: number;
  rangeStart: string | null;
  rangeEnd: string | null;
  lastScrapedAt: string | null;
  lastApiTotal: number | null;
  pagesFetched: number;
  lookbackDays: number;
  /** 7x24 heatmap cells */
  heatmap: HeatCell[];
  overallBestSlots: SlotScore[];
  byDayOfWeek: Array<{ day: number; dayLabel: string; likes: number; favorites: number; total: number }>;
  byHour: Array<{ hour: number; likes: number; favorites: number; total: number }>;
  bots: BotTimingRow[];
  tags: TagTimingRow[];
  recentEvents: NotifEvent[];
};

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];


export function loadNotifStore(): NotifStore {
  try {
    if (!existsSync(storePath())) {
      return {
        version: 1,
        timezone: TZ,
        events: [],
        lastScrapedAt: null,
        lastApiTotal: null,
        pagesFetched: 0,
        lookbackDays: 30,
      };
    }
    const raw = JSON.parse(readFileSync(storePath(), "utf8")) as NotifStore;
    return repairNotifs({
      version: 1,
      timezone: raw.timezone || TZ,
      events: Array.isArray(raw.events) ? raw.events : [],
      lastScrapedAt: raw.lastScrapedAt ?? null,
      lastApiTotal: raw.lastApiTotal ?? null,
      pagesFetched: raw.pagesFetched ?? 0,
      lookbackDays: raw.lookbackDays ?? 30,
    });
  } catch {
    return {
      version: 1,
      timezone: TZ,
      events: [],
      lastScrapedAt: null,
      lastApiTotal: null,
      pagesFetched: 0,
      lookbackDays: 30,
    };
  }
}

function saveNotifStore(store: NotifStore) {
  const next = repairNotifs(store);
  ensureDataDir();
  writeFileSync(storePath(), JSON.stringify(next), "utf8");
}

function partsInTz(ts: number, timeZone = TZ) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "numeric",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const map: Record<string, string> = {};
  for (const p of fmt.formatToParts(new Date(ts))) {
    if (p.type !== "literal") map[p.type] = p.value;
  }
  const wd = map.weekday || "Sun";
  const day = DAY_LABELS.indexOf(wd);
  const hour = Number(map.hour ?? 0);
  return {
    day: day >= 0 ? day : 0,
    hour: Number.isFinite(hour) ? hour : 0,
    dateKey: `${map.year}-${map.month}-${map.day}`,
  };
}

function mapMessage(raw: Record<string, unknown>): NotifEvent | null {
  const actionType = Number(raw.actionType);
  if (!Number.isFinite(actionType)) return null;
  const kind = kindFromActionType(actionType);
  const characterId =
    raw.businessId != null
      ? String(raw.businessId)
      : raw.characterId != null
        ? String(raw.characterId)
        : "";
  const subjectId =
    characterId ||
    ((kind === "follow" || kind === "other") && raw.sendUserId != null ? String(raw.sendUserId) : "");
  if (!subjectId && kind !== "follow" && kind !== "audit" && kind !== "other") return null;
  const messageId = raw.messageId != null ? String(raw.messageId) : "";
  if (!messageId) return null;
  const ts = Number(raw.gmtModified ?? raw.gmtCreate ?? 0);
  if (!ts || !Number.isFinite(ts)) return null;
  const taken = new Set([
    "actionType",
    "businessId",
    "characterId",
    "messageId",
    "gmtModified",
    "gmtCreate",
    "sendUserId",
    "sendUserName",
    "businessName",
  ]);
  const extras: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (taken.has(k) || v == null) continue;
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") extras[k] = v;
    else extras[k] = JSON.stringify(v).slice(0, 400);
  }
  return {
    messageId,
    actionType,
    kind,
    characterId: subjectId || "unknown",
    characterName: String(
      raw.businessName ?? raw.sendUserName ?? (kind === "follow" ? "Follower" : "Unknown"),
    ),
    ts,
    senderId: raw.sendUserId != null ? String(raw.sendUserId) : undefined,
    senderName: raw.sendUserName != null ? String(raw.sendUserName) : undefined,
    extras: Object.keys(extras).length ? extras : undefined,
  };
}

export type ScrapeNotifOptions = {
  /** How many calendar days back to *fetch* from the live feed (Madrid). Default 30. Stored events are never pruned. */
  lookbackDays?: number;
  /** Max API pages (pageSize 100). Default 150. */
  maxPages?: number;
  /** Stop early once we only see already-known messageIds for N consecutive pages */
  stopOnKnownPages?: number;
};

/**
 * Pull like/favorite notifications via getMessageList (interaction feed).
 * Paginated newest-first; merges into local store.
 */
export async function scrapeNotifications(
  options: ScrapeNotifOptions = {},
): Promise<{ store: NotifStore; added: number; pages: number; apiTotal: number; stoppedReason: string }> {
  const session = loadSession();
  if (!session?.cookie) {
    throw new Error("Not logged in — open Lounge and sign in, then pull notifications again.");
  }
  const lookbackDays = options.lookbackDays ?? 30;
  const maxPages = options.maxPages ?? 150;
  const stopOnKnownPages = options.stopOnKnownPages ?? 2;
  const cutoff = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;

  const client = JuicyClient.fromSession(session);
  const store = loadNotifStore();
  const existing = new Map(store.events.map((e) => [e.messageId, e]));
  let added = 0;
  let pages = 0;
  let apiTotal = 0;
  let knownStreak = 0;
  let stoppedReason = "max_pages";

  for (let pageNo = 1; pageNo <= maxPages; pageNo++) {
    const res = await client.post<Record<string, unknown>[]>(
      "/yume/api/user/v1/message/getMessageList",
      {
        pageNo,
        pageSize: 100,
        messageType: 1,
        actionTypes: [...CREATOR_ACTION_TYPES],
      },
    );
    if (!res.success && res.code !== "200") {
      throw new Error(res.msg || `getMessageList failed (${res.code})`);
    }
    apiTotal = typeof res.total === "number" ? res.total : apiTotal;
    const batch = Array.isArray(res.data) ? res.data : [];
    pages++;
    if (!batch.length) {
      stoppedReason = "empty_page";
      break;
    }

    let allKnown = true;
    let hitCutoff = false;
    for (const raw of batch) {
      const ev = mapMessage(raw);
      if (!ev) continue;
      if (ev.ts < cutoff) {
        hitCutoff = true;
        continue;
      }
      if (!existing.has(ev.messageId)) {
        existing.set(ev.messageId, ev);
        added++;
        allKnown = false;
      }
    }

    if (allKnown) knownStreak++;
    else knownStreak = 0;

    if (hitCutoff) {
      stoppedReason = "lookback_cutoff";
      break;
    }
    if (knownStreak >= stopOnKnownPages && pageNo > 1) {
      stoppedReason = "caught_up";
      break;
    }
    if (batch.length < 100) {
      stoppedReason = "end_of_list";
      break;
    }
  }

  // Keep every event we have already stored. The live feed only lasts ~30 days;
  // lookback cutoff stops *fetching*, it must not erase archived signals.
  const events = [...existing.values()].sort((a, b) => b.ts - a.ts);

  const next: NotifStore = {
    version: 1,
    timezone: TZ,
    events,
    lastScrapedAt: new Date().toISOString(),
    lastApiTotal: apiTotal,
    pagesFetched: pages,
    lookbackDays,
  };
  saveNotifStore(next);
  // persist refreshed cookie if any
  if (client.cookie && client.cookie !== session.cookie) {
    const { saveSession } = await import("./session");
    saveSession({ ...session, cookie: client.cookie });
  }
  return { store: next, added, pages, apiTotal, stoppedReason };
}

type GridCell = {
  likes: number;
  favorites: number;
  follows: number;
  comments: number;
  gifts: number;
  total: number;
};

function emptyGrid(): GridCell[][] {
  return Array.from({ length: 7 }, () =>
    Array.from({ length: 24 }, () => ({
      likes: 0,
      favorites: 0,
      follows: 0,
      comments: 0,
      gifts: 0,
      total: 0,
    })),
  );
}

function addToGrid(grid: GridCell[][], ev: NotifEvent, timeZone: string) {
  const { day, hour } = partsInTz(ev.ts, timeZone);
  const cell = grid[day]![hour]!;
  if (ev.kind === "like") cell.likes++;
  else if (ev.kind === "favorite") cell.favorites++;
  else if (ev.kind === "follow") cell.follows++;
  else if (ev.kind === "comment") cell.comments++;
  else if (ev.kind === "gift" || ev.kind === "reward") cell.gifts++;
  cell.total++;
}

function slotsFromGrid(grid: GridCell[][], topN = 5): SlotScore[] {
  const slots: SlotScore[] = [];
  for (let day = 0; day < 7; day++) {
    for (let hour = 0; hour < 24; hour++) {
      const c = grid[day]![hour]!;
      if (!c.total) continue;
      // favs + gifts stronger; follows/comments medium; likes base
      const score =
        c.likes +
        c.favorites * 1.5 +
        c.follows * 1.2 +
        c.comments * 1.3 +
        c.gifts * 2;
      slots.push({
        day,
        hour,
        dayLabel: DAY_LABELS[day]!,
        label: `${DAY_LABELS[day]} ${String(hour).padStart(2, "0")}:00–${String(hour).padStart(2, "0")}:59`,
        likes: c.likes,
        favorites: c.favorites,
        total: c.total,
        score,
      });
    }
  }
  slots.sort((a, b) => b.score - a.score || b.total - a.total);
  return slots.slice(0, topN);
}

function dayTotals(grid: GridCell[][]) {
  return DAY_LABELS.map((dayLabel, day) => {
    let likes = 0,
      favorites = 0,
      total = 0;
    for (let h = 0; h < 24; h++) {
      const c = grid[day]![h]!;
      likes += c.likes;
      favorites += c.favorites;
      total += c.total;
    }
    return { day, dayLabel, likes, favorites, total };
  });
}

function hourTotals(grid: GridCell[][]) {
  return Array.from({ length: 24 }, (_, hour) => {
    let likes = 0,
      favorites = 0,
      total = 0;
    for (let d = 0; d < 7; d++) {
      const c = grid[d]![hour]!;
      likes += c.likes;
      favorites += c.favorites;
      total += c.total;
    }
    return { hour, likes, favorites, total };
  });
}

function loadBotTags(): Map<string, { name: string; tags: string[] }> {
  const map = new Map<string, { name: string; tags: string[] }>();
  try {
    const path = snapPath();
    if (!existsSync(path)) return map;
    const snap = JSON.parse(readFileSync(path, "utf8")) as LoungeSnapshot;
    for (const b of snap.bots ?? []) {
      map.set(b.characterId, {
        name: b.characterName,
        tags: (b.characterTags ?? []).map(String),
      });
    }
  } catch {
    // ignore
  }
  return map;
}

export function analyzeTiming(store?: NotifStore): TimingAnalysis {
  const s = store ?? loadNotifStore();
  const botMeta = loadBotTags();
  const grid = emptyGrid();
  const byBot = new Map<
    string,
    { name: string; likes: number; favorites: number; grid: ReturnType<typeof emptyGrid> }
  >();

  let likeCount = 0;
  let favoriteCount = 0;
  let followCount = 0;
  let commentCount = 0;
  let giftCount = 0;
  let rewardCount = 0;
  let auditCount = 0;
  const byKind: Record<string, number> = {};
  let minTs = Infinity;
  let maxTs = 0;

  for (const ev of s.events) {
    addToGrid(grid, ev, s.timezone);
    byKind[ev.kind] = (byKind[ev.kind] || 0) + 1;
    if (ev.kind === "like") likeCount++;
    else if (ev.kind === "favorite") favoriteCount++;
    else if (ev.kind === "follow") followCount++;
    else if (ev.kind === "comment") commentCount++;
    else if (ev.kind === "gift") giftCount++;
    else if (ev.kind === "reward") rewardCount++;
    else if (ev.kind === "audit") auditCount++;
    if (ev.ts < minTs) minTs = ev.ts;
    if (ev.ts > maxTs) maxTs = ev.ts;

    let row = byBot.get(ev.characterId);
    if (!row) {
      row = {
        name: botMeta.get(ev.characterId)?.name || ev.characterName,
        likes: 0,
        favorites: 0,
        grid: emptyGrid(),
      };
      byBot.set(ev.characterId, row);
    }
    if (ev.kind === "like") row.likes++;
    else row.favorites++;
    addToGrid(row.grid, ev, s.timezone);
    // keep freshest name from events
    if (ev.characterName) row.name = botMeta.get(ev.characterId)?.name || ev.characterName;
  }

  const heatmap: HeatCell[] = [];
  for (let day = 0; day < 7; day++) {
    for (let hour = 0; hour < 24; hour++) {
      const c = grid[day]![hour]!;
      heatmap.push({
        day,
        hour,
        likes: c.likes,
        favorites: c.favorites,
        follows: c.follows ?? 0,
        comments: c.comments ?? 0,
        gifts: c.gifts ?? 0,
        total: c.total,
      });
    }
  }

  const bots: BotTimingRow[] = [...byBot.entries()]
    .map(([characterId, row]) => {
      const tags = botMeta.get(characterId)?.tags ?? [];
      const bestSlots = slotsFromGrid(row.grid, 3);
      const byDay = dayTotals(row.grid).map((d) => d.total);
      const byHour = hourTotals(row.grid).map((h) => h.total);
      return {
        characterId,
        characterName: row.name,
        tags,
        likes: row.likes,
        favorites: row.favorites,
        total: row.likes + row.favorites,
        bestSlots,
        byDay,
        byHour,
      };
    })
    .sort((a, b) => b.total - a.total);

  // tag aggregation
  const tagMap = new Map<
    string,
    { bots: Set<string>; likes: number; favorites: number; grid: ReturnType<typeof emptyGrid> }
  >();
  for (const bot of bots) {
    const tags = bot.tags.length ? bot.tags : ["(untagged)"];
    const botRow = byBot.get(bot.characterId)!;
    for (const tag of tags) {
      let t = tagMap.get(tag);
      if (!t) {
        t = { bots: new Set(), likes: 0, favorites: 0, grid: emptyGrid() };
        tagMap.set(tag, t);
      }
      t.bots.add(bot.characterId);
      t.likes += bot.likes;
      t.favorites += bot.favorites;
      // merge bot grid into tag grid
      for (let d = 0; d < 7; d++) {
        for (let h = 0; h < 24; h++) {
          const src = botRow.grid[d]![h]!;
          const dst = t.grid[d]![h]!;
          dst.likes += src.likes;
          dst.favorites += src.favorites;
          dst.total += src.total;
        }
      }
    }
  }

  const tags: TagTimingRow[] = [...tagMap.entries()]
    .map(([tag, t]) => ({
      tag,
      bots: t.bots.size,
      likes: t.likes,
      favorites: t.favorites,
      total: t.likes + t.favorites,
      bestSlots: slotsFromGrid(t.grid, 3),
      byDay: dayTotals(t.grid).map((d) => d.total),
      byHour: hourTotals(t.grid).map((h) => h.total),
    }))
    .sort((a, b) => b.total - a.total);

  return {
    timezone: s.timezone,
    eventCount: s.events.length,
    likeCount,
    favoriteCount,
    followCount,
    commentCount,
    giftCount,
    rewardCount,
    auditCount,
    byKind,
    uniqueBots: bots.length,
    rangeStart: Number.isFinite(minTs) ? new Date(minTs).toISOString() : null,
    rangeEnd: Number.isFinite(maxTs) ? new Date(maxTs).toISOString() : null,
    lastScrapedAt: s.lastScrapedAt,
    lastApiTotal: s.lastApiTotal,
    pagesFetched: s.pagesFetched,
    lookbackDays: s.lookbackDays,
    heatmap,
    overallBestSlots: slotsFromGrid(grid, 8),
    byDayOfWeek: dayTotals(grid),
    byHour: hourTotals(grid),
    bots,
    tags,
    recentEvents: s.events.slice(0, 40),
  };
}
