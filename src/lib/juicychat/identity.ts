import { randomBytes } from "node:crypto";
import { getSql } from "@/lib/db";
import { getSessionUser, DEV_USER_ID } from "@/lib/auth/verify.server";
import { authConfigured } from "@/lib/auth/server";
import { withUserStore } from "./user-kv";

export const DEVICE_HEADER = "x-lounge-device";

export async function mintDeviceToken(userId: string): Promise<string> {
  const token = randomBytes(24).toString("base64url");
  const sql = await getSql();
  await sql.query(`insert into lounge_devices (token, user_id) values ($1, $2)`, [token, userId]);
  return token;
}

export async function userIdFromDeviceToken(
  token: string | null | undefined,
): Promise<string | null> {
  const t = String(token || "").trim();
  if (!t) return null;
  try {
    const sql = await getSql();
    const rows = await sql.query<{ user_id: string }>(
      `update lounge_devices set last_seen = now() where token = $1 returning user_id`,
      [t],
    );
    return rows[0]?.user_id || null;
  } catch {
    return null;
  }
}

export async function resolveLoungeUserId(
  request: Request,
  body?: { deviceToken?: string } | null,
): Promise<string | null> {
  let sessionId: string | null = null;
  try {
    const user = await getSessionUser();
    if (user?.id) sessionId = user.id;
  } catch {
    /* no request / cron */
  }
  const header = request.headers.get(DEVICE_HEADER) || request.headers.get("X-Lounge-Device");
  const deviceId =
    (await userIdFromDeviceToken(header)) ||
    (await userIdFromDeviceToken(body?.deviceToken));
  if (sessionId && deviceId && sessionId !== deviceId) {
    const { pickUserWithData } = await import("./user-kv");
    return (await pickUserWithData([sessionId, deviceId])) || sessionId;
  }
  return sessionId || deviceId || (!authConfigured ? DEV_USER_ID : null);
}

export async function requireLoungeUserId(
  request: Request,
  body?: { deviceToken?: string } | null,
): Promise<string> {
  const id = await resolveLoungeUserId(request, body);
  if (!id) {
    const err = new Error("Sign in or pair the Android companion first");
    (err as Error & { status?: number }).status = 401;
    throw err;
  }
  return id;
}

export async function withResolvedUserStore<T>(
  request: Request,
  body: unknown,
  fn: () => Promise<T>,
): Promise<T> {
  const b = body && typeof body === "object" ? (body as { deviceToken?: string }) : null;
  const userId = await requireLoungeUserId(request, b);
  const { hydrateLoungeVault } = await import("./lounge-vault");
  hydrateLoungeVault(request);
  return withUserStore(userId, fn);
}
