/**
 * JuicyChat auth + pending-bot queue for the Android publisher.
 * Stateless: cookie goes in the request, session comes back in the JSON.
 * Never writes lounge user-kv / Better Auth stores.
 */
import { JuicyClient } from "./client";
import { buildQueue, type PublishQueue, type PublishResult } from "./publish-bots";
import { scrapeOwnFromCookie } from "./scrape";
import type { JuicyUserInfo } from "./types";

export type PhoneSessionPayload = {
  cookie: string;
  secretKey: string;
  distinctId: string;
  userId?: string;
  userName?: string;
  userNo?: string;
  email?: string;
  source: "password" | "magic-link" | "manual-cookie" | "google";
  loggedInAt: string;
};

export type PhoneAuthResult = {
  ok: boolean;
  message: string;
  session?: PhoneSessionPayload;
};

function pack(
  client: JuicyClient,
  user: { userId?: string; userName?: string; userNo?: string } | null,
  source: PhoneSessionPayload["source"],
  email?: string,
): PhoneSessionPayload {
  return {
    cookie: client.cookie,
    secretKey: client.secretKey,
    distinctId: client.distinctId,
    userId: user?.userId,
    userName: user?.userName,
    userNo: user?.userNo,
    email: email || "",
    source,
    loggedInAt: new Date().toISOString(),
  };
}

function asUser(v: unknown): { userId?: string; userName?: string; userNo?: string } | null {
  if (!v || typeof v !== "object") return null;
  const u = v as { userId?: string; userName?: string; userNo?: string };
  return u.userId ? u : u;
}

async function pingUser(client: JuicyClient) {
  try {
    const me = await client.get<Record<string, unknown> | null>("/yume/api/user/v1/getUserInfo");
    if (me.data && (me.data as { userId?: string }).userId) {
      return me.data as { userId?: string; userName?: string; userNo?: string };
    }
  } catch {
    /* cookie may still be enough */
  }
  return null;
}

export async function phonePasswordLogin(
  userNo: string,
  password: string,
  email?: string,
): Promise<PhoneAuthResult> {
  const client = new JuicyClient();
  const result = await client.passwordLogin(userNo || "", password);
  if (!result.ok) return { ok: false, message: result.message };
  const user = asUser(result.user);
  if (!client.cookie.includes("yume_voucher") && !user?.userId) {
    return { ok: false, message: result.message || "Login did not create a session." };
  }
  return {
    ok: true,
    message: user?.userName ? `Logged in as @${user.userName}.` : result.message,
    session: pack(client, user, "password", email),
  };
}

export async function phoneMagicSend(email: string, cfToken?: string): Promise<PhoneAuthResult> {
  const client = new JuicyClient();
  const r = await client.requestMagicLinkEmail(email || "", cfToken);
  return { ok: r.ok, message: r.message };
}

export async function phoneMagicRedeem(
  link: string,
  email?: string,
): Promise<PhoneAuthResult> {
  const client = new JuicyClient();
  const result = await client.redeemMagicLink(link);
  if (!result.ok) return { ok: false, message: result.message };
  const user = await pingUser(client);
  return {
    ok: true,
    message: result.message,
    session: pack(client, user, "magic-link", email),
  };
}

export async function phoneCookieLogin(
  cookie: string,
  source: PhoneSessionPayload["source"] = "manual-cookie",
  email?: string,
): Promise<PhoneAuthResult> {
  const raw = (cookie || "").trim();
  if (raw.length < 8) return { ok: false, message: "Paste a JuicyChat cookie (needs yume_voucher)." };
  const client = new JuicyClient({ cookie: raw });
  client.importCookie(raw);
  const user = await pingUser(client);
  if (!client.cookie.includes("yume_voucher") && !user?.userId) {
    return { ok: false, message: "Cookie did not yield a JuicyChat session." };
  }
  return {
    ok: true,
    message: user?.userName ? `Logged in as @${user.userName}.` : "Session cookie saved.",
    session: pack(client, user, source, email),
  };
}

export async function phoneMe(cookie: string): Promise<PhoneAuthResult> {
  return phoneCookieLogin(cookie, "manual-cookie");
}

export async function phoneQueue(cookie: string): Promise<{
  ok: boolean;
  message?: string;
  session?: PhoneSessionPayload;
  queue: PublishQueue;
  user: JuicyUserInfo | null;
}> {
  const scraped = await scrapeOwnFromCookie(cookie);
  if (!scraped.authenticated || !scraped.user?.userId) {
    const cached = buildQueue([]);
    cached.warnings = scraped.warnings.length
      ? scraped.warnings
      : ["Not logged in — JuicyChat session missing or expired."];
    return {
      ok: false,
      message: cached.warnings[0],
      queue: cached,
      user: null,
    };
  }
  const queue = buildQueue(scraped.bots, new Date().toISOString());
  queue.warnings = scraped.warnings;
  const client = new JuicyClient({ cookie: scraped.cookie });
  return {
    ok: true,
    queue,
    user: scraped.user,
    session: pack(client, scraped.user, "manual-cookie"),
  };
}

export async function phonePublish(
  cookie: string,
  characterIds: string[],
): Promise<{
  ok: boolean;
  results: PublishResult[];
  queue: PublishQueue;
  user: JuicyUserInfo | null;
  session?: PhoneSessionPayload;
}> {
  const ids = characterIds.map(String).filter(Boolean);
  const client = new JuicyClient({ cookie });
  const results: PublishResult[] = [];
  for (const id of ids) {
    try {
      const r = await client.post<unknown>("/yume/api/user/v1/character/userPublishCharacter", {
        characterId: id,
      });
      const ok = Boolean(r.success || r.code === "200");
      results.push({
        characterId: id,
        characterName: id,
        ok,
        message: ok ? "Published" : String(r.msg || r.code || "failed"),
      });
    } catch (e) {
      results.push({
        characterId: id,
        characterName: id,
        ok: false,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }
  const next = await phoneQueue(client.cookie || cookie);
  for (const r of results) {
    const row = next.queue.pending.find((p) => p.characterId === r.characterId);
    if (row) r.characterName = row.characterName;
  }
  return {
    ok: results.every((r) => r.ok),
    results,
    queue: next.queue,
    user: next.user,
    session: next.session,
  };
}