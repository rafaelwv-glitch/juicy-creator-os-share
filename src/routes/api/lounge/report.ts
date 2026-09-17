import { createFileRoute } from "@tanstack/react-router";
import { jsonResponse, optionsResponse } from "@/lib/juicychat/http";
import { getSql } from "@/lib/db";
import { withUserStore } from "@/lib/juicychat/user-kv";
import { resolveLoungeUserId } from "@/lib/juicychat/identity";
import { currentLoungeReport } from "@/lib/juicychat/grok-hook";

async function userIdFromPullToken(token: string): Promise<string | null> {
  const t = String(token || "").trim();
  if (!t) return null;
  try {
    const sql = await getSql();
    const rows = await sql.query<{ user_id: string; value: unknown }>(
      `select user_id, value from lounge_user_kv where key = 'grok-hook.json'`,
    );
    for (const row of rows) {
      const v = row.value as { pullToken?: string } | null;
      if (v && v.pullToken === t) return row.user_id;
    }
  } catch {
    /* */
  }
  return null;
}

export const Route = createFileRoute("/api/lounge/report")({
  server: {
    handlers: {
      OPTIONS: async () => optionsResponse(),
      GET: async ({ request }) => {
        try {
          const url = new URL(request.url);
          const pull =
            url.searchParams.get("token") ||
            request.headers.get("x-lounge-report") ||
            "";
          let userId = await userIdFromPullToken(pull);
          if (!userId) userId = await resolveLoungeUserId(request, null);
          if (!userId) {
            return jsonResponse({ ok: false, code: "NO_TOKEN", error: "Missing report or device token" }, 401);
          }
          const report = await withUserStore(userId, async () => currentLoungeReport());
          return jsonResponse({ ok: true, code: "REPORT", report });
        } catch (e) {
          return jsonResponse(
            { ok: false, code: "HTTP_500", error: e instanceof Error ? e.message : String(e) },
            500,
          );
        }
      },
    },
  },
});
