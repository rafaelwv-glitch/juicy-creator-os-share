/**
 * Durable copy of Better Auth users when the process DB is ephemeral PGLite.
 * Neon is the real store; this is the fallback that keeps email+password alive
 * across Vercel isolates and logouts.
 */
import { getSql, dbSource } from "@/lib/db";

const OWNER = "rafaelwv-glitch";
const REPO = "juicy-creator-os";
const BRANCH = "lounge-data";
const PATH = "auth/users.json";

type AuthDump = {
  users: Array<Record<string, unknown>>;
  accounts: Array<Record<string, unknown>>;
};

function token(): string {
  // Shareable clone is local-only — never write Better Auth users to the private original.
  return "";
}

async function gh(path: string, init?: RequestInit) {
  const t = token();
  if (!t) return null;
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${t}`,
      "x-github-api-version": "2022-11-28",
      ...(init?.headers || {}),
    },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    console.warn("[auth-durable]", res.status, await res.text().catch(() => ""));
    return null;
  }
  return res.json() as Promise<Record<string, unknown>>;
}

async function loadDump(): Promise<AuthDump> {
  const file = await gh(`/repos/${OWNER}/${REPO}/contents/${PATH}?ref=${BRANCH}`);
  const content = typeof file?.content === "string" ? file.content : "";
  if (!content) return { users: [], accounts: [] };
  try {
    const json = JSON.parse(Buffer.from(content.replace(/\n/g, ""), "base64").toString("utf8")) as AuthDump;
    return {
      users: Array.isArray(json.users) ? json.users : [],
      accounts: Array.isArray(json.accounts) ? json.accounts : [],
    };
  } catch {
    return { users: [], accounts: [] };
  }
}

async function saveDump(dump: AuthDump, sha?: string) {
  const t = token();
  if (!t) return;
  await gh(`/repos/${OWNER}/${REPO}/contents/${PATH}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      message: "chore(lounge-data): persist auth users [skip vercel]",
      content: Buffer.from(JSON.stringify(dump, null, 2), "utf8").toString("base64"),
      branch: BRANCH,
      sha,
    }),
  });
}

export async function hydrateAuthFromDurable(): Promise<number> {
  try {
    const sql = await getSql();
    const existing = await sql.query<{ n: number }>(`select count(*)::int as n from "user"`);
    if (Number(existing[0]?.n || 0) > 0) return 0;
    const dump = await loadDump();
    let n = 0;
    for (const u of dump.users) {
      await sql.query(
        `insert into "user" ("id","name","email","emailVerified","image","createdAt","updatedAt")
         values ($1,$2,$3,$4,$5,coalesce($6::timestamptz, now()), now())
         on conflict ("id") do nothing`,
        [
          u.id,
          u.name || "Creator",
          String(u.email || "").toLowerCase(),
          Boolean(u.emailVerified),
          u.image ?? null,
          u.createdAt ?? null,
        ],
      );
      n += 1;
    }
    for (const a of dump.accounts) {
      await sql.query(
        `insert into "account" ("id","accountId","providerId","userId","accessToken","refreshToken","idToken","accessTokenExpiresAt","refreshTokenExpiresAt","scope","password","createdAt","updatedAt")
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,coalesce($12::timestamptz, now()), now())
         on conflict ("id") do nothing`,
        [
          a.id,
          a.accountId,
          a.providerId,
          a.userId,
          a.accessToken ?? null,
          a.refreshToken ?? null,
          a.idToken ?? null,
          a.accessTokenExpiresAt ?? null,
          a.refreshTokenExpiresAt ?? null,
          a.scope ?? null,
          a.password ?? null,
          a.createdAt ?? null,
        ],
      );
    }
    if (n) console.warn("[auth-durable] hydrated", n, "users from GitHub into", dbSource);
    return n;
  } catch (e) {
    console.warn("[auth-durable] hydrate failed", e);
    return 0;
  }
}

export async function persistAuthToDurable(): Promise<void> {
  try {
    const sql = await getSql();
    const users = await sql.query<Record<string, unknown>>(`select * from "user"`);
    const accounts = await sql.query<Record<string, unknown>>(`select * from "account"`);
    const existing = await gh(`/repos/${OWNER}/${REPO}/contents/${PATH}?ref=${BRANCH}`);
    const sha = typeof existing?.sha === "string" ? existing.sha : undefined;
    await saveDump({ users, accounts }, sha);
  } catch (e) {
    console.warn("[auth-durable] persist failed", e);
  }
}

export async function countAuthUsers(): Promise<number> {
  try {
    const sql = await getSql();
    const rows = await sql.query<{ n: number }>(`select count(*)::int as n from "user"`);
    return Number(rows[0]?.n || 0);
  } catch {
    return 0;
  }
}
