/** Shared JSON / CORS helpers for Android ↔ Vercel lounge APIs. */
import { loungeVaultSetCookies } from "./lounge-vault";

export const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
  "access-control-allow-headers":
    "content-type, authorization, x-lounge-token, x-jl-cookie, x-cron-secret, x-lounge-device, x-lounge-report, x-lounge-browser",
  "access-control-max-age": "86400",
};

export function jsonResponse(body: unknown, status = 200): Response {
  const headers = new Headers({
    "content-type": "application/json; charset=utf-8",
    ...CORS_HEADERS,
  });
  for (const c of loungeVaultSetCookies()) headers.append("set-cookie", c);
  return new Response(JSON.stringify(body), { status, headers });
}

export function optionsResponse(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export function assertCronOrPreview(request: Request): void {
  const secret =
    process.env.CRON_SECRET?.trim() || process.env.LOUNGE_CRON_SECRET?.trim() || "";
  const auth = request.headers.get("authorization") || "";
  const header = request.headers.get("x-cron-secret") || "";
  const ua = (request.headers.get("user-agent") || "").toLowerCase();
  if (secret && (auth === `Bearer ${secret}` || header === secret)) return;
  if (ua.includes("vercel-cron")) return;
  if (ua.includes("juicylounge-cron")) return;
  // Preview / local: allow so the dashboard can trigger a pull.
  if (!process.env.VERCEL) return;
  // Deployed without CRON_SECRET: accept so GitHub Actions + dashboard still work.
  if (!secret) return;
  const err = new Error("Unauthorized cron");
  (err as Error & { status?: number }).status = 401;
  throw err;
}

export async function readJsonBody(request: Request): Promise<unknown> {
  const text = await request.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("Invalid JSON body");
  }
}
