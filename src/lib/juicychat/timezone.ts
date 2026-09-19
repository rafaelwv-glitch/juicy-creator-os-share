/**
 * Browser-safe timezone helpers. No node: imports — Forensics / Timing / Config
 * all read this from the client.
 *
 * Resolution (server adds file + env on top via timezone-server.ts):
 *   1. remembered manual override
 *   2. this computer's IANA zone (Intl)
 *   3. UTC
 */

export const FALLBACK_TZ = "UTC";
export const TIMEZONE_STORAGE_KEY = "jl_timezone";

export type TimezoneMode = "auto" | "manual";

export type TimezoneState = {
  mode: TimezoneMode;
  timezone: string;
  detected: string;
};

export const COMMON_TIMEZONES = [
  "UTC",
  "Europe/London",
  "Europe/Dublin",
  "Europe/Lisbon",
  "Europe/Madrid",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Amsterdam",
  "Europe/Rome",
  "Europe/Zurich",
  "Europe/Vienna",
  "Europe/Prague",
  "Europe/Warsaw",
  "Europe/Athens",
  "Europe/Helsinki",
  "Europe/Bucharest",
  "Europe/Istanbul",
  "Europe/Moscow",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Toronto",
  "America/Vancouver",
  "America/Mexico_City",
  "America/Bogota",
  "America/Lima",
  "America/Sao_Paulo",
  "America/Argentina/Buenos_Aires",
  "America/Santiago",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Bangkok",
  "Asia/Singapore",
  "Asia/Shanghai",
  "Asia/Hong_Kong",
  "Asia/Tokyo",
  "Asia/Seoul",
  "Australia/Perth",
  "Australia/Sydney",
  "Pacific/Auckland",
  "Africa/Cairo",
  "Africa/Johannesburg",
  "Africa/Lagos",
] as const;

export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || !tz.trim()) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz.trim() }).format(0);
    return true;
  } catch {
    return false;
  }
}

export function detectHostTimezone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (isValidTimeZone(tz)) return tz;
  } catch {
    /* */
  }
  return FALLBACK_TZ;
}

export function normalizeTimeZone(tz: unknown, fallback = detectHostTimezone()): string {
  const raw = typeof tz === "string" ? tz.trim() : "";
  return isValidTimeZone(raw) ? raw : fallback;
}

export function listTimeZones(): string[] {
  const supported = (Intl as typeof Intl & { supportedValuesOf?: (k: string) => string[] })
    .supportedValuesOf?.("timeZone");
  const detected = detectHostTimezone();
  const base =
    Array.isArray(supported) && supported.length > 8
      ? supported
      : [...COMMON_TIMEZONES];
  const set = new Set<string>(base);
  set.add(detected);
  set.add(FALLBACK_TZ);
  return [...set].sort((a, b) => a.localeCompare(b));
}

export function timezoneCity(tz: string): string {
  const last = String(tz || "")
    .split("/")
    .pop()
    ?.replace(/_/g, " ");
  return last || tz || "UTC";
}

export function zonedParts(ms: number, timeZone: string) {
  const tz = normalizeTimeZone(timeZone);
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
    hour12: false,
  });
  const bag: Record<string, string> = {};
  for (const p of fmt.formatToParts(new Date(ms))) {
    if (p.type !== "literal") bag[p.type] = p.value;
  }
  const h = Number(bag.hour);
  const mi = Number(bag.minute);
  return {
    tz,
    date: `${bag.year}-${bag.month}-${bag.day}`,
    h: Number.isFinite(h) ? h % 24 : 0,
    mi: Number.isFinite(mi) ? mi : 0,
    weekday: bag.weekday || "",
  };
}

export function dayKeyInZone(iso: string | Date = new Date(), timeZone?: string): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return "";
  return zonedParts(d.getTime(), timeZone || getDisplayTimezone()).date;
}

export function clockInZone(timeZone: string, now = Date.now()): string {
  const p = zonedParts(now, timeZone);
  return `${String(p.h).padStart(2, "0")}:${String(p.mi).padStart(2, "0")}`;
}

export function offsetLabel(timeZone: string, now = Date.now()): string {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: normalizeTimeZone(timeZone),
      timeZoneName: "shortOffset",
      hour: "2-digit",
    });
    const name = fmt.formatToParts(new Date(now)).find((p) => p.type === "timeZoneName")?.value;
    return name || "";
  } catch {
    return "";
  }
}

export function timezoneSummary(timeZone: string, now = Date.now()): string {
  const tz = normalizeTimeZone(timeZone);
  const off = offsetLabel(tz, now);
  return `${tz} · ${clockInZone(tz, now)}${off ? ` ${off}` : ""}`;
}

let remembered: TimezoneState | null = null;

function readStored(): TimezoneState | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(TIMEZONE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { mode?: string; timezone?: string; detected?: string };
    const detected = isValidTimeZone(parsed.detected) ? parsed.detected : detectHostTimezone();
    const mode: TimezoneMode = parsed.mode === "manual" ? "manual" : "auto";
    const timezone =
      mode === "manual" ? normalizeTimeZone(parsed.timezone, detected) : detected;
    return { mode, timezone, detected };
  } catch {
    return null;
  }
}

export function rememberTimezone(state: { mode: TimezoneMode; timezone: string; detected?: string }) {
  const detected = normalizeTimeZone(state.detected, detectHostTimezone());
  const timezone =
    state.mode === "manual" ? normalizeTimeZone(state.timezone, detected) : detected;
  remembered = { mode: state.mode, timezone, detected };
  if (typeof localStorage === "undefined") return remembered;
  try {
    localStorage.setItem(
      TIMEZONE_STORAGE_KEY,
      JSON.stringify({ ...remembered, savedAt: new Date().toISOString() }),
    );
  } catch {
    /* */
  }
  return remembered;
}

export function getDisplayTimezone(): string {
  if (remembered?.timezone) return remembered.timezone;
  const stored = readStored();
  if (stored) {
    remembered = stored;
    return stored.timezone;
  }
  return detectHostTimezone();
}

export function getTimezoneState(): TimezoneState {
  if (remembered) return remembered;
  const stored = readStored();
  if (stored) {
    remembered = stored;
    return stored;
  }
  const detected = detectHostTimezone();
  remembered = { mode: "auto", timezone: detected, detected };
  return remembered;
}

export function formatWhenInZone(
  iso: string | number | null | undefined,
  timeZone = getDisplayTimezone(),
): string {
  if (iso == null || iso === "") return "—";
  try {
    const d = typeof iso === "number" ? new Date(iso) : new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleString("en-GB", {
      timeZone: normalizeTimeZone(timeZone),
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return String(iso);
  }
}
