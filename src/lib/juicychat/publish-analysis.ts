/**
 * Infer bot publish/launch timestamps from lounge scrape fields and
 * measure whether publish day-of-week / hour correlates with performance.
 *
 * Primary source: gmtFirstPublish (when the bot went public).
 * Fallback: gmtCreate (draft created — slightly earlier).
 */
import type { JuicyBot, LoungeSnapshot } from "./types";
import { loungeTimezone } from "./timezone-server";

export function publishTz() {
  return loungeTimezone();
}
const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export type PublishSource = "gmtFirstPublish" | "gmtCreate" | "none";

export type BotPublishRow = {
  characterId: string;
  characterName: string;
  characterThumb?: string;
  chats: number;
  likes: number;
  favorites: number;
  interactions: number;
  score10?: number;
  /** Epoch ms used for analysis */
  publishedAtMs: number;
  publishedAtIso: string;
  publishedLocal: string;
  source: Exclude<PublishSource, "none">;
  dayOfWeek: number; // 0=Sun
  dayLabel: string;
  hour: number; // 0-23 local
  date: string; // YYYY-MM-DD local
  ageDays: number;
  chatsPerDay: number;
  likesPerDay: number;
  interactionsPerDay: number;
};

export type BucketStat = {
  key: string | number;
  label: string;
  n: number;
  avgChats: number;
  avgLikes: number;
  avgInteractions: number;
  avgChatsPerDay: number;
  avgLikesPerDay: number;
  avgInteractionsPerDay: number;
  medianChatsPerDay: number;
  totalChats: number;
};

export type PublishAnalysis = {
  timezone: string;
  analyzedAt: string;
  botCount: number;
  withPublish: number;
  withCreateOnly: number;
  missing: number;
  /** Average age (days) of analyzed bots */
  avgAgeDays: number;
  byDayOfWeek: BucketStat[];
  byHour: BucketStat[];
  /** Combined slot e.g. "Fri 18:00" ranked by avg chats/day (min n) */
  bestSlots: Array<BucketStat & { dayOfWeek: number; hour: number }>;
  worstSlots: Array<BucketStat & { dayOfWeek: number; hour: number }>;
  /** Top performers with their publish timestamp */
  topByChatsPerDay: BotPublishRow[];
  topByChats: BotPublishRow[];
  newest: BotPublishRow[];
  bots: BotPublishRow[];
  insight: string;
};

function toMs(v: string | number | null | undefined): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  // seconds vs ms heuristic
  if (n < 1e12) return Math.round(n * 1000);
  return Math.round(n);
}

export function resolvePublishTs(bot: JuicyBot): {
  ms: number;
  source: Exclude<PublishSource, "none">;
} | null {
  const pub = toMs(bot.gmtFirstPublish);
  if (pub) return { ms: pub, source: "gmtFirstPublish" };
  const create = toMs(bot.gmtCreate);
  if (create) return { ms: create, source: "gmtCreate" };
  return null;
}

function localParts(ms: number, timeZone = publishTz()) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    fmt
      .formatToParts(new Date(ms))
      .filter((p) => p.type !== "literal")
      .map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  const dowMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  const dayOfWeek = dowMap[parts.weekday ?? "Sun"] ?? 0;
  const hour = Number(parts.hour ?? 0);
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const publishedLocal = `${DAY_LABELS[dayOfWeek]} ${parts.month}/${parts.day} ${String(hour).padStart(2, "0")}:${parts.minute ?? "00"}`;
  return { dayOfWeek, hour, date, publishedLocal };
}

function median(nums: number[]): number {
  if (!nums.length) return 0;
  const a = [...nums].sort((x, y) => x - y);
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid]! : (a[mid - 1]! + a[mid]!) / 2;
}

function bucketStats(
  key: string | number,
  label: string,
  list: BotPublishRow[],
): BucketStat {
  const n = list.length;
  const sum = (fn: (r: BotPublishRow) => number) =>
    list.reduce((s, r) => s + fn(r), 0);
  return {
    key,
    label,
    n,
    avgChats: n ? sum((r) => r.chats) / n : 0,
    avgLikes: n ? sum((r) => r.likes) / n : 0,
    avgInteractions: n ? sum((r) => r.interactions) / n : 0,
    avgChatsPerDay: n ? sum((r) => r.chatsPerDay) / n : 0,
    avgLikesPerDay: n ? sum((r) => r.likesPerDay) / n : 0,
    avgInteractionsPerDay: n ? sum((r) => r.interactionsPerDay) / n : 0,
    medianChatsPerDay: median(list.map((r) => r.chatsPerDay)),
    totalChats: sum((r) => r.chats),
  };
}

function buildInsight(byDay: BucketStat[], byHour: BucketStat[], n: number): string {
  if (n < 5) {
    return "Need more published bots to estimate launch-time effects (at least ~5).";
  }
  const days = byDay.filter((d) => d.n >= 2);
  const hours = byHour.filter((h) => h.n >= 2);
  if (!days.length || !hours.length) {
    return "Publish timestamps found, but buckets are too sparse for a confident pattern.";
  }
  const bestDay = [...days].sort((a, b) => b.avgChatsPerDay - a.avgChatsPerDay)[0]!;
  const worstDay = [...days].sort((a, b) => a.avgChatsPerDay - b.avgChatsPerDay)[0]!;
  const bestHour = [...hours].sort((a, b) => b.avgChatsPerDay - a.avgChatsPerDay)[0]!;
  const lift =
    worstDay.avgChatsPerDay > 0
      ? bestDay.avgChatsPerDay / worstDay.avgChatsPerDay
      : 0;
  const parts = [
    `Among ${n} bots with launch times (${publishTz()}),`,
    `${bestDay.label} publishes average ${Math.round(bestDay.avgChatsPerDay)} chats/day`,
    `(n=${bestDay.n}) vs ${worstDay.label} at ${Math.round(worstDay.avgChatsPerDay)}/day (n=${worstDay.n})`,
    lift >= 1.15 ? `— ~${lift.toFixed(1)}× stronger day effect.` : "— day effect is mild.",
    `Strongest hour band: ${bestHour.label} (~${Math.round(bestHour.avgChatsPerDay)} chats/day, n=${bestHour.n}).`,
    "Metrics are age-normalized (chats÷age) so older bots don’t dominate purely by lifetime.",
  ];
  return parts.join(" ");
}

export function analyzePublishTiming(
  snapshot: LoungeSnapshot | null | undefined,
  opts?: { nowMs?: number; timezone?: string },
): PublishAnalysis | null {
  if (!snapshot?.bots?.length) return null;
  const tz = opts?.timezone || publishTz();
  const now = opts?.nowMs ?? Date.now();

  const bots: BotPublishRow[] = [];
  let withPublish = 0;
  let withCreateOnly = 0;
  let missing = 0;

  for (const b of snapshot.bots) {
    const resolved = resolvePublishTs(b);
    if (!resolved) {
      missing++;
      continue;
    }
    if (resolved.source === "gmtFirstPublish") withPublish++;
    else withCreateOnly++;

    const chats = b.chatCount ?? 0;
    const likes = b.likeCount ?? 0;
    const favorites = b.favoriteCount ?? 0;
    const interactions = chats + likes + favorites;
    const ageDays = Math.max(1 / 24, (now - resolved.ms) / 86_400_000); // min 1h
    const lp = localParts(resolved.ms, tz);

    bots.push({
      characterId: b.characterId,
      characterName: b.characterName || "Untitled",
      characterThumb: b.characterThumb || b.characterPhoto,
      chats,
      likes,
      favorites,
      interactions,
      score10: b.score10,
      publishedAtMs: resolved.ms,
      publishedAtIso: new Date(resolved.ms).toISOString(),
      publishedLocal: lp.publishedLocal,
      source: resolved.source,
      dayOfWeek: lp.dayOfWeek,
      dayLabel: DAY_LABELS[lp.dayOfWeek] ?? "?",
      hour: lp.hour,
      date: lp.date,
      ageDays,
      chatsPerDay: chats / ageDays,
      likesPerDay: likes / ageDays,
      interactionsPerDay: interactions / ageDays,
    });
  }

  const byDayMap = new Map<number, BotPublishRow[]>();
  const byHourMap = new Map<number, BotPublishRow[]>();
  const bySlotMap = new Map<string, BotPublishRow[]>();

  for (const r of bots) {
    if (!byDayMap.has(r.dayOfWeek)) byDayMap.set(r.dayOfWeek, []);
    byDayMap.get(r.dayOfWeek)!.push(r);
    if (!byHourMap.has(r.hour)) byHourMap.set(r.hour, []);
    byHourMap.get(r.hour)!.push(r);
    const sk = `${r.dayOfWeek}-${r.hour}`;
    if (!bySlotMap.has(sk)) bySlotMap.set(sk, []);
    bySlotMap.get(sk)!.push(r);
  }

  // Mon-first display for days
  const dayOrder = [1, 2, 3, 4, 5, 6, 0];
  const byDayOfWeek = dayOrder.map((d) =>
    bucketStats(d, DAY_LABELS[d] ?? String(d), byDayMap.get(d) ?? []),
  );
  const byHour = Array.from({ length: 24 }, (_, h) =>
    bucketStats(h, `${String(h).padStart(2, "0")}:00`, byHourMap.get(h) ?? []),
  );

  const slots = [...bySlotMap.entries()]
    .map(([k, list]) => {
      const [d, h] = k.split("-").map(Number);
      const label = `${DAY_LABELS[d!] ?? d} ${String(h).padStart(2, "0")}:00`;
      return {
        ...bucketStats(k, label, list),
        dayOfWeek: d!,
        hour: h!,
      };
    })
    .filter((s) => s.n >= 2);

  const bestSlots = [...slots]
    .sort((a, b) => b.avgChatsPerDay - a.avgChatsPerDay)
    .slice(0, 8);
  const worstSlots = [...slots]
    .sort((a, b) => a.avgChatsPerDay - b.avgChatsPerDay)
    .slice(0, 5);

  const topByChatsPerDay = [...bots]
    .sort((a, b) => b.chatsPerDay - a.chatsPerDay)
    .slice(0, 12);
  const topByChats = [...bots].sort((a, b) => b.chats - a.chats).slice(0, 12);
  const newest = [...bots].sort((a, b) => b.publishedAtMs - a.publishedAtMs).slice(0, 12);

  const avgAgeDays = bots.length
    ? bots.reduce((s, r) => s + r.ageDays, 0) / bots.length
    : 0;

  return {
    timezone: tz,
    analyzedAt: new Date(now).toISOString(),
    botCount: snapshot.bots.length,
    withPublish,
    withCreateOnly,
    missing,
    avgAgeDays,
    byDayOfWeek,
    byHour,
    bestSlots,
    worstSlots,
    topByChatsPerDay,
    topByChats,
    newest,
    bots,
    insight: buildInsight(byDayOfWeek, byHour, bots.length),
  };
}

/** Lookup map for UI cards */
export function publishByBotId(analysis: PublishAnalysis | null | undefined) {
  const map = new Map<string, BotPublishRow>();
  if (!analysis) return map;
  for (const b of analysis.bots) map.set(b.characterId, b);
  return map;
}
