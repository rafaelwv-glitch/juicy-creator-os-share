import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { dataPath, ensureDataDir, currentLoungeUserId } from "./paths";

export type JuicySession = {
  cookie: string;
  secretKey: string;
  distinctId: string;
  userId?: string;
  userName?: string;
  userNo?: string;
  email?: string;
  loggedInAt?: string;
  source?: "password" | "magic-link" | "manual-cookie" | "google" | "android";
};

function sessionPath() {
  return dataPath("juicy-session.json");
}

export function isValidSession(v: unknown): v is JuicySession {
  if (!v || typeof v !== "object") return false;
  const s = v as JuicySession;
  return typeof s.cookie === "string" && s.cookie.length > 8;
}

function readFileSession(): JuicySession | null {
  try {
    const path = sessionPath();
    if (!existsSync(path)) return null;
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as JuicySession | null;
    return isValidSession(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeFileSession(session: JuicySession | null) {
  try {
    ensureDataDir();
    const path = sessionPath();
    if (!session) {
      if (existsSync(path)) unlinkSync(path);
      return;
    }
    writeFileSync(path, JSON.stringify(session, null, 2), "utf8");
  } catch {
    /* FS may be RO — Postgres user-kv is the durable source of truth */
  }
}

/**
 * Load JuicyChat session from the current lounge-account working set.
 * Source of truth is Postgres `lounge_user_kv` (pulled into this process by
 * withUserStore). Credentials are NOT stored in a browser cookie.
 */
export function loadSession(): JuicySession | null {
  return readFileSession();
}

export function saveSession(session: JuicySession) {
  if (!isValidSession(session)) return;
  writeFileSession(session);
  const uid = currentLoungeUserId();
  if (uid) {
    void import("./user-kv")
      .then((m) => m.upsertSessionKv(uid, session))
      .then(() => import("./relational"))
      .then((m) => m.upsertAccountFromFiles(uid))
      .catch(() => undefined);
  }
}

export function clearSession() {
  writeFileSession(null);
  const uid = currentLoungeUserId();
  if (uid) {
    void import("./user-kv")
      .then((m) => m.deleteSessionKv(uid))
      .catch(() => undefined);
  }
}

export function mergeCookies(
  existing: string,
  setCookieHeaders: string[],
  opts?: { allowDropVoucher?: boolean },
): string {
  const map = new Map<string, string>();
  for (const part of existing.split(";").map((s) => s.trim()).filter(Boolean)) {
    const eq = part.indexOf("=");
    if (eq > 0) map.set(part.slice(0, eq), part.slice(eq + 1));
  }
  for (const header of setCookieHeaders) {
    const first = header.split(";")[0] ?? "";
    const eq = first.indexOf("=");
    if (eq > 0) {
      const name = first.slice(0, eq).trim();
      const value = first.slice(eq + 1).trim();
      const drop = value === "" || value.toLowerCase() === "deleted";
      if (drop) {
        // JuicyChat 401s sometimes send voucher=deleted. Keep the stored voucher
        // unless this is an explicit sign-out.
        if (!opts?.allowDropVoucher && /voucher/i.test(name)) continue;
        map.delete(name);
      } else {
        map.set(name, value);
      }
    }
  }
  return [...map.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}
