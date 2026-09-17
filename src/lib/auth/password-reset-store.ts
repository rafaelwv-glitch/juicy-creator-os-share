import { getSql } from "@/lib/db";

export type PendingReset = {
  email: string;
  userId: string;
  token: string;
  url: string;
  createdAt: string;
};

function keyFor(email: string) {
  return `auth-reset:${email.trim().toLowerCase()}`;
}

export function appResetUrl(token: string): string {
  const origin = (
    process.env.BETTER_AUTH_URL?.trim() ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL.replace(/^https?:\/\//, "")}`
      : "") ||
    "https://juicy-creator-os.vercel.app"
  ).replace(/\/+$/, "");
  return `${origin}/reset-password?token=${encodeURIComponent(token)}`;
}

export async function savePendingReset(row: PendingReset): Promise<void> {
  try {
    const sql = await getSql();
    await sql.query(
      `insert into lounge_kv (key, value, updated_at)
       values ($1, $2::jsonb, now())
       on conflict (key) do update set value = excluded.value, updated_at = now()`,
      [keyFor(row.email), JSON.stringify(row)],
    );
  } catch (e) {
    console.warn("[auth] save pending reset failed", e);
  }
}

export async function loadPendingReset(email: string): Promise<PendingReset | null> {
  try {
    const sql = await getSql();
    const rows = await sql.query<{ value: PendingReset }>(
      "select value from lounge_kv where key = $1",
      [keyFor(email)],
    );
    return rows[0]?.value || null;
  } catch {
    return null;
  }
}

export async function clearPendingReset(email: string): Promise<void> {
  try {
    const sql = await getSql();
    await sql.query("delete from lounge_kv where key = $1", [keyFor(email)]);
  } catch {
    /* */
  }
}

export async function maybeSendResetEmail(email: string, url: string): Promise<boolean> {
  const key = process.env.RESEND_API_KEY?.trim();
  const from = process.env.RESEND_FROM?.trim() || "Juicy Lounge <noreply@juicy-creator-os.vercel.app>";
  if (!key) return false;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [email],
        subject: "Reset your Juicy Lounge password",
        text: `Open this link to set a new password (1 hour):\n\n${url}\n`,
      }),
    });
    if (!res.ok) {
      console.warn("[auth] resend failed", res.status, await res.text().catch(() => ""));
      return false;
    }
    return true;
  } catch (e) {
    console.warn("[auth] resend error", e);
    return false;
  }
}
