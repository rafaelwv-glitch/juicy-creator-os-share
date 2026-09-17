/**
 * Lounge dashboard product panels derived from warehouse files.
 * No extra scrape — New-feed / rivals / notifs / economy / snapshot already hold the raw.
 */
import type { EconomySnapshot } from "./economy";
import { loadHistory } from "./history";
import { loadNewFeedStore, type NewFeedCard, type NewFeedStore } from "./new-feed";
import { loadNotifStore } from "./notifications";
import type { RivalEntry, RivalsFile } from "./rivals";
import type { JuicyBot, LoungeSnapshot } from "./types";

const H72 = 72 * 3_600_000;
const H48 = 48 * 3_600_000;
const D7 = 7 * 86_400_000;

export const CLONE_TROPES = [
  { id: "coming-home", label: "coming home", re: /\b(coming home|came home|walk(?:ed|s)? in(?: on)?)\b/i },
  { id: "argument", label: "argument", re: /\b(argument|arguing|after the fight|fight with|yelling)\b/i },
  { id: "home-early", label: "home early", re: /\b(home early|came home early|left work early|got off early)\b/i },
] as const;

const LANE_RULES: Array<{ lane: string; re?: RegExp; tags?: string[] }> = [
  { lane: "NTR", re: /\b(ntr|pre-?ntr|netorare|cuck|cheating|affair)\b/i, tags: ["Netorare", "Cheating"] },
  { lane: "Hurt", re: /\b(hurt|heartbreak|broken|betrayal|came back)\b/i },
  { lane: "Slow burn", re: /slow\s*burn/i, tags: ["Slow Burn"] },
  { lane: "Kink", re: /\b(cnc|kink|femdom|bdsm)\b/i, tags: ["CNC", "Kinky"] },
  { lane: "Healing", re: /\b(healing|second chance)\b/i },
  { lane: "Spouse", re: /\b(wife|husband|spouse|married)\b/i, tags: ["Spouse/Partner"] },
  { lane: "Dark", re: /dark/i, tags: ["Dark", "Dark Romance"] },
  { lane: "Drama", tags: ["Drama"] },
  { lane: "Romance", tags: ["Romance"] },
  { lane: "Comedy", tags: ["Comedy"] },
  { lane: "Slice", tags: ["Slice of Life"] },
];

const GENDER: Record<number, string> = {
  0: "Female",
  1: "Male",
  2: "NB",
  3: "FTM",
  4: "MTF",
};
const RATING: Record<string, string> = { "0": "SFW", "1": "NSFW", "2": "18+" };

export type PondTagRow = {
  tag: string;
  n: number;
  median: number | null;
  p90: number | null;
  chats: number;
};

export type PondCloneRow = {
  id: string;
  label: string;
  n: number;
  titles: string[];
};

export type PondPanel = {
  windowHours: 72;
  cards: number;
  tagRows: PondTagRow[];
  clones: PondCloneRow[];
  hint: string | null;
};

export type RivalVelocityRow = {
  userId: string;
  userName: string;
  isYou: boolean;
  chats48h: number | null;
  likes48h: number | null;
  followers48h: number | null;
  launches48h: number;
  chatsPerHour: number | null;
  lifetimeChats: number;
};

export type OwnMixShip = {
  characterId: string;
  characterName: string;
  publishedAt: number | null;
  gender: string;
  rating: string;
  tags: string[];
  hits: Record<string, boolean>;
};

export type OwnMixHeatmap = {
  ships: OwnMixShip[];
  filters: string[];
};

export type CoinField = {
  coin: number | null;
  coinTotal: number | null;
  vipCoin: number | null;
  vipMaxCoin: number | null;
  dailyCoin: number | null;
  dailyMaxCoin: number | null;
  leftover: Array<{ key: string; value: string }>;
};

export type VarietyPerson = {
  senderId: string;
  senderName: string;
  lanes: string[];
  stars: number;
};

export type VarietyHealth = {
  weekStars: number;
  regulars: number;
  people: VarietyPerson[];
  laneMix: Array<{ lane: string; n: number }>;
};

export type EventWatchTag = {
  tag: string;
  cards: number;
  creators: number;
  kind: "new-official" | "not-in-catalog";
  sample: string[];
};

export type EventWatch = {
  officialCount: number;
  officialAt: string | null;
  tags: EventWatchTag[];
};

export type DashboardSignals = {
  pond: PondPanel;
  rivalVelocity: RivalVelocityRow[];
  ownMix: OwnMixHeatmap;
  coin: CoinField;
  variety: VarietyHealth;
  eventWatch: EventWatch;
};

function toMs(ts: unknown): number | undefined {
  if (ts == null || ts === "") return undefined;
  const n = typeof ts === "number" ? ts : Number(ts);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return n < 1e12 ? Math.round(n * 1000) : Math.round(n);
}

function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const i = (s.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  if (lo === hi) return s[lo]!;
  return s[lo]! * (hi - i) + s[hi]! * (i - lo);
}

function tropesOf(title: string, intro?: string): string[] {
  const hay = `${title} ${intro || ""}`;
  return CLONE_TROPES.filter((t) => t.re.test(hay)).map((t) => t.id);
}

function lanesOf(name: string, tags: string[], intro?: string): string[] {
  const hay = `${name} ${intro || ""}`;
  const tagSet = new Set(tags.map((t) => t.toLowerCase()));
  const out: string[] = [];
  const seen = new Set<string>();
  for (const rule of LANE_RULES) {
    const hit =
      (rule.re && rule.re.test(hay)) ||
      (rule.tags || []).some((t) => tagSet.has(t.toLowerCase()));
    if (!hit || seen.has(rule.lane)) continue;
    seen.add(rule.lane);
    out.push(rule.lane);
  }
  if (!out.length && tags[0]) out.push(tags[0]);
  return out;
}

function buildPond(store: NewFeedStore | null): PondPanel {
  const latest = store?.latest || [];
  const cutoff = Date.now() - H72;
  const fresh = latest.filter((c) => (c.gmtFirstPublish || c.gmtCreate || 0) >= cutoff);
  if (!latest.length) {
    return {
      windowHours: 72,
      cards: 0,
      tagRows: [],
      clones: CLONE_TROPES.map((t) => ({ id: t.id, label: t.label, n: 0, titles: [] })),
      hint: "Refresh New to fill the 72h pond.",
    };
  }
  const tagMap = new Map<string, number[]>();
  for (const c of fresh) {
    const chats = c.chatCount ?? 0;
    const tags = c.tags.length ? c.tags : ["(untagged)"];
    for (const t of tags) {
      const k = t.trim() || "(untagged)";
      const arr = tagMap.get(k) || [];
      arr.push(chats);
      tagMap.set(k, arr);
    }
  }
  const tagRows: PondTagRow[] = [...tagMap.entries()]
    .map(([tag, vals]) => ({
      tag,
      n: vals.length,
      median: percentile(vals, 0.5),
      p90: percentile(vals, 0.9),
      chats: vals.reduce((s, n) => s + n, 0),
    }))
    .sort((a, b) => b.n - a.n || b.chats - a.chats)
    .slice(0, 16);

  const clones: PondCloneRow[] = CLONE_TROPES.map((t) => {
    const hits = fresh.filter((c) => tropesOf(c.characterName, c.introduction).includes(t.id));
    return {
      id: t.id,
      label: t.label,
      n: hits.length,
      titles: hits.slice(0, 6).map((c) => c.characterName),
    };
  });

  return {
    windowHours: 72,
    cards: fresh.length,
    tagRows,
    clones,
    hint: fresh.length ? null : "New window has cards, but none first-published in the last 72h.",
  };
}

function historyPointMs(h: { date?: string; scrapedAt?: string }): number {
  const t = Date.parse(h.scrapedAt || "");
  if (Number.isFinite(t)) return t;
  const d = Date.parse(`${h.date || ""}T12:00:00+02:00`);
  return Number.isFinite(d) ? d : 0;
}

function chatsAtOrBefore(
  history: Array<{ scrapedAt?: string; date?: string; totals?: { chats?: number; likes?: number; followers?: number } }>,
  t: number,
): { chats: number; likes: number; followers: number } | null {
  let best: { chats: number; likes: number; followers: number; at: number } | null = null;
  for (const h of history) {
    const at = historyPointMs(h);
    if (!at || at > t) continue;
    if (!best || at > best.at) {
      best = {
        at,
        chats: h.totals?.chats ?? 0,
        likes: h.totals?.likes ?? 0,
        followers: h.totals?.followers ?? 0,
      };
    }
  }
  return best;
}

function launchesInWindow(bots: JuicyBot[] | undefined, since: number): number {
  let n = 0;
  for (const b of bots || []) {
    const t = toMs(b.gmtFirstPublish ?? b.gmtCreate);
    if (t && t >= since) n += 1;
  }
  return n;
}

function rivalRow(entry: RivalEntry, youId: string | null): RivalVelocityRow {
  const now = Date.now();
  const current = {
    chats: entry.lastSnapshot?.profile?.chatCount ?? entry.lastSnapshot?.totals?.chats ?? 0,
    likes: entry.lastSnapshot?.profile?.likeCount ?? entry.lastSnapshot?.totals?.likes ?? 0,
    followers: entry.lastSnapshot?.profile?.followersCount ?? entry.lastSnapshot?.totals?.followers ?? 0,
  };
  const hist: Array<{
    scrapedAt?: string;
    date?: string;
    totals?: { chats?: number; likes?: number; followers?: number };
  }> = (entry.history || []).map((h) => ({
    scrapedAt: h.scrapedAt,
    date: h.date,
    totals: h.totals,
  }));
  if (entry.mrtLog?.length) {
    for (const d of entry.mrtLog) {
      hist.push({
        scrapedAt: d.analyzedAt,
        date: d.date,
        totals: { chats: d.chats, likes: d.likes, followers: d.followers },
      });
    }
  }
  const before = chatsAtOrBefore(hist, now - H48);
  const chats48h = before ? current.chats - before.chats : null;
  const likes48h = before ? current.likes - before.likes : null;
  const followers48h = before ? current.followers - before.followers : null;
  return {
    userId: entry.userId,
    userName: entry.userName,
    isYou: Boolean(youId && entry.userId === youId),
    chats48h,
    likes48h,
    followers48h,
    launches48h: launchesInWindow(entry.lastSnapshot?.bots, now - H48),
    chatsPerHour: chats48h != null ? chats48h / 48 : null,
    lifetimeChats: current.chats,
  };
}

function youVelocity(snap: LoungeSnapshot | null): RivalVelocityRow | null {
  if (!snap?.userId && !snap?.profile?.userId) return null;
  const userId = String(snap.profile?.userId || snap.userId);
  const current = {
    chats: snap.profile?.chatCount ?? snap.totals?.chats ?? 0,
    likes: snap.profile?.likeCount ?? snap.totals?.likes ?? 0,
    followers: snap.profile?.followersCount ?? snap.totals?.followers ?? 0,
  };
  // Own 48h from growth history is richer; rival-style fallback uses snapshot only.
  return {
    userId,
    userName: snap.profile?.userName || "You",
    isYou: true,
    chats48h: null,
    likes48h: null,
    followers48h: null,
    launches48h: launchesInWindow(snap.bots, Date.now() - H48),
    chatsPerHour: null,
    lifetimeChats: current.chats,
  };
}

function own48hFromGrowth(you: RivalVelocityRow): RivalVelocityRow {
  try {
    const hist = loadHistory();
    const days = hist.days || [];
    if (days.length < 2) return you;
    const cutoff = Date.now() - H48;
    const latest = days[days.length - 1]!;
    let prior = days[0]!;
    for (const d of days) {
      const t = Date.parse(d.scrapedAt || `${d.date}T12:00:00+02:00`);
      if (Number.isFinite(t) && t <= cutoff) prior = d;
    }
    const chats48h = (latest.totals?.chats ?? 0) - (prior.totals?.chats ?? 0);
    const likes48h = (latest.totals?.likes ?? 0) - (prior.totals?.likes ?? 0);
    const followers48h = (latest.totals?.followers ?? 0) - (prior.totals?.followers ?? 0);
    return {
      ...you,
      chats48h,
      likes48h,
      followers48h,
      chatsPerHour: chats48h / 48,
    };
  } catch {
    return you;
  }
}

function buildRivalVelocity(rivals: RivalsFile | null, snap: LoungeSnapshot | null): RivalVelocityRow[] {
  const youId = snap?.profile?.userId || snap?.userId || null;
  const rows: RivalVelocityRow[] = [];
  let you = youVelocity(snap);
  if (you) {
    you = own48hFromGrowth(you);
    rows.push(you);
  }
  for (const r of rivals?.rivals || []) {
    if (youId && r.userId === youId) continue;
    rows.push(rivalRow(r, youId));
  }
  return rows.sort((a, b) => (b.chats48h ?? -1) - (a.chats48h ?? -1));
}

function genderLabel(g?: number): string {
  return g != null && GENDER[g] ? GENDER[g]! : "—";
}
function ratingLabel(r: string | number | null | undefined): string {
  if (r == null || r === "") return "—";
  return RATING[String(r)] || String(r);
}

function buildOwnMix(bots: JuicyBot[]): OwnMixHeatmap {
  const dated = bots
    .map((b) => ({ b, t: toMs(b.gmtFirstPublish ?? b.gmtCreate) || 0 }))
    .filter((x) => x.t > 0)
    .sort((a, b) => b.t - a.t)
    .slice(0, 14);
  const tagCount = new Map<string, number>();
  for (const { b } of dated) {
    for (const t of b.characterTags || []) tagCount.set(t, (tagCount.get(t) || 0) + 1);
  }
  const topTags = [...tagCount.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 8)
    .map(([t]) => t);
  const filters = ["Female", "Male", "NB", "SFW", "NSFW", "18+", ...topTags];
  const ships: OwnMixShip[] = dated.map(({ b, t }) => {
    const gender = genderLabel(b.gender);
    const rating = ratingLabel(b.rating);
    const tags = (b.characterTags || []).map(String);
    const hits: Record<string, boolean> = {};
    for (const f of filters) {
      hits[f] =
        f === gender ||
        f === rating ||
        tags.some((x) => x.toLowerCase() === f.toLowerCase());
    }
    return {
      characterId: b.characterId,
      characterName: b.characterName,
      publishedAt: t || null,
      gender,
      rating,
      tags,
      hits,
    };
  });
  return { ships, filters };
}

function prettyKey(k: string): string {
  return k
    .replace(/[._]/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function leftoverPairs(vip: EconomySnapshot["vip"] | undefined): Array<{ key: string; value: string }> {
  const extra = vip?.leftover;
  if (!extra || typeof extra !== "object") return [];
  return Object.entries(extra)
    .filter(([, v]) => v != null && v !== "")
    .map(([k, v]) => ({
      key: prettyKey(k),
      value: typeof v === "number" ? (Number.isInteger(v) ? String(v) : v.toFixed(2)) : String(v),
    }))
    .slice(0, 24);
}

function buildCoin(economy: EconomySnapshot | null, bots: JuicyBot[]): CoinField {
  const vip = economy?.vip;
  const leftover = leftoverPairs(vip);
  for (const b of bots) {
    const extras = b.extras || {};
    for (const [k, v] of Object.entries(extras)) {
      if (!/coin|second.?best|best/i.test(k) || v == null) continue;
      if (leftover.some((x) => x.key === `${b.characterName}.${k}`)) continue;
      leftover.push({
        key: `${b.characterName}.${k}`,
        value: typeof v === "object" ? JSON.stringify(v).slice(0, 80) : String(v),
      });
    }
  }
  return {
    coin: vip?.coin ?? null,
    coinTotal: vip?.coinTotal ?? null,
    vipCoin: vip?.vipCoin ?? null,
    vipMaxCoin: vip?.vipMaxCoin ?? null,
    dailyCoin: vip?.dailyCoin ?? null,
    dailyMaxCoin: vip?.dailyMaxCoin ?? null,
    leftover,
  };
}

function buildVariety(bots: JuicyBot[]): VarietyHealth {
  const store = loadNotifStore();
  const cutoff = Date.now() - D7;
  const byId = new Map(bots.map((b) => [b.characterId, b] as const));
  const people = new Map<string, { name: string; lanes: Set<string>; stars: number }>();
  let weekStars = 0;
  for (const ev of store.events || []) {
    if (ev.kind !== "favorite" || (ev.ts || 0) < cutoff) continue;
    weekStars += 1;
    const bot = byId.get(ev.characterId);
    const lanes = lanesOf(
      bot?.characterName || ev.characterName || "",
      bot?.characterTags || [],
      bot?.introduction,
    );
    const id = ev.senderId || ev.senderName || ev.messageId;
    const cur = people.get(id) || { name: ev.senderName || "anon", lanes: new Set(), stars: 0 };
    cur.stars += 1;
    if (ev.senderName) cur.name = ev.senderName;
    for (const l of lanes) cur.lanes.add(l);
    people.set(id, cur);
  }
  const regulars = [...people.entries()]
    .filter(([, p]) => p.lanes.size >= 3)
    .sort((a, b) => b[1].lanes.size - a[1].lanes.size || b[1].stars - a[1].stars);
  const laneMix = new Map<string, number>();
  for (const p of people.values()) {
    for (const l of p.lanes) laneMix.set(l, (laneMix.get(l) || 0) + 1);
  }
  return {
    weekStars,
    regulars: regulars.length,
    people: regulars.slice(0, 16).map(([id, p]) => ({
      senderId: id,
      senderName: p.name,
      lanes: [...p.lanes],
      stars: p.stars,
    })),
    laneMix: [...laneMix.entries()]
      .map(([lane, n]) => ({ lane, n }))
      .sort((a, b) => b.n - a.n)
      .slice(0, 10),
  };
}

function buildEventWatch(store: NewFeedStore | null): EventWatch {
  const official = new Set((store?.officialTags || []).map((t) => t.toLowerCase()));
  const prev = new Set((store?.officialTagsPrev || []).map((t) => t.toLowerCase()));
  const latest = (store?.latest || []).filter((c) => !c.own);
  const byTag = new Map<string, { tag: string; cards: NewFeedCard[]; creators: Set<string> }>();
  for (const c of latest) {
    for (const raw of c.tags) {
      const tag = raw.trim();
      if (!tag) continue;
      const k = tag.toLowerCase();
      const cur = byTag.get(k) || { tag, cards: [], creators: new Set() };
      cur.cards.push(c);
      if (c.userId) cur.creators.add(c.userId);
      byTag.set(k, cur);
    }
  }
  const tags: EventWatchTag[] = [];
  for (const row of byTag.values()) {
    const k = row.tag.toLowerCase();
    const newOfficial = official.has(k) && prev.size > 0 && !prev.has(k);
    const notInCatalog = official.size > 0 && !official.has(k);
    if (!newOfficial && !notInCatalog) continue;
    if (row.creators.size < 1) continue;
    tags.push({
      tag: row.tag,
      cards: row.cards.length,
      creators: row.creators.size,
      kind: newOfficial ? "new-official" : "not-in-catalog",
      sample: row.cards.slice(0, 4).map((c) => c.characterName),
    });
  }
  tags.sort((a, b) => b.creators - a.creators || b.cards - a.cards);
  return {
    officialCount: store?.officialTags?.length || 0,
    officialAt: store?.officialTagsAt || null,
    tags: tags.slice(0, 20),
  };
}

export function emptyDashboardSignals(): DashboardSignals {
  return {
    pond: {
      windowHours: 72,
      cards: 0,
      tagRows: [],
      clones: CLONE_TROPES.map((t) => ({ id: t.id, label: t.label, n: 0, titles: [] })),
      hint: "No New-feed snapshot yet.",
    },
    rivalVelocity: [],
    ownMix: { ships: [], filters: [] },
    coin: {
      coin: null,
      coinTotal: null,
      vipCoin: null,
      vipMaxCoin: null,
      dailyCoin: null,
      dailyMaxCoin: null,
      leftover: [],
    },
    variety: { weekStars: 0, regulars: 0, people: [], laneMix: [] },
    eventWatch: { officialCount: 0, officialAt: null, tags: [] },
  };
}

export function buildDashboardSignals(input?: {
  snapshot?: LoungeSnapshot | null;
  economy?: EconomySnapshot | null;
  rivals?: RivalsFile | null;
}): DashboardSignals {
  try {
    const snap = input?.snapshot ?? null;
    const bots = snap?.bots || [];
    const store = loadNewFeedStore();
    return {
      pond: buildPond(store),
      rivalVelocity: buildRivalVelocity(input?.rivals ?? null, snap),
      ownMix: buildOwnMix(bots),
      coin: buildCoin(input?.economy ?? null, bots),
      variety: buildVariety(bots),
      eventWatch: buildEventWatch(store),
    };
  } catch {
    return emptyDashboardSignals();
  }
}
