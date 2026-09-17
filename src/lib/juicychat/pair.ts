import { randomBytes } from "node:crypto";
import { getSql } from "@/lib/db";
import { mintDeviceToken } from "./identity";

function mintCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(8);
  let out = "";
  for (let i = 0; i < 8; i++) out += alphabet[bytes[i]! % alphabet.length];
  return `${out.slice(0, 4)}-${out.slice(4)}`;
}

export async function createPairCode(userId: string): Promise<{ code: string; expiresAt: string }> {
  const sql = await getSql();
  const code = mintCode();
  const expires = new Date(Date.now() + 15 * 60 * 1000);
  await sql.query(
    `insert into lounge_pair_codes (code, user_id, expires_at) values ($1, $2, $3)`,
    [code, userId, expires.toISOString()],
  );
  return { code, expiresAt: expires.toISOString() };
}

export async function redeemPairCode(
  code: string,
): Promise<{ userId: string; deviceToken: string } | null> {
  const sql = await getSql();
  const normalized = String(code || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/[^A-Z0-9]/g, "");
  const dashed =
    normalized.length === 8 ? `${normalized.slice(0, 4)}-${normalized.slice(4)}` : String(code || "").trim().toUpperCase();
  const rows = await sql.query<{ user_id: string }>(
    `update lounge_pair_codes
     set used_at = now()
     where used_at is null and expires_at > now()
       and (code = $1 or replace(code, '-', '') = $2)
     returning user_id`,
    [dashed, normalized],
  );
  const userId = rows[0]?.user_id;
  if (!userId) return null;
  const deviceToken = await mintDeviceToken(userId);
  return { userId, deviceToken };
}

export async function latestPairCode(
  userId: string,
): Promise<{ code: string; expiresAt: string } | null> {
  const sql = await getSql();
  const rows = await sql.query<{ code: string; expires_at: string | Date }>(
    `select code, expires_at from lounge_pair_codes
     where user_id = $1 and used_at is null and expires_at > now()
     order by created_at desc limit 1`,
    [userId],
  );
  const r = rows[0];
  if (!r) return null;
  return { code: r.code, expiresAt: new Date(r.expires_at).toISOString() };
}
