/**
 * Production yield: 3–4 hours per bot as time cost, then lifetime output,
 * current velocity, acceleration, score, image spend, and lifecycle.
 */
import type { JuicyBot, GrowthAnalysis, BotGrowthRow } from "./types";
import type { BotEnrichment } from "./deep-signals";

export const HOURS_OPTIONS = [3, 3.5, 4] as const;
export type HoursInvested = (typeof HOURS_OPTIONS)[number];
export const DEFAULT_HOURS: HoursInvested = 3.5;

export type LifecycleStatus =
  | "draft"
  | "unlisted"
  | "newborn"
  | "launch"
  | "rising"
  | "accelerating"
  | "steady"
  | "evergreen"
  | "cooling"
  | "quiet";

export const LIFECYCLE_LABEL: Record<LifecycleStatus, string> = {
  draft: "Draft",
  unlisted: "Unlisted",
  newborn: "Newborn",
  launch: "Launch",
  rising: "Rising",
  accelerating: "Accelerating",
  steady: "Steady",
  evergreen: "Evergreen",
  cooling: "Cooling",
  quiet: "Quiet",
};

export type ImageInvestment = {
  gen: number;
  gallery: number;
  memory: number;
  figure: boolean;
  label: string;
  weight: number;
};

export type ProductionRow = {
  characterId: string;
  characterName: string;
  characterThumb?: string;
  hours: number;
  chats: number;
  likes: number;
  favorites: number;
  chatsPerHour: number;
  likesPerHour: number;
  favoritesPerHour: number;
  chatsPerDay: number | null;
  recentChatsPerDay: number | null;
  acceleration: number | null;
  dChats: number | null;
  score10: number | null;
  scoreLabel: string;
  images: ImageInvestment;
  ageDays: number | null;
  publishedAt: string | null;
  lifecycle: LifecycleStatus;
  visibility: number | null;
};

export type ProductionReport = {
  hours: number;
  botCount: number;
  hoursInvested: number;
  chatsPerHour: number;
  likesPerHour: number;
  favoritesPerHour: number;
  medianChatsPerHour: number;
  lifecycle: Record<LifecycleStatus, number>;
  rows: ProductionRow[];
};

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

export function formatScore10(raw: number | null | undefined): string {
  if (raw == null || Number.isNaN(raw)) return "—";
  const shown = raw > 1000 ? raw / 100_000 : raw;
  return shown >= 10 ? shown.toFixed(1) : shown.toFixed(2);
}

function dayDiff(from: string, to: string): number {
  const a = Date.parse(`${from}T12:00:00Z`);
  const b = Date.parse(`${to}T12:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return 1;
  return Math.max(1, Math.round((b - a) / 86_400_000));
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

function imageInvestment(b: JuicyBot, e?: BotEnrichment): ImageInvestment {
  const gen = Math.max(0, e?.genPictureCount ?? b.genPictureCount ?? 0);
  const gallery = Math.max(0, e?.galleryCount ?? b.galleryCount ?? 0);
  const memory = Math.max(0, e?.memoryCount ?? b.memoryCount ?? 0);
  const figure = Boolean(e?.figureId || b.figureId);
  const parts: string[] = [];
  if (gen) parts.push(`${gen} gen`);
  if (gallery) parts.push(`${gallery} gal`);
  if (memory) parts.push(`${memory} mem`);
  if (figure) parts.push("figure");
  return {
    gen,
    gallery,
    memory,
    figure,
    label: parts.join(" · ") || "none",
    weight: gen + gallery * 0.5 + memory * 0.25 + (figure ? 4 : 0),
  };
}

function lifecycleOf(input: {
  visibility: number | null;
  ageDays: number | null;
  chats: number;
  chatsPerDay: number | null;
  recentChatsPerDay: number | null;
  acceleration: number | null;
  dChats: number | null;
}): LifecycleStatus {
  const vis = input.visibility;
  const age = input.ageDays;
  const recent = input.recentChatsPerDay ?? input.chatsPerDay ?? 0;
  const accel = input.acceleration;
  const d = input.dChats ?? 0;

  if (vis === 0) return "draft";
  if (vis === 1 && input.chats < 30) return "unlisted";
  if (age == null) return input.chats > 0 ? "steady" : "draft";
  if (age < 2) return "newborn";
  if (age < 10 && (accel == null || accel >= -0.1)) return "launch";
  if (age > 21 && recent < 0.45) return "quiet";
  if (age > 14 && ((accel != null && accel <= -0.35) || d < -40)) return "cooling";
  if (age >= 50 && recent >= 1 && (accel == null || accel >= -0.18) && d >= 0) return "evergreen";
  if (age < 40 && accel != null && accel >= 0.25) return "rising";
  if (accel != null && accel >= 0.2 && d > 0) return "accelerating";
  return "steady";
}

export function analyzeProduction(opts: {
  bots: JuicyBot[];
  growth?: GrowthAnalysis | null;
  enrichment?: BotEnrichment[] | null;
  hours?: number;
}): ProductionReport {
  const hours = opts.hours && opts.hours > 0 ? opts.hours : DEFAULT_HOURS;
  const enrich = new Map((opts.enrichment || []).map((e) => [e.characterId, e]));
  const growth = new Map((opts.growth?.botGrowth || []).map((g) => [g.characterId, g]));
  const timeline = opts.growth?.botTimeline || [];

  const rows: ProductionRow[] = [];
  for (const b of opts.bots || []) {
    if (!b.characterId) continue;
    const e = enrich.get(b.characterId);
    const g: BotGrowthRow | undefined = growth.get(b.characterId);
    const chats = b.chatCount ?? g?.current.chats ?? 0;
    const likes = b.likeCount ?? g?.current.likes ?? 0;
    const favorites = b.favoriteCount ?? g?.current.favorites ?? 0;
    const pubMs = toMs(b.gmtFirstPublish ?? b.gmtCreate);
    const age = ageDays(pubMs);
    const lifetimeCpd = age != null && age > 0.25 ? chats / age : (e?.chatsPerDay ?? null);

    let recentCpd: number | null = lifetimeCpd;
    if (timeline.length >= 2) {
      const lastT = timeline[timeline.length - 1]!;
      const prevT = timeline[Math.max(0, timeline.length - 7)]!;
      const lastB = lastT.bots[b.characterId];
      const prevB = prevT.bots[b.characterId];
      if (lastB && prevB) {
        const span = dayDiff(prevT.date, lastT.date);
        const gained = lastB.chats - prevB.chats;
        const plausible = age != null && age <= 8 ? gained >= 0 : gained >= 0 && gained < chats * 0.85;
        if (plausible) recentCpd = gained / span;
      }
    } else if (g?.dayOverDay?.chats != null && g.dayOverDay.chats >= 0 && g.dayOverDay.chats < chats * 0.85) {
      recentCpd = g.dayOverDay.chats;
    }

    const dChats = g?.dayOverDay?.chats ?? g?.sinceLastRefresh?.chats ?? null;
    const acceleration =
      lifetimeCpd != null && lifetimeCpd > 0.25 && recentCpd != null
        ? (recentCpd - lifetimeCpd) / lifetimeCpd
        : null;
    const scoreRaw = e?.detailScore10 ?? b.score10 ?? null;
    const vis = b.visibility ?? null;
    const images = imageInvestment(b, e);
    const lifecycle = lifecycleOf({
      visibility: vis,
      ageDays: age,
      chats,
      chatsPerDay: lifetimeCpd,
      recentChatsPerDay: recentCpd,
      acceleration,
      dChats,
    });
    rows.push({
      characterId: b.characterId,
      characterName: b.characterName || "Untitled",
      characterThumb: b.characterThumb || b.characterPhoto,
      hours,
      chats,
      likes,
      favorites,
      chatsPerHour: chats / hours,
      likesPerHour: likes / hours,
      favoritesPerHour: favorites / hours,
      chatsPerDay: lifetimeCpd,
      recentChatsPerDay: recentCpd,
      acceleration,
      dChats,
      score10: scoreRaw,
      scoreLabel: formatScore10(scoreRaw),
      images,
      ageDays: age,
      publishedAt: pubMs ? new Date(pubMs).toISOString() : null,
      lifecycle,
      visibility: vis,
    });
  }

  rows.sort((a, b) => b.chatsPerHour - a.chatsPerHour);

  const lifecycle = {
    draft: 0,
    unlisted: 0,
    newborn: 0,
    launch: 0,
    rising: 0,
    accelerating: 0,
    steady: 0,
    evergreen: 0,
    cooling: 0,
    quiet: 0,
  } satisfies Record<LifecycleStatus, number>;
  for (const r of rows) lifecycle[r.lifecycle] += 1;

  const totalChats = rows.reduce((s, r) => s + r.chats, 0);
  const totalLikes = rows.reduce((s, r) => s + r.likes, 0);
  const totalFavs = rows.reduce((s, r) => s + r.favorites, 0);

  return {
    hours,
    botCount: rows.length,
    hoursInvested: rows.length * hours,
    chatsPerHour: totalChats / (rows.length * hours || hours),
    likesPerHour: totalLikes / (rows.length * hours || hours),
    favoritesPerHour: totalFavs / (rows.length * hours || hours),
    medianChatsPerHour: median(rows.map((r) => r.chatsPerHour)),
    lifecycle,
    rows,
  };
}