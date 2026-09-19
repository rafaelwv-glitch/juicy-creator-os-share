/**
 * Named scrape jobs. The 15-minute cloud tick always fires due publishes;
 * it only scrapes when one of these jobs is due.
 * Server-only (fs). Client talks through createServerFn in actions.ts.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dataPath, ensureDataDir } from "./paths";
import { loungeTimezone } from "./timezone-server";
import { timezoneCity, zonedParts } from "./timezone";
export const SCHEDULE_FILE = "pull-schedule.json";
/** @deprecated Catch-up no longer uses a short due window. Kept so old imports compile. */
export const DUE_WINDOW_MIN = 20;
export const MAX_JOBS = 8;

export const PULL_SOURCE_KEYS = [
  "lounge",
  "followers",
  "notifications",
  "insights",
  "deep",
  "rivals",
  "followed",
] as const;

export type PullSourceKey = (typeof PULL_SOURCE_KEYS)[number];
export type PullSources = Record<PullSourceKey, boolean>;
export type PullTime = { hour: number; minute: number };
export type JobWhen = "time" | "interval";

export type PullJob = {
  id: string;
  name: string;
  enabled: boolean;
  when: JobWhen;
  hour: number;
  minute: number;
  intervalHours: number;
  complete: boolean;
  sources: PullSources;
  lastFiredAt?: string | null;
};

export type PullSchedule = {
  version: 2;
  timezone: string;
  /** Master pause for every scrape job. Releases still fire. */
  enabled: boolean;
  jobs: PullJob[];
  lastScheduledAt?: string | null;
  updatedAt?: string | null;
  /** v1 leftovers kept so old files round-trip during migrate */
  mode?: "times" | "interval";
  times?: PullTime[];
  intervalHours?: number;
  complete?: boolean;
  sources?: PullSources;
};

export const DEFAULT_TIMES: PullTime[] = [
  { hour: 5, minute: 0 },
  { hour: 23, minute: 55 },
];

export const DEFAULT_SOURCES: PullSources = {
  lounge: true,
  followers: true,
  notifications: true,
  insights: true,
  deep: true,
  rivals: true,
  followed: true,
};

export const SOURCE_LABELS: Record<PullSourceKey, { label: string; hint: string }> = {
  lounge: { label: "Lounge snapshot", hint: "Profile, bots, chats, follower total" },
  followers: { label: "Followers", hint: "Named follower list + history" },
  notifications: { label: "Notifications", hint: "Likes, stars, comments, follows" },
  insights: { label: "Insights", hint: "Wallet, gifts, discovery feeds" },
  deep: { label: "Ranks & tags", hint: "Leaderboards, tag maps, comment pulse" },
  rivals: { label: "Rivals", hint: "Neighbor roster + MRT" },
  followed: { label: "Followed bots", hint: "Public cards you pinned on Forensics" },
};

export const INTERVAL_OPTIONS = [1, 2, 3, 4, 6, 8, 12, 24] as const;

export function formatPullTime(t: PullTime): string {
  const h = Math.max(0, Math.min(23, Math.trunc(t.hour)));
  const m = Math.max(0, Math.min(59, Math.trunc(t.minute)));
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function parsePullTime(raw: string): PullTime | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(raw || "").trim());
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

function clampInt(n: unknown, min: number, max: number, fallback: number): number {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(v)));
}

function newId(prefix = "job"): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function emptySources(on: boolean): PullSources {
  const out = { ...DEFAULT_SOURCES };
  for (const k of PULL_SOURCE_KEYS) out[k] = on;
  return out;
}

export function normalizeSources(raw: unknown): PullSources {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out = emptySources(true);
  for (const key of PULL_SOURCE_KEYS) {
    if (key in src) out[key] = Boolean(src[key]);
  }
  if (!PULL_SOURCE_KEYS.some((k) => out[k])) out.lounge = true;
  return out;
}

function defaultJobName(hour: number, minute: number): string {
  if (hour === 5 && minute === 0) return "Morning scrape";
  if (hour === 23 && minute === 55) return "Night scrape";
  return `${formatPullTime({ hour, minute })} scrape`;
}

export function makeJob(partial?: Partial<PullJob>): PullJob {
  const hour = clampInt(partial?.hour, 0, 23, 12);
  const minute = clampInt(partial?.minute, 0, 59, 0);
  return {
    id: String(partial?.id || newId()),
    name: String(partial?.name || defaultJobName(hour, minute)).slice(0, 40) || defaultJobName(hour, minute),
    enabled: partial?.enabled === false ? false : true,
    when: partial?.when === "interval" ? "interval" : "time",
    hour,
    minute,
    intervalHours: clampInt(partial?.intervalHours, 1, 24, 12),
    complete: Boolean(partial?.complete),
    sources: normalizeSources(partial?.sources),
    lastFiredAt: typeof partial?.lastFiredAt === "string" ? partial.lastFiredAt : null,
  };
}

export function defaultJobs(): PullJob[] {
  return [
    makeJob({
      id: "morning",
      name: "Morning scrape",
      hour: 5,
      minute: 0,
      complete: false,
      sources: emptySources(true),
    }),
    makeJob({
      id: "night",
      name: "Night scrape",
      hour: 23,
      minute: 55,
      complete: false,
      sources: emptySources(true),
    }),
  ];
}

function migrateV1(o: Record<string, unknown>): PullJob[] {
  const complete = Boolean(o.complete);
  const sources = normalizeSources(o.sources);
  const mode = o.mode === "interval" ? "interval" : "times";
  if (mode === "interval") {
    return [
      makeJob({
        id: "interval",
        name: `Every ${clampInt(o.intervalHours, 1, 24, 12)}h scrape`,
        when: "interval",
        intervalHours: clampInt(o.intervalHours, 1, 24, 12),
        complete,
        sources,
        lastFiredAt: typeof o.lastScheduledAt === "string" ? o.lastScheduledAt : null,
      }),
    ];
  }
  const times = Array.isArray(o.times) ? o.times : DEFAULT_TIMES;
  const jobs: PullJob[] = [];
  const seen = new Set<string>();
  for (const t of times) {
    const hour = clampInt((t as PullTime)?.hour, 0, 23, -1);
    const minute = clampInt((t as PullTime)?.minute, 0, 59, -1);
    if (hour < 0 || minute < 0) continue;
    const id = `t-${hour}-${minute}`;
    if (seen.has(id)) continue;
    seen.add(id);
    jobs.push(
      makeJob({
        id,
        name: defaultJobName(hour, minute),
        hour,
        minute,
        complete,
        sources,
        lastFiredAt: typeof o.lastScheduledAt === "string" ? o.lastScheduledAt : null,
      }),
    );
    if (jobs.length >= MAX_JOBS) break;
  }
  return jobs.length ? jobs : defaultJobs();
}

function normalizeJobs(raw: unknown, fallbackLast?: string | null): PullJob[] {
  if (!Array.isArray(raw) || !raw.length) return defaultJobs();
  const out: PullJob[] = [];
  const ids = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const j = makeJob(item as Partial<PullJob>);
    if (!j.lastFiredAt && fallbackLast) j.lastFiredAt = fallbackLast;
    if (ids.has(j.id)) j.id = newId();
    ids.add(j.id);
    out.push(j);
    if (out.length >= MAX_JOBS) break;
  }
  return out.length ? out : defaultJobs();
}

export function normalizePullSchedule(raw: unknown): PullSchedule {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const last =
    typeof o.lastScheduledAt === "string" && o.lastScheduledAt.trim()
      ? o.lastScheduledAt
      : null;
  const updated =
    typeof o.updatedAt === "string" && o.updatedAt.trim() ? o.updatedAt : null;
  const jobs =
    o.version === 2 || Array.isArray(o.jobs)
      ? normalizeJobs(o.jobs, last)
      : migrateV1(o);
  return {
    version: 2,
    timezone: loungeTimezone(),
    enabled: o.enabled === false ? false : true,
    jobs,
    lastScheduledAt: last,
    updatedAt: updated,
  };
}

function cloneDefault(): PullSchedule {
  return {
    version: 2,
    timezone: loungeTimezone(),
    enabled: true,
    jobs: defaultJobs(),
    lastScheduledAt: null,
    updatedAt: null,
  };
}

function zoneClock(ms: number) {
  const p = zonedParts(ms, loungeTimezone());
  return { h: p.h, mi: p.mi };
}

function minuteFloor(ms: number): number {
  return ms - (ms % 60_000);
}

/** Most recent HH:MM in the lounge timezone that is <= now, or null if none in the last 36h. */
export function lastTimeSlot(job: PullJob, now = Date.now()): number | null {
  const start = minuteFloor(now);
  const end = start - 36 * 3_600_000;
  for (let t = start; t >= end; t -= 60_000) {
    const p = zoneClock(t);
    if (p.h === job.hour && p.mi === job.minute) return t;
  }
  return null;
}

/** Next HH:MM in the lounge timezone at or after `from` (inclusive). */
export function nextTimeSlot(job: PullJob, from = Date.now()): number | null {
  const start = minuteFloor(from);
  const end = start + 36 * 3_600_000;
  for (let t = start; t <= end; t += 60_000) {
    const p = zoneClock(t);
    if (p.h === job.hour && p.mi === job.minute) return t;
  }
  return null;
}

function lastFiredMs(job: PullJob): number {
  const last = Date.parse(job.lastFiredAt || "");
  return Number.isFinite(last) ? last : 0;
}

export function jobWhenLabel(job: PullJob): string {
  if (job.when === "interval") {
    const n = Math.max(1, job.intervalHours || 12);
    return `Every ${n} hour${n === 1 ? "" : "s"}`;
  }
  return `${formatPullTime({ hour: job.hour, minute: job.minute })} ${timezoneCity(loungeTimezone())}`;
}

export function jobSourceKeys(job: PullJob): PullSourceKey[] {
  return PULL_SOURCE_KEYS.filter((k) => job.sources[k]);
}

export function jobDepthLabel(job: PullJob): "complete" | "light" {
  return job.complete ? "complete" : "light";
}

export function nextJobFire(job: PullJob, now = Date.now()): string | null {
  if (!job.enabled) return null;
  if (job.when === "interval") {
    const hours = Math.max(1, job.intervalHours || 12);
    const last = lastFiredMs(job);
    let t = last ? last + hours * 3_600_000 : now;
    if (t < now - 60_000) t = now;
    return new Date(t).toISOString();
  }
  const slot = lastTimeSlot(job, now);
  const fired = lastFiredMs(job);
  if (slot != null && fired < slot - 30_000) {
    return new Date(slot).toISOString();
  }
  const next = nextTimeSlot(job, now + 60_000);
  return next != null ? new Date(next).toISOString() : null;
}

export type UpcomingRun = {
  at: string;
  jobId: string;
  name: string;
  when: string;
  depth: "complete" | "light";
  sources: PullSourceKey[];
  overdue?: boolean;
};

export function upcomingRuns(schedule: PullSchedule, now = Date.now(), count = 4): UpcomingRun[] {
  if (!schedule.enabled) return [];
  const rows: UpcomingRun[] = [];
  for (const job of schedule.jobs) {
    if (!job.enabled) continue;
    const at = nextJobFire(job, now);
    if (!at) continue;
    rows.push({
      at,
      jobId: job.id,
      name: job.name,
      when: jobWhenLabel(job),
      depth: jobDepthLabel(job),
      sources: jobSourceKeys(job),
      overdue: Date.parse(at) < now - 30_000,
    });
  }
  rows.sort((a, b) => a.at.localeCompare(b.at));
  return rows.slice(0, count);
}

export function isJobDue(job: PullJob, now = Date.now()): boolean {
  if (!job.enabled) return false;
  const fired = lastFiredMs(job);
  if (job.when === "interval") {
    const hours = Math.max(1, job.intervalHours || 12);
    if (!fired) return true;
    return now - fired >= hours * 3_600_000 - 60_000;
  }
  // Catch-up: due once the lounge clock has passed today's (or the latest)
  // slot and this job has not run for that occurrence. Late cloud ticks
  // still scrape; a 20-minute window was dropping 05:00 when the tick
  // arrived at 05:45.
  const slot = lastTimeSlot(job, now);
  if (slot == null) return false;
  return fired < slot - 30_000;
}

export function dueJobs(schedule: PullSchedule, now = Date.now()): PullJob[] {
  if (!schedule.enabled) return [];
  return schedule.jobs.filter((j) => isJobDue(j, now));
}

export function mergeJobPulls(jobs: PullJob[]): { complete: boolean; sources: PullSources } {
  const sources = emptySources(false);
  let complete = false;
  for (const job of jobs) {
    if (job.complete) complete = true;
    for (const k of PULL_SOURCE_KEYS) {
      if (job.sources[k]) sources[k] = true;
    }
  }
  if (!PULL_SOURCE_KEYS.some((k) => sources[k])) sources.lounge = true;
  return { complete, sources };
}

export function isPullDue(schedule: PullSchedule, now = Date.now()): boolean {
  return dueJobs(schedule, now).length > 0;
}

export function nextScheduledPulls(schedule: PullSchedule, now = Date.now(), count = 2): string[] {
  return upcomingRuns(schedule, now, count).map((r) => r.at);
}

export function loadPullSchedule(): PullSchedule {
  try {
    const p = dataPath(SCHEDULE_FILE);
    if (!existsSync(p)) return cloneDefault();
    return normalizePullSchedule(JSON.parse(readFileSync(p, "utf8")));
  } catch {
    return cloneDefault();
  }
}

function writeSchedule(next: PullSchedule): PullSchedule {
  ensureDataDir();
  writeFileSync(dataPath(SCHEDULE_FILE), JSON.stringify(next), "utf8");
  return next;
}

export function savePullSchedule(input: unknown): PullSchedule {
  const prev = loadPullSchedule();
  const incoming = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const merged: Record<string, unknown> = {
    ...prev,
    ...incoming,
    version: 2,
    jobs: incoming.jobs !== undefined ? incoming.jobs : prev.jobs,
    lastScheduledAt:
      incoming.lastScheduledAt === undefined ? prev.lastScheduledAt : incoming.lastScheduledAt,
    updatedAt: new Date().toISOString(),
  };
  return writeSchedule(normalizePullSchedule(merged));
}

export function markJobsFired(ids: string[], now = Date.now()): PullSchedule {
  const iso = new Date(now).toISOString();
  const prev = loadPullSchedule();
  const idSet = new Set(ids);
  const jobs = prev.jobs.map((j) => (idSet.has(j.id) ? { ...j, lastFiredAt: iso } : j));
  return writeSchedule({
    ...prev,
    jobs,
    lastScheduledAt: iso,
    updatedAt: prev.updatedAt ?? iso,
  });
}

/** Marks every currently due job. Used by the cron tick. */
export function markPullFired(now = Date.now()): PullSchedule {
  const sched = loadPullSchedule();
  const due = dueJobs(sched, now);
  if (!due.length) {
    return writeSchedule({ ...sched, lastScheduledAt: new Date(now).toISOString() });
  }
  return markJobsFired(
    due.map((j) => j.id),
    now,
  );
}

export function scheduleSummary(schedule: PullSchedule): {
  pullTimes: string[];
  nextPulls: string[];
  depth: "complete" | "light";
  sourceKeys: PullSourceKey[];
} {
  const enabled = schedule.jobs.filter((j) => j.enabled);
  const pullTimes = schedule.enabled
    ? enabled.map((j) => `${j.name} ${jobWhenLabel(j)}`)
    : [];
  const mixedComplete = enabled.some((j) => j.complete);
  const mixedLight = enabled.some((j) => !j.complete);
  const depth: "complete" | "light" =
    mixedComplete && !mixedLight ? "complete" : "light";
  const sourceKeys = PULL_SOURCE_KEYS.filter((k) => enabled.some((j) => j.sources[k]));
  return {
    pullTimes,
    nextPulls: nextScheduledPulls(schedule),
    depth,
    sourceKeys,
  };
}

export function packScheduleView(schedule: PullSchedule) {
  const summary = scheduleSummary(schedule);
  return {
    schedule,
    jobs: schedule.jobs,
    nextPulls: summary.nextPulls,
    upcoming: upcomingRuns(schedule),
    sourceMeta: PULL_SOURCE_KEYS.map((key) => ({ key, ...SOURCE_LABELS[key] })),
    intervalOptions: [...INTERVAL_OPTIONS],
    timezone: loungeTimezone(),
    tick: "15 min",
    pullTimes: summary.pullTimes,
    depth: summary.depth,
    sourceKeys: summary.sourceKeys,
  };
}
