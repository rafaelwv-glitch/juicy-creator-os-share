/**
 * Durable Better Auth users for Vercel-without-Neon.
 * PGLite dies with the isolate; this sealed cookie survives logout.
 */
import { sealString, openString } from "@/lib/juicychat/secret-box";
import { getSql } from "@/lib/db";

export const AUTH_VAULT_COOKIE = "__Host-jl-auth-vault";

type AuthDump = {
  users: Array<Record<string, unknown>>;
  accounts: Array<Record<string, unknown>>;
};

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie") || "";
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

function parseDump(raw: string | null): AuthDump {
  if (!raw) return { users: [], accounts: [] };
  try {
    const json = JSON.parse(openString(raw)) as AuthDump;
    return {
      users: Array.isArray(json.users) ? json.users : [],
      accounts: Array.isArray(json.accounts) ? json.accounts : [],
    };
  } catch {
    return { users: [], accounts: [] };
  }
}

async function insertDump(dump: AuthDump): Promise<number> {
  if (!dump.users.length) return 0;
  const sql = await getSql();
  let n = 0;
  for (const u of dump.users) {
    if (!u?.id || !u?.email) continue;
    await sql.query(
      `insert into "user" ("id","name","email","emailVerified","image","createdAt","updatedAt")
       values ($1,$2,$3,$4,$5,coalesce($6::timestamptz, now()), now())
       on conflict ("email") do nothing`,
      [
        u.id,
        u.name || "Creator",
        String(u.email).toLowerCase(),
        Boolean(u.emailVerified),
        u.image ?? null,
        u.createdAt ?? null,
      ],
    );
    n += 1;
  }
  for (const a of dump.accounts) {
    if (!a?.id || !a?.userId) continue;
    await sql.query(
      `insert into "account" ("id","accountId","providerId","userId","password","createdAt","updatedAt")
       values ($1,$2,$3,$4,$5,coalesce($6::timestamptz, now()), now())
       on conflict ("id") do update set password = coalesce(excluded.password, "account".password), "updatedAt" = now()`,
      [
        a.id,
        a.accountId || a.userId,
        a.providerId || "credential",
        a.userId,
        a.password ?? null,
        a.createdAt ?? null,
      ],
    );
  }
  return n;
}

async function loadDbDump(): Promise<AuthDump> {
  try {
    const sql = await getSql();
    const users = await sql.query<Record<string, unknown>>(
      `select "id","name","email","emailVerified","image","createdAt" from "user"`,
    );
    const accounts = await sql.query<Record<string, unknown>>(
      `select "id","accountId","providerId","userId","password","createdAt" from "account"`,
    );
    return { users, accounts };
  } catch {
    return { users: [], accounts: [] };
  }
}

export async function hydrateAuthFromVault(request: Request): Promise<number> {
  const dump = parseDump(readCookie(request, AUTH_VAULT_COOKIE));
  if (!dump.users.length) return 0;
  try {
    const n = await insertDump(dump);
    if (n) console.warn("[auth-vault] hydrated", n, "users from cookie");
    return n;
  } catch (e) {
    console.warn("[auth-vault] hydrate failed", e);
    return 0;
  }
}

function vaultSetCookie(dump: AuthDump): string | null {
  if (!dump.users.length) return null;
  const sealed = sealString(JSON.stringify(dump));
  if (sealed.length > 3500) {
    console.warn("[auth-vault] payload too large", sealed.length);
    return null;
  }
  return `${AUTH_VAULT_COOKIE}=${encodeURIComponent(sealed)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=31536000`;
}

export async function withAuthVault(request: Request, response: Response): Promise<Response> {
  const db = await loadDbDump();
  const cookie = vaultSetCookie(db);
  if (!cookie) return response;
  const headers = new Headers(response.headers);
  headers.append("set-cookie", cookie);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
