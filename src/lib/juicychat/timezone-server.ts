/**
 * Server persistence for the lounge timezone.
 * Do not import from client components (uses node:fs).
 *
 * Resolution:
 *   1. timezone.json manual override
 *   2. timezone.json auto → this computer (Intl)
 *   3. JUICY_TZ env (only when no file yet)
 *   4. this computer (Intl) → UTC
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dataPath, ensureDataDir } from "./paths";
import {
  detectHostTimezone,
  isValidTimeZone,
  normalizeTimeZone,
  type TimezoneMode,
} from "./timezone";

export const TIMEZONE_FILE = "timezone.json";

export type TimezoneSettings = {
  version: 1;
  mode: TimezoneMode;
  timezone: string;
  manualTimezone: string | null;
  detected: string;
  updatedAt: string | null;
};

type StoredFile = {
  version?: number;
  mode?: string;
  timezone?: string;
  manualTimezone?: string | null;
  detected?: string;
  updatedAt?: string | null;
};

let memo: { at: number; value: TimezoneSettings } | null = null;
const MEMO_MS = 1500;

export function resetTimezoneMemo() {
  memo = null;
}

function envOverride(): string | null {
  const raw = typeof process !== "undefined" ? process.env.JUICY_TZ?.trim() : "";
  return isValidTimeZone(raw) ? raw : null;
}

function readFile(): StoredFile | null {
  try {
    const p = dataPath(TIMEZONE_FILE);
    if (!existsSync(p)) return null;
    const raw = JSON.parse(readFileSync(p, "utf8")) as StoredFile;
    return raw && typeof raw === "object" ? raw : null;
  } catch {
    return null;
  }
}

export function loadTimezoneSettings(): TimezoneSettings {
  if (memo && Date.now() - memo.at < MEMO_MS) return memo.value;
  const detected = detectHostTimezone();
  const file = readFile();
  const env = envOverride();
  let mode: TimezoneMode;
  let manual: string | null;
  if (file) {
    mode = file.mode === "manual" ? "manual" : "auto";
    manual =
      isValidTimeZone(file.manualTimezone) ? file.manualTimezone!
      : isValidTimeZone(file.timezone) && mode === "manual" ? file.timezone!
      : null;
  } else if (env) {
    mode = "manual";
    manual = env;
  } else {
    mode = "auto";
    manual = null;
  }
  const timezone = mode === "manual" && manual ? manual : detected;
  const value: TimezoneSettings = {
    version: 1,
    mode,
    timezone: normalizeTimeZone(timezone, detected),
    manualTimezone: manual,
    detected,
    updatedAt: typeof file?.updatedAt === "string" ? file.updatedAt : null,
  };
  memo = { at: Date.now(), value };
  return value;
}

export function loungeTimezone(): string {
  return loadTimezoneSettings().timezone;
}

export function saveTimezoneSettings(input: {
  mode?: TimezoneMode | string;
  timezone?: string | null;
}): TimezoneSettings {
  const detected = detectHostTimezone();
  const mode: TimezoneMode = input.mode === "manual" ? "manual" : "auto";
  const manual =
    mode === "manual" ? normalizeTimeZone(input.timezone, detected) : null;
  const next: TimezoneSettings = {
    version: 1,
    mode,
    timezone: mode === "manual" && manual ? manual : detected,
    manualTimezone: manual,
    detected,
    updatedAt: new Date().toISOString(),
  };
  ensureDataDir();
  writeFileSync(dataPath(TIMEZONE_FILE), JSON.stringify(next, null, 2), "utf8");
  memo = { at: Date.now(), value: next };
  return next;
}

export function timezonePublicPayload() {
  const s = loadTimezoneSettings();
  return {
    timezone: s.timezone,
    mode: s.mode,
    detected: s.detected,
    manualTimezone: s.manualTimezone,
    updatedAt: s.updatedAt,
  };
}
