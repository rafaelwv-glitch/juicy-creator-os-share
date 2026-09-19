/**
 * Front-page briefing: 7d heat, audit-15 clock queue (in/out), and
 * whether a spike is a new engine or an old comedy waking up.
 *
 * Server-only (fs). Client components import types from briefing-types.ts.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dataPath, ensureDataDir } from "./paths";
import { dayKey } from "./history";
import { AUDIT, classifyBot } from "./publish-bots";
import type { GrowthAnalysis, JuicyBot, LoungeSnapshot } from "./types";
import type {
  ClockBrief,
  ClockItem,
  ClockJob,
  CreatorBriefing,
  HeatPrinter,
  SpikeBrief,
  SpikeKind,
  SpikeRow,
  WeekHeat,
} from "./briefing-types";
import { loungeTimezone } from "./timezone-server";

export type {
  ClockBrief,
  ClockItem,
  ClockJob,
  CreatorBriefing,
  HeatPrinter,
  SpikeBrief,
  SpikeKind,
  SpikeRow,
  WeekHeat,
} from "./briefing-types";

const FILE = "audit15-queue.json";
const MAX_DAYS = 400;
const MAX_EVENTS = 400;

const NEW_ENGINE_AGE = 21;
const OLD_COMEDY_AGE = 40;

type Audit15Name = {
  name: string;
  thumb?: string;
  chats: number;
  gmtCreate?: string | number;
};

type Audit15Day = {
  date: string;
  at: string;
  pending: string[];
  review: string[];
};

type Audit15Event = {
  characterId: string;
  characterName: string;
  characterThumb?: string;
  at: string;
  date: string;
  direction: "in" | "out";
  fate: ClockItem["status"];
};

type Audit15File = {
  version: 1;
  timezone: string;
  lastAt: string | null;
  firstSeen: Record<string, string>;
  days: Audit15Day[];
  names: Record<string, Audit15Name>;
  events: Audit15Event[];
};

function emptyFile(): Audit15File {
  return {
    version: 1,
    timezone: loungeTimezone(),
    lastAt: null,
    firstSeen: {},
    days: [],
    names: {},
    events: [],
  };
}

function toMs(v: string | number | null | undefined): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) {
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
  }
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n < 1e12 ? Math.round(n * 1000) : Math.round(n);
}

export function ageDaysOf(
  bot: { gmtFirstPublish?: string | number; gmtCreate?: string | number } | null | undefined,
  now = Date.now(),
): number | null {
  const ms = toMs(bot?.gmtFirstPublish) ?? toMs(bot?.gmtCreate);
  if (ms == null) return null;
  return Math.max(0, (now - ms) / 86_400_000);
}

function pos(n: number | null | undefined): number {
  if (n == null || !Number.isFinite(n) || n < 0) return 0;
  return n;
}

export function classifySpike(input: {
  ageDays: number | null;
  dodChats: number;
  chats7d: number;
  share7d: number;
}): SpikeKind {
  const age = input.ageDays;
  const dod = pos(input.dodChats);
  const week = pos(input.chats7d);
  const share = pos(input.share7d);
  const dodOfWeek = week > 0 ? dod / week : 0;

  if (age != null && age <= NEW_ENGINE_AGE && (share >= 0.06 || week >= 200 || dod >= 80)) {
    return "new-engine";
  }
  if (
    age != null &&
    age >= OLD_COMEDY_AGE &&
    (share >= 0.08 || (dod >= 80 && dodOfWeek >= 0.28) || (share >= 0.05 && dod >= 40))
  ) {
    return "old-comedy";
  }
  if (dod >= 40 && week > 0 && dodOfWeek >= 0.55 && share < 0.08) {
    return "flash";
  }
  return "steady";
}

export function analyzeWeekHeat(growth: GrowthAnalysis | null | undefined): WeekHeat {
  const week = growth?.last7Days;
  const bots = growth?.botGrowth ?? [];
  const weekChats = pos(week?.chats);
  const printers: HeatPrinter[] = bots
    .map((r) => {
      const chats7d = pos(r.last7Days?.chats);
      const likes7d = pos(r.last7Days?.likes);
      const favorites7d = pos(r.last7Days?.favorites);
      const dodChats = r.dayOverDay?.chats ?? 0;
      return {
        characterId: r.characterId,
        characterName: r.characterName,
        characterThumb: r.characterThumb,
        chats7d,
        likes7d,
        favorites7d,
        dodChats,
        share: weekChats > 0 ? chats7d / weekChats : 0,
        ageDays: null as number | null,
      };
    })
    .filter((p) => p.chats7d > 0 || p.dodChats > 0)
    .sort((a, b) => b.chats7d - a.chats7d || b.dodChats - a.dodChats);

  const daily = (growth?.dailyGrowth || []).slice(-7);
  return {
    chats: weekChats,
    likes: pos(week?.likes),
    favorites: pos(week?.favorites),
    followers: week?.followers ?? 0,
    printers: printers.slice(0, 12),
    daily,
    topShare: printers[0]?.share ?? 0,
  };
}

function stampAge(heat: WeekHeat, bots: JuicyBot[] | undefined, now: number): WeekHeat {
  if (!bots?.length) return heat;
  const byId = new Map(bots.map((b) => [b.characterId, b]));
  return {
    ...heat,
    printers: heat.printers.map((p) => ({
      ...p,
      ageDays: ageDaysOf(byId.get(p.characterId), now),
    })),
  };
}

export function analyzeSpikes(
  growth: GrowthAnalysis | null | undefined,
  bots: JuicyBot[] | undefined,
  now = Date.now(),
): SpikeBrief {
  const weekChats = pos(growth?.last7Days?.chats);
  const byId = new Map((bots || []).map((b) => [b.characterId, b]));
  const rows: SpikeRow[] = [];
  for (const r of growth?.botGrowth ?? []) {
    const chats7d = pos(r.last7Days?.chats);
    const dodChats = r.dayOverDay?.chats ?? 0;
    const share7d = weekChats > 0 ? chats7d / weekChats : 0;
    if (share7d < 0.03 && dodChats < 30 && chats7d < 150) continue;
    const bot = byId.get(r.characterId);
    const age = ageDaysOf(bot, now);
    rows.push({
      characterId: r.characterId,
      characterName: r.characterName,
      characterThumb: r.characterThumb,
      kind: classifySpike({ ageDays: age, dodChats, chats7d, share7d }),
      ageDays: age,
      dodChats,
      chats7d,
      share7d,
      chats: r.current.chats,
    });
  }
  rows.sort((a, b) => b.share7d - a.share7d || b.dodChats - a.dodChats);

  const shown = rows.slice(0, 12);
  const newEngineShare = shown.filter((r) => r.kind === "new-engine").reduce((s, r) => s + r.share7d, 0);
  const oldComedyShare = shown.filter((r) => r.kind === "old-comedy").reduce((s, r) => s + r.share7d, 0);
  const flashShare = shown.filter((r) => r.kind === "flash").reduce((s, r) => s + r.share7d, 0);

  let headline = "Steady printers";
  let detail = "No standout new release or revival in this week's chats.";
  if (oldComedyShare >= 0.22 && oldComedyShare >= newEngineShare * 0.9) {
    headline = "Old comedy waking up";
    detail = `${Math.round(oldComedyShare * 100)}% of this week's chats are from bots older than ${OLD_COMEDY_AGE} days.`;
  } else if (newEngineShare >= 0.22) {
    headline = "New engine";
    detail = `${Math.round(newEngineShare * 100)}% of this week's chats are from bots published in the last ${NEW_ENGINE_AGE} days.`;
  } else if (newEngineShare > 0.04 && oldComedyShare > 0.04) {
    headline = "Mix of new engines and old comedies";
    detail = `New ${Math.round(newEngineShare * 100)}% · old ${Math.round(oldComedyShare * 100)}% of 7d chats.`;
  } else if (flashShare >= 0.12 && flashShare >= newEngineShare && flashShare >= oldComedyShare) {
    headline = "One-day flash";
    detail = "Today's spike is a large slice of a thin week — not yet a new engine.";
  } else if (!shown.length) {
    headline = "Quiet week";
    detail = "Need 2+ scrape days, or nothing is printing yet.";
  }

  return { headline, detail, rows: shown, newEngineShare, oldComedyShare };
}

function loadAudit15(): Audit15File {
  try {
    const p = dataPath(FILE);
    if (!existsSync(p)) return emptyFile();
    const raw = JSON.parse(readFileSync(p, "utf8")) as Audit15File;
    if (!raw || !Array.isArray(raw.days)) return emptyFile();
    return {
      ...emptyFile(),
      ...raw,
      firstSeen: raw.firstSeen && typeof raw.firstSeen === "object" ? raw.firstSeen : {},
      names: raw.names && typeof raw.names === "object" ? raw.names : {},
      events: Array.isArray(raw.events) ? raw.events : [],
      days: raw.days,
    };
  } catch {
    return emptyFile();
  }
}

function saveAudit15(file: Audit15File) {
  ensureDataDir();
  writeFileSync(dataPath(FILE), JSON.stringify(file), "utf8");
}

function idsOf(bots: JuicyBot[], status: "pending_release" | "under_review"): string[] {
  return bots.filter((b) => classifyBot(b) === status).map((b) => b.characterId);
}

function asItem(
  id: string,
  names: Record<string, Audit15Name>,
  bots: Map<string, JuicyBot>,
  firstSeen: Record<string, string>,
  status: ClockItem["status"],
  now: number,
): ClockItem {
  const bot = bots.get(id);
  const n = names[id];
  const seen = firstSeen[id] || null;
  const seenMs = seen ? Date.parse(seen) : NaN;
  const created = toMs(bot?.gmtCreate ?? n?.gmtCreate);
  const waitFrom = Number.isFinite(seenMs) ? seenMs : created;
  return {
    characterId: id,
    characterName: bot?.characterName || n?.name || id,
    characterThumb: bot?.characterThumb || bot?.characterPhoto || n?.thumb,
    chats: bot?.chatCount ?? n?.chats ?? 0,
    waitDays: waitFrom != null ? Math.max(0, (now - waitFrom) / 86_400_000) : null,
    firstSeen: seen,
    gmtCreate: bot?.gmtCreate ?? n?.gmtCreate,
    status,
  };
}

function fateOf(id: string, bots: Map<string, JuicyBot>): ClockItem["status"] {
  const bot = bots.get(id);
  if (!bot) return "gone";
  const st = classifyBot(bot);
  if (st === "under_review") return "review";
  if (st === "rejected") return "rejected";
  if (st === "pending_release") return "pending_release";
  if (bot.gmtFirstPublish) return "published";
  return "gone";
}

function loadJobs(): ClockJob[] {
  try {
    const p = dataPath("publish-jobs.json");
    if (!existsSync(p)) return [];
    const raw = JSON.parse(readFileSync(p, "utf8")) as Array<{
      id?: string;
      characterId?: string;
      characterName?: string;
      fireAtMs?: number;
      status?: string;
    }>;
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((j) => j && (j.status === "scheduled" || j.status === "running") && j.characterId)
      .map((j) => ({
        id: String(j.id || j.characterId),
        characterId: String(j.characterId),
        characterName: String(j.characterName || j.characterId),
        fireAtMs: Number(j.fireAtMs) || 0,
        status: String(j.status),
      }))
      .sort((a, b) => a.fireAtMs - b.fireAtMs);
  } catch {
    return [];
  }
}

/** Record today's audit-15 / review ids so later loads can compute in/out. */
export function persistAudit15(snapshot: LoungeSnapshot | null | undefined): Audit15File {
  const file = loadAudit15();
  if (!snapshot?.bots?.length) return file;
  const nowIso = snapshot.scrapedAt || new Date().toISOString();
  const date = dayKey(nowIso);
  const bots = snapshot.bots;
  const pending = idsOf(bots, "pending_release");
  const review = idsOf(bots, "under_review");
  const byId = new Map(bots.map((b) => [b.characterId, b]));

  const names = { ...file.names };
  for (const b of bots) {
    if (!b.characterId) continue;
    if (b.auditType === AUDIT.PENDING_RELEASE || b.auditType === AUDIT.UNDER_REVIEW || names[b.characterId]) {
      names[b.characterId] = {
        name: b.characterName || names[b.characterId]?.name || b.characterId,
        thumb: b.characterThumb || b.characterPhoto || names[b.characterId]?.thumb,
        chats: b.chatCount ?? names[b.characterId]?.chats ?? 0,
        gmtCreate: b.gmtCreate ?? names[b.characterId]?.gmtCreate,
      };
    }
  }

  const prev = file.days.at(-1);
  const prevPending = new Set(prev?.pending ?? []);
  const hadHistory = file.days.length > 0;
  const firstSeen = { ...file.firstSeen };
  const events = [...file.events];

  if (hadHistory) {
    for (const id of pending) {
      if (prevPending.has(id)) continue;
      if (!firstSeen[id]) firstSeen[id] = nowIso;
      events.push({
        characterId: id,
        characterName: names[id]?.name || byId.get(id)?.characterName || id,
        characterThumb: names[id]?.thumb,
        at: nowIso,
        date,
        direction: "in",
        fate: "pending_release",
      });
    }
    for (const id of prevPending) {
      if (pending.includes(id)) continue;
      events.push({
        characterId: id,
        characterName: names[id]?.name || byId.get(id)?.characterName || id,
        characterThumb: names[id]?.thumb,
        at: nowIso,
        date,
        direction: "out",
        fate: fateOf(id, byId),
      });
    }
  }

  for (const id of pending) {
    if (!firstSeen[id]) firstSeen[id] = nowIso;
  }

  const days = file.days.filter((d) => d.date !== date);
  days.push({ date, at: nowIso, pending, review });
  days.sort((a, b) => a.date.localeCompare(b.date));

  const nameKeys = Object.keys(names);
  if (nameKeys.length > 2000) {
    const keep = new Set([...pending, ...review, ...events.slice(-200).map((e) => e.characterId)]);
    for (const k of nameKeys) {
      if (!keep.has(k)) delete names[k];
    }
  }

  const next: Audit15File = {
    version: 1,
    timezone: loungeTimezone(),
    lastAt: nowIso,
    firstSeen,
    days: days.slice(-MAX_DAYS),
    names,
    events: events.slice(-MAX_EVENTS),
  };
  saveAudit15(next);
  return next;
}

function sinceDaysAgo(date: string, days: number): boolean {
  const t = Date.parse(`${date}T12:00:00Z`);
  if (!Number.isFinite(t)) return false;
  return Date.now() - t <= days * 86_400_000;
}

export function analyzeClock(
  snapshot: LoungeSnapshot | null | undefined,
  fileArg?: Audit15File,
  now = Date.now(),
): ClockBrief {
  const file = fileArg ?? loadAudit15();
  const bots = new Map((snapshot?.bots || []).map((b) => [b.characterId, b]));
  const pending = snapshot?.bots ? idsOf(snapshot.bots, "pending_release") : file.days.at(-1)?.pending ?? [];
  const review = snapshot?.bots ? idsOf(snapshot.bots, "under_review") : file.days.at(-1)?.review ?? [];

  const waiting = pending.map((id) => asItem(id, file.names, bots, file.firstSeen, "pending_release", now));
  const reviewItems = review.map((id) => asItem(id, file.names, bots, file.firstSeen, "under_review", now));

  const inbound = file.events
    .filter((e) => e.direction === "in" && sinceDaysAgo(e.date, 7) && pending.includes(e.characterId))
    .map((e) => asItem(e.characterId, file.names, bots, file.firstSeen, "pending_release", now));
  const inboundDedup = inbound.filter((i, idx) => inbound.findIndex((x) => x.characterId === i.characterId) === idx);

  const outboundRaw = file.events.filter((e) => e.direction === "out" && sinceDaysAgo(e.date, 7));
  const outboundSeen = new Set<string>();
  const outbound: ClockItem[] = [];
  for (let i = outboundRaw.length - 1; i >= 0; i--) {
    const e = outboundRaw[i]!;
    if (outboundSeen.has(e.characterId) || pending.includes(e.characterId)) continue;
    outboundSeen.add(e.characterId);
    outbound.push({
      ...asItem(e.characterId, file.names, bots, file.firstSeen, e.fate, now),
      status: e.fate,
    });
  }

  return {
    waiting,
    review: reviewItems,
    inbound: inboundDedup,
    outbound,
    scheduled: loadJobs(),
  };
}

export function buildBriefing(input: {
  snapshot: LoungeSnapshot | null | undefined;
  growth: GrowthAnalysis | null | undefined;
  now?: number;
}): CreatorBriefing {
  const now = input.now ?? Date.now();
  const heat = stampAge(analyzeWeekHeat(input.growth), input.snapshot?.bots, now);
  const clock = analyzeClock(input.snapshot, undefined, now);
  const spikes = analyzeSpikes(input.growth, input.snapshot?.bots, now);
  return {
    at: input.snapshot?.scrapedAt || new Date(now).toISOString(),
    heat,
    clock,
    spikes,
  };
}
