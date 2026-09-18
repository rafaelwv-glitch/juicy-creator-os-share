/**
 * Cookie-backed lounge vault. Vercel has no DATABASE_URL, so PGLite and GitHub
 * backups are empty. Session + Grok webhook must survive isolate death and login.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { sealString, openString } from "./secret-box";
import { dataPath, ensureDataDir } from "./paths";
import { isValidSession, type JuicySession } from "./session";
import type { GrokHook } from "./grok-hook";

export const LOUNGE_VAULT_COOKIES = ["__Host-jl-lv", "__Host-jl-lv1", "__Host-jl-lv2"] as const;

type LoungeVault = {
  session?: JuicySession | null;
  hook?: Pick<GrokHook, "url" | "secret" | "pullToken" | "enabled"> | null;
};

function readNamedCookie(header: string, name: string): string | null {
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    if (trimmed.slice(0, eq) !== name) continue;
    try {
      return decodeURIComponent(trimmed.slice(eq + 1));
    } catch {
      return trimmed.slice(eq + 1);
    }
  }
  return null;
}

function readVault(request: Request | null | undefined): LoungeVault {
  if (!request) return {};
  const header = request.headers.get("cookie") || "";
  const parts: string[] = [];
  for (const name of LOUNGE_VAULT_COOKIES) {
    const v = readNamedCookie(header, name);
    if (v) parts.push(v);
  }
  if (!parts.length) return {};
  try {
    return JSON.parse(openString(parts.join(""))) as LoungeVault;
  } catch {
    return {};
  }
}

function writeIfMissingOrRicher(file: string, value: unknown, richer: (v: unknown) => boolean) {
  ensureDataDir();
  const p = dataPath(file);
  if (existsSync(p)) {
    try {
      const existing = JSON.parse(readFileSync(p, "utf8"));
      if (!richer(value) && richer(existing)) return;
    } catch {
      /* replace corrupt */
    }
  }
  writeFileSync(p, JSON.stringify(value), "utf8");
}

export function hydrateLoungeVault(request: Request | null | undefined): LoungeVault {
  const vault = readVault(request);
  if (isValidSession(vault.session)) {
    writeIfMissingOrRicher("juicy-session.json", vault.session, (v) => isValidSession(v));
  }
  if (vault.hook?.url || vault.hook?.secret) {
    writeIfMissingOrRicher(
      "grok-hook.json",
      vault.hook,
      (v) => Boolean((v as { url?: string } | null)?.url),
    );
  }
  return vault;
}

function loadFile<T>(name: string): T | null {
  try {
    const p = dataPath(name);
    if (!existsSync(p)) return null;
    return JSON.parse(readFileSync(p, "utf8")) as T;
  } catch {
    return null;
  }
}

export function buildLoungeVault(): LoungeVault {
  const session = loadFile<JuicySession>("juicy-session.json");
  const hook = loadFile<GrokHook>("grok-hook.json");
  return {
    session: isValidSession(session) ? session : null,
    hook: hook?.url || hook?.secret
      ? {
          url: hook.url || "",
          secret: hook.secret || "",
          pullToken: hook.pullToken || "",
          enabled: Boolean(hook.enabled && hook.url),
        }
      : null,
  };
}

function cookieHeader(name: string, value: string): string {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=31536000`;
}

function clearHeader(name: string): string {
  return `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function loungeVaultSetCookies(): string[] {
  const vault = buildLoungeVault();
  if (!vault.session && !vault.hook) {
    return LOUNGE_VAULT_COOKIES.map((name) => clearHeader(name));
  }
  const sealed = sealString(JSON.stringify(vault));
  const chunks: string[] = [];
  const size = 3200;
  for (let i = 0; i < sealed.length; i += size) chunks.push(sealed.slice(i, i + size));
  if (chunks.length > LOUNGE_VAULT_COOKIES.length) {
    console.warn("[lounge-vault] too large", sealed.length);
    const slim = sealString(JSON.stringify({ session: vault.session, hook: vault.hook }));
    return [cookieHeader(LOUNGE_VAULT_COOKIES[0], slim.slice(0, 3200))];
  }
  const headers = chunks.map((c, i) => cookieHeader(LOUNGE_VAULT_COOKIES[i], c));
  for (let i = chunks.length; i < LOUNGE_VAULT_COOKIES.length; i++) {
    headers.push(clearHeader(LOUNGE_VAULT_COOKIES[i]));
  }
  return headers;
}

export async function applyLoungeVaultCookie(): Promise<void> {
  try {
    const { setCookie } = await import("@tanstack/react-start/server");
    const vault = buildLoungeVault();
    if (!vault.session && !vault.hook) {
      for (const name of LOUNGE_VAULT_COOKIES) {
        setCookie(name, "", {
          httpOnly: true,
          secure: true,
          sameSite: "lax",
          path: "/",
          maxAge: 0,
        });
      }
      return;
    }
    const sealed = sealString(JSON.stringify(vault));
    const size = 3200;
    const chunks: string[] = [];
    for (let i = 0; i < sealed.length; i += size) chunks.push(sealed.slice(i, i + size));
    for (let i = 0; i < chunks.length; i++) {
      const name = LOUNGE_VAULT_COOKIES[i];
      if (!name) continue;
      setCookie(name, chunks[i], {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 365,
      });
    }
  } catch {
    /* API routes attach Set-Cookie via jsonResponse */
  }
}

export function withLoungeVaultHeaders(response: Response): Response {
  const extras = loungeVaultSetCookies();
  if (!extras.length) return response;
  const headers = new Headers(response.headers);
  for (const c of extras) headers.append("set-cookie", c);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
