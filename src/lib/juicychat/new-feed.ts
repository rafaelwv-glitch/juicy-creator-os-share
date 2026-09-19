/**
 * Homepage Characters → New, unfiltered.
 * Manual-only: never called from daily-pull / cron / Lounge Refresh all.
 * Dates use the lounge timezone. Snapshots accrue in the warehouse.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { JuicyClient } from "./client";
import { dayKey } from "./history";
import { dataPath, ensureDataDir } from "./paths";
import { loadSession, saveSession } from "./session";
import type { LoungeSnapshot } from "./types";
import { loungeTimezone } from "./timezone-server";

const FILE = "new-feed.json";
const PAGE_SIZE = 50;
/** Dedicated New scrape — deeper than Lounge's ranking scan. */
export const NEW_FEED_MAX_PAGES = 80;
const TITLE_KEEP_DAYS = 60;
const TOP_N = 40;

export type NewFeedCard = {
  characterId: string;
  characterName: string;
  userId: string;
  userName: string;
  tags: string[];
  gmtFirstPublish?: number;
  gmtCreate?: number;
  gmtModified?: number;
  introduction?: string;
  chatCount?: number;
  likeCount?: number;
  favoriteCount?: number;
  score10?: number;
  rating?: string | number | null;
  gender?: number;
  personality?: string;
  rank: number;
  own?: boolean;
};

export type AccruedBot = NewFeedCard & {
  firstSeenAt: string;
  lastSeenAt: string;
  firstSeenDate: string;
  lastSeenDate: string;
  seenCount: number;
};

export type NewFeedTitle = {
  characterId: string;
  characterName: string;
  userId: string;
  userName: string;
  tags: string[];
  gmtFirstPublish?: number;
  chats?: number;
  rank: number;
};

export type NewFeedDay = {
  date: string;
  scrapedAt: string;
  pages: number;
  apiTotal: number | null;
  count: number;
  newCount: number;
  returningCount: number;
  creatorCount: number;
  weekday: number;
  tagCounts: Array<{ tag: string; n: number }>;
  creatorCounts: Array<{ userId: string; userName: string; n: number }>;
  hourCounts: number[];
  titles: NewFeedTitle[];
};

export type NewFeedStore = {
  version: 1;
  timezone: string;
  lastScrapedAt: string | null;
  lastDate: string | null;
  lastPages: number;
  lastApiTotal: number | null;
  lastCount: number;
  lastNewCount: number;
  warnings: string[];
  latest: NewFeedCard[];
  catalog: Record<string, AccruedBot>;
  days: NewFeedDay[];
  /** Official character tags from getLaunchData (this scrape). */
  officialTags?: string[];
  /** Official tags from the previous New scrape — for event-watch deltas. */
  officialTagsPrev?: string[];
  officialTagsAt?: string | null;
};

export type NewFeedCreatorRow = {
  userId: string;
  userName: string;
  bots: number;
  firstDate: string;
  lastDate: string;
  tags: string[];
};

export type NewFeedTagShift = {
  tag: string;
  now: number;
  prev: number;
  delta: number;
};

export type NewFeedView = {
  timezone: string;
  lastScrapedAt: string | null;
  lastDate: string | null;
  firstDate: string | null;
  lastPages: number;
  lastApiTotal: number | null;
  lastCount: number;
  lastNewCount: number;
  catalogSize: number;
  creatorCount: number;
  dayCount: number;
  warnings: string[];
  latest: NewFeedCard[];
  volume: Array<{ date: string; count: number; newCount: number; returningCount: number }>;
  hourCounts: number[];
  weekdayCounts: number[];
  topCreators: NewFeedCreatorRow[];
  topTags: Array<{ tag: string; n: number }>;
  tagShift: NewFeedTagShift[];
  days: Array<Omit<NewFeedDay, "titles">>;
};

function emptyHours(): number[] {
  return Array.from({ length: 24 }, () => 0);
}

function emptyStore(): NewFeedStore {
  return {
    version: 1,
    timezone: loungeTimezone(),
    lastScrapedAt: null,
    lastDate: null,
    lastPages: 0,
    lastApiTotal: null,
    lastCount: 0,
    lastNewCount: 0,
    warnings: [],
    latest: [],
    catalog: {},
    days: [],
    officialTags: [],
    officialTagsPrev: [],
    officialTagsAt: null,
  };
}

function filePath() {
  return dataPath(FILE);
}

export function loadNewFeedStore(): NewFeedStore | null {
  try {
    if (!existsSync(filePath())) return null;
    const raw = JSON.parse(readFileSync(filePath(), "utf8")) as NewFeedStore;
    if (!raw || raw.version !== 1) return null;
    if (!raw.catalog || typeof raw.catalog !== "object") raw.catalog = {};
    if (!Array.isArray(raw.days)) raw.days = [];
    if (!Array.isArray(raw.latest)) raw.latest = [];
    if (!Array.isArray(raw.officialTags)) raw.officialTags = [];
    if (!Array.isArray(raw.officialTagsPrev)) raw.officialTagsPrev = [];
    return raw;
  } catch {
    return null;
  }
}

function saveNewFeedStore(store: NewFeedStore) {
  ensureDataDir();
  writeFileSync(filePath(), JSON.stringify(store), "utf8");
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

function toMs(ts: unknown): number | undefined {
  if (ts == null || ts === "") return undefined;
  const n = typeof ts === "number" ? ts : Number(ts);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return n < 1e12 ? Math.round(n * 1000) : Math.round(n);
}

function tagsOf(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const t of raw) {
      const s = String(t || "").trim();
      const k = s.toLowerCase();
      if (!s || seen.has(k)) continue;
      seen.add(k);
      out.push(s);
    }
    return out;
  }
  if (typeof raw === "string" && raw.trim()) {
    return tagsOf(raw.split(/[,|]/));
  }
  return [];
}

function clipIntro(s: unknown): string | undefined {
  const t = String(s ?? "").trim();
  if (!t) return undefined;
  return t.length > 180 ? `${t.slice(0, 177)}…` : t;
}

function parseTagCatalog(raw: unknown): string[] {
  let v: unknown = raw;
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return [];
    try {
      v = JSON.parse(s);
    } catch {
      return tagsOf(s);
    }
  }
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of v) {
    let name = "";
    if (typeof item === "string") name = item.trim();
    else if (item && typeof item === "object") {
      const o = item as Record<string, unknown>;
      name = String(o.tagName ?? o.name ?? o.tag ?? o.label ?? "").trim();
    }
    const k = name.toLowerCase();
    if (!name || seen.has(k)) continue;
    seen.add(k);
    out.push(name);
  }
  return out;
}

async function fetchOfficialTags(client: JuicyClient, warnings: string[]): Promise<string[]> {
  const fromResult = (r: { success?: boolean; code?: string; msg?: string; data?: unknown }): string[] => {
    const data =
      r.data && typeof r.data === "object" && !Array.isArray(r.data)
        ? (r.data as Record<string, unknown>)
        : {};
    return parseTagCatalog(data.characterTag);
  };
  try {
    const r = await client.get<Record<string, unknown>>("/yume/api/user/v1/getLaunchData");
    const tags = fromResult(r);
    if (tags.length) return tags;
    if (!r.success && r.code !== "200") warnings.push(`launch tags GET: ${r.msg || r.code}`);
  } catch (e) {
    warnings.push(`launch tags GET: ${e instanceof Error ? e.message : String(e)}`);
  }
  try {
    const r = await client.post<Record<string, unknown>>("/yume/api/user/v1/getLaunchData", {});
    const tags = fromResult(r);
    if (tags.length) return tags;
    if (!r.success && r.code !== "200") warnings.push(`launch tags POST: ${r.msg || r.code}`);
  } catch (e) {
    warnings.push(`launch tags POST: ${e instanceof Error ? e.message : String(e)}`);
  }
  return [];
}

function madridHour(ms: number): number {
  try {
    const h = Number(
      new Intl.DateTimeFormat("en-GB", {
        timeZone: loungeTimezone(),
        hour: "2-digit",
        hourCycle: "h23",
      }).format(new Date(ms)),
    );
    return Number.isFinite(h) ? ((h % 24) + 24) % 24 : 0;
  } catch {
    return 0;
  }
}

function madridWeekday(ms: number): number {
  try {
    const w = new Intl.DateTimeFormat("en-US", {
      timeZone: loungeTimezone(),
      weekday: "short",
    }).format(new Date(ms));
    const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return map[w] ?? new Date(ms).getUTCDay();
  } catch {
    return new Date(ms).getUTCDay();
  }
}

function loadOwnIds(): Set<string> {
  try {
    const p = dataPath("last-snapshot.json");
    if (!existsSync(p)) return new Set();
    const snap = JSON.parse(readFileSync(p, "utf8")) as LoungeSnapshot;
    return new Set((snap.bots || []).map((b) => b.characterId));
  } catch {
    return new Set();
  }
}

function pickCard(raw: Record<string, unknown>, rank: number, ownIds: Set<string>): NewFeedCard | null {
  const characterId = raw.characterId != null ? String(raw.characterId) : "";
  if (!characterId) return null;
  const userId = raw.userId != null ? String(raw.userId) : "";
  const card: NewFeedCard = {
    characterId,
    characterName: String(raw.characterName ?? "Untitled").trim() || "Untitled",
    userId,
    userName: String(raw.userName ?? "").trim() || userId || "unknown",
    tags: tagsOf(raw.characterTags),
    gmtFirstPublish: toMs(raw.gmtFirstPublish),
    gmtCreate: toMs(raw.gmtCreate),
    gmtModified: toMs(raw.gmtModified),
    introduction: clipIntro(raw.introduction),
    chatCount: typeof raw.chatCount === "number" ? raw.chatCount : undefined,
    likeCount: typeof raw.likeCount === "number" ? raw.likeCount : undefined,
    favoriteCount: typeof raw.favoriteCount === "number" ? raw.favoriteCount : undefined,
    score10: typeof raw.score10 === "number" ? raw.score10 : undefined,
    rating: (raw.rating as string | number | null | undefined) ?? null,
    gender: typeof raw.gender === "number" ? raw.gender : undefined,
    personality: raw.personality != null ? String(raw.personality) : undefined,
    rank,
    own: ownIds.has(characterId) || false,
  };
  return card;
}

function compactTitle(c: NewFeedCard): NewFeedTitle {
  return {
    characterId: c.characterId,
    characterName: c.characterName,
    userId: c.userId,
    userName: c.userName,
    tags: c.tags,
    gmtFirstPublish: c.gmtFirstPublish,
    chats: c.chatCount,
    rank: c.rank,
  };
}

function topCounts(
  map: Map<string, { label: string; n: number }>,
  n = TOP_N,
): Array<{ tag: string; n: number }> {
  return [...map.values()]
    .sort((a, b) => b.n - a.n || a.label.localeCompare(b.label))
    .slice(0, n)
    .map((x) => ({ tag: x.label, n: x.n }));
}

function buildDay(cards: NewFeedCard[], meta: {
  date: string;
  scrapedAt: string;
  pages: number;
  apiTotal: number | null;
  catalog: Record<string, AccruedBot>;
}): NewFeedDay {
  const tagMap = new Map<string, { label: string; n: number }>();
  const creatorMap = new Map<string, { userId: string; userName: string; n: number }>();
  const hourCounts = emptyHours();
  let newCount = 0;
  for (const c of cards) {
    const acc = meta.catalog[c.characterId];
    if (acc?.firstSeenDate === meta.date) newCount += 1;
    for (const t of c.tags) {
      const k = t.toLowerCase();
      const cur = tagMap.get(k) || { label: t, n: 0 };
      cur.n += 1;
      tagMap.set(k, cur);
    }
    const ck = c.userId || c.userName;
    if (ck) {
      const cur = creatorMap.get(ck) || { userId: c.userId, userName: c.userName, n: 0 };
      cur.n += 1;
      if (c.userName && c.userName.length > (cur.userName?.length || 0)) cur.userName = c.userName;
      creatorMap.set(ck, cur);
    }
    const pub = c.gmtFirstPublish || c.gmtCreate;
    if (pub) hourCounts[madridHour(pub)] += 1;
  }
  const scrapedMs = Date.parse(meta.scrapedAt) || Date.now();
  return {
    date: meta.date,
    scrapedAt: meta.scrapedAt,
    pages: meta.pages,
    apiTotal: meta.apiTotal,
    count: cards.length,
    newCount,
    returningCount: Math.max(0, cards.length - newCount),
    creatorCount: creatorMap.size,
    weekday: madridWeekday(scrapedMs),
    tagCounts: topCounts(tagMap),
    creatorCounts: [...creatorMap.values()]
      .sort((a, b) => b.n - a.n)
      .slice(0, TOP_N),
    hourCounts,
    titles: cards.map(compactTitle),
  };
}

function mergeCatalog(
  catalog: Record<string, AccruedBot>,
  cards: NewFeedCard[],
  scrapedAt: string,
  date: string,
): Record<string, AccruedBot> {
  const next = { ...catalog };
  for (const c of cards) {
    const prev = next[c.characterId];
    if (!prev) {
      next[c.characterId] = {
        ...c,
        firstSeenAt: scrapedAt,
        lastSeenAt: scrapedAt,
        firstSeenDate: date,
        lastSeenDate: date,
        seenCount: 1,
      };
      continue;
    }
    next[c.characterId] = {
      ...prev,
      ...c,
      firstSeenAt: prev.firstSeenAt,
      firstSeenDate: prev.firstSeenDate,
      lastSeenAt: scrapedAt,
      lastSeenDate: date,
      seenCount: (prev.seenCount || 1) + 1,
      tags: c.tags.length ? c.tags : prev.tags,
      gmtFirstPublish: c.gmtFirstPublish ?? prev.gmtFirstPublish,
      gmtCreate: c.gmtCreate ?? prev.gmtCreate,
    };
  }
  return next;
}

function pruneTitles(days: NewFeedDay[], keep = TITLE_KEEP_DAYS): NewFeedDay[] {
  if (days.length <= keep) return days;
  const cut = days.length - keep;
  return days.map((d, i) => (i < cut ? { ...d, titles: [] } : d));
}

/**
 * Pull homepage New (unfiltered). Photos dropped. Dates kept. Merges into warehouse.
 * Do not wire this into cron or Lounge Refresh all.
 */
export async function scrapeNewFeed(options?: { maxPages?: number }): Promise<NewFeedView> {
  const session = loadSession();
  if (!session?.cookie) {
    throw new Error("Not logged in — connect JuicyChat, then refresh New from this tab.");
  }
  const client = JuicyClient.fromSession(session);
  const maxPages = Math.max(1, Math.min(120, options?.maxPages ?? NEW_FEED_MAX_PAGES));
  const ownIds = loadOwnIds();
  const warnings: string[] = [];
  const cards: NewFeedCard[] = [];
  let pages = 0;
  let apiTotal: number | null = null;
  const officialPromise = fetchOfficialTags(client, warnings);

  for (let pageNo = 1; pageNo <= maxPages; pageNo++) {
    try {
      const r = await client.post<Record<string, unknown>[]>(
        "/yume/api/user/v1/character/getCharacterList",
        {
          pageNo,
          pageSize: PAGE_SIZE,
          visibility: null,
          auditType: null,
          searchContent: "",
          characterTags: [],
          sortName: "new",
          gender: null,
        },
      );
      if (!r.success && r.code !== "200") {
        warnings.push(`new feed: ${r.msg || r.code}`);
        break;
      }
      if (typeof r.total === "number") apiTotal = r.total;
      const batch = asArray(r.data);
      pages += 1;
      if (!batch.length) break;
      for (let i = 0; i < batch.length; i++) {
        const card = pickCard(batch[i], (pageNo - 1) * PAGE_SIZE + i + 1, ownIds);
        if (card) cards.push(card);
      }
      if (batch.length < PAGE_SIZE) break;
      if (apiTotal != null && cards.length >= apiTotal) break;
    } catch (e) {
      warnings.push(`new feed p${pageNo}: ${e instanceof Error ? e.message : String(e)}`);
      break;
    }
  }

  if (client.cookie && client.cookie !== session.cookie) {
    saveSession({ ...session, cookie: client.cookie });
  }

  const scrapedAt = new Date().toISOString();
  const date = dayKey(scrapedAt);
  const prev = loadNewFeedStore() || emptyStore();
  const catalog = mergeCatalog(prev.catalog, cards, scrapedAt, date);
  const day = buildDay(cards, { date, scrapedAt, pages, apiTotal, catalog });
  const days = [...prev.days.filter((d) => d.date !== date), day].sort((a, b) =>
    a.date.localeCompare(b.date),
  );

  const fetchedOfficial = await officialPromise;
  const officialTags = fetchedOfficial.length ? fetchedOfficial : prev.officialTags || [];
  const officialTagsPrev = fetchedOfficial.length
    ? prev.officialTags || prev.officialTagsPrev || []
    : prev.officialTagsPrev || [];
  const officialTagsAt = fetchedOfficial.length ? scrapedAt : prev.officialTagsAt || null;

  const store: NewFeedStore = {
    version: 1,
    timezone: loungeTimezone(),
    lastScrapedAt: scrapedAt,
    lastDate: date,
    lastPages: pages,
    lastApiTotal: apiTotal,
    lastCount: cards.length,
    lastNewCount: day.newCount,
    warnings,
    latest: cards,
    catalog,
    days: pruneTitles(days),
    officialTags,
    officialTagsPrev,
    officialTagsAt,
  };
  saveNewFeedStore(store);
  return buildNewFeedView(store);
}

export function buildNewFeedView(store: NewFeedStore | null): NewFeedView {
  const empty: NewFeedView = {
    timezone: loungeTimezone(),
    lastScrapedAt: null,
    lastDate: null,
    firstDate: null,
    lastPages: 0,
    lastApiTotal: null,
    lastCount: 0,
    lastNewCount: 0,
    catalogSize: 0,
    creatorCount: 0,
    dayCount: 0,
    warnings: [],
    latest: [],
    volume: [],
    hourCounts: emptyHours(),
    weekdayCounts: Array.from({ length: 7 }, () => 0),
    topCreators: [],
    topTags: [],
    tagShift: [],
    days: [],
  };
  if (!store) return empty;

  const catalog = Object.values(store.catalog || {});
  const creatorMap = new Map<string, NewFeedCreatorRow & { tagSet: Map<string, number> }>();
  const tagMap = new Map<string, { label: string; n: number }>();
  const hourCounts = emptyHours();
  const weekdayCounts = Array.from({ length: 7 }, () => 0);

  for (const b of catalog) {
    const ck = b.userId || b.userName;
    if (ck) {
      const cur = creatorMap.get(ck) || {
        userId: b.userId,
        userName: b.userName,
        bots: 0,
        firstDate: b.firstSeenDate,
        lastDate: b.lastSeenDate,
        tags: [],
        tagSet: new Map<string, number>(),
      };
      cur.bots += 1;
      if (b.userName && b.userName.length > (cur.userName?.length || 0)) cur.userName = b.userName;
      if (b.firstSeenDate < cur.firstDate) cur.firstDate = b.firstSeenDate;
      if (b.lastSeenDate > cur.lastDate) cur.lastDate = b.lastSeenDate;
      for (const t of b.tags) cur.tagSet.set(t, (cur.tagSet.get(t) || 0) + 1);
      creatorMap.set(ck, cur);
    }
    for (const t of b.tags) {
      const k = t.toLowerCase();
      const cur = tagMap.get(k) || { label: t, n: 0 };
      cur.n += 1;
      tagMap.set(k, cur);
    }
    const pub = b.gmtFirstPublish || b.gmtCreate;
    if (pub) {
      hourCounts[madridHour(pub)] += 1;
      weekdayCounts[madridWeekday(pub)] += 1;
    }
  }

  const topCreators: NewFeedCreatorRow[] = [...creatorMap.values()]
    .map((c) => ({
      userId: c.userId,
      userName: c.userName,
      bots: c.bots,
      firstDate: c.firstDate,
      lastDate: c.lastDate,
      tags: [...c.tagSet.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([t]) => t),
    }))
    .sort((a, b) => b.bots - a.bots || a.userName.localeCompare(b.userName))
    .slice(0, TOP_N);

  const days = [...(store.days || [])].sort((a, b) => a.date.localeCompare(b.date));
  const last = days[days.length - 1];
  const prev = days.length >= 2 ? days[days.length - 2] : null;
  const nowMap = new Map((last?.tagCounts || []).map((t) => [t.tag.toLowerCase(), t]));
  const prevMap = new Map((prev?.tagCounts || []).map((t) => [t.tag.toLowerCase(), t]));
  const tagKeys = new Set([...nowMap.keys(), ...prevMap.keys()]);
  const tagShift: NewFeedTagShift[] = [...tagKeys]
    .map((k) => {
      const now = nowMap.get(k);
      const was = prevMap.get(k);
      return {
        tag: now?.tag || was?.tag || k,
        now: now?.n || 0,
        prev: was?.n || 0,
        delta: (now?.n || 0) - (was?.n || 0),
      };
    })
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || b.now - a.now)
    .slice(0, 16);

  const dates = days.map((d) => d.date).filter(Boolean);

  return {
    timezone: store.timezone || loungeTimezone(),
    lastScrapedAt: store.lastScrapedAt,
    lastDate: store.lastDate,
    firstDate: dates[0] || null,
    lastPages: store.lastPages,
    lastApiTotal: store.lastApiTotal,
    lastCount: store.lastCount,
    lastNewCount: store.lastNewCount,
    catalogSize: catalog.length,
    creatorCount: creatorMap.size,
    dayCount: days.length,
    warnings: store.warnings || [],
    latest: store.latest || [],
    volume: days.map((d) => ({
      date: d.date,
      count: d.count,
      newCount: d.newCount,
      returningCount: d.returningCount,
    })),
    hourCounts,
    weekdayCounts,
    topCreators,
    topTags: topCounts(tagMap),
    tagShift,
    days: days.map((d) => {
      const { titles: _titles, ...rest } = d;
      return rest;
    }),
  };
}

export function loadNewFeedView(): NewFeedView {
  return buildNewFeedView(loadNewFeedStore());
}
