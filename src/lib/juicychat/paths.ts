import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AsyncLocalStorage } from "node:async_hooks";
import { ensureLoungeHome, isServerlessRuntime, resolveLoungeDataDir } from "@/lib/lounge-home";

/**
 * Per-request lounge account id. All JSON files under getDataDir() are scoped
 * to this user so concurrent Vercel invocations cannot mix accounts.
 */
export const loungeUserAls = new AsyncLocalStorage<string>();

export function currentLoungeUserId(): string | null {
  return loungeUserAls.getStore() || null;
}

function rootDataDir(): string {
  if (isServerlessRuntime()) return join(tmpdir(), "juicy-lounge-data");
  ensureLoungeHome();
  return resolveLoungeDataDir();
}

function safeUserSegment(userId: string): string {
  return userId.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80) || "user";
}

export function loungeUserDir(userId: string): string {
  const dir = join(rootDataDir(), "users", safeUserSegment(userId));
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    return dir;
  } catch {
    const fallback = join(tmpdir(), "juicy-lounge-data", "users", safeUserSegment(userId));
    if (!existsSync(fallback)) mkdirSync(fallback, { recursive: true });
    return fallback;
  }
}

export function userDataPath(userId: string, ...parts: string[]): string {
  return join(loungeUserDir(userId), ...parts);
}

/**
 * Writable data directory for JuicyChat session/snapshots.
 * Local / Electron: user-data home (`lounge/`)
 * Vercel: /tmp/juicy-lounge-data
 * When a lounge account is in ALS: .../users/<id>
 */
export function getDataDir(): string {
  const uid = currentLoungeUserId();
  if (uid) return loungeUserDir(uid);
  return join(rootDataDir(), "shared");
}

export function ensureDataDir(): string {
  const dir = getDataDir();
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    return dir;
  } catch (e) {
    const uid = currentLoungeUserId();
    const fallback = uid
      ? join(tmpdir(), "juicy-lounge-data", "users", safeUserSegment(uid))
      : join(tmpdir(), "juicy-lounge-data", "shared");
    if (dir !== fallback) {
      if (!existsSync(fallback)) mkdirSync(fallback, { recursive: true });
      return fallback;
    }
    throw e;
  }
}

export function dataPath(...parts: string[]): string {
  return join(ensureDataDir(), ...parts);
}
