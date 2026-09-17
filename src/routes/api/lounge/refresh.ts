import { createFileRoute } from "@tanstack/react-router";
import { jsonResponse, optionsResponse, readJsonBody } from "@/lib/juicychat/http";
import { withResolvedUserStore } from "@/lib/juicychat/identity";
import { runDailyPull } from "@/lib/juicychat/daily-pull";
import { getCachedOrEmptyDashboard } from "@/lib/juicychat/dashboard";
import { widgetPayload } from "@/lib/juicychat/widget-payload";
import { loadSession } from "@/lib/juicychat/session";
import { persistHealth } from "@/lib/juicychat/user-kv";
import { currentLoungeUserId } from "@/lib/juicychat/paths";

export const maxDuration = 60;

export const Route = createFileRoute("/api/lounge/refresh")({
  server: {
    handlers: {
      OPTIONS: async () => optionsResponse(),
      POST: async ({ request }) => {
        try {
          const body = await readJsonBody(request);
          const payload = await withResolvedUserStore(request, body, async () => {
            const session = loadSession();
            if (!session?.cookie && !session?.userId) {
              return {
                ok: false,
                code: "NO_SOURCE",
                message: "Connect JuicyChat once on the Vercel dashboard. The phone never logs in there.",
              };
            }
            const res = await runDailyPull("manual");
            const dashboard = getCachedOrEmptyDashboard();
            const persist = await persistHealth(currentLoungeUserId());
            return {
              ok: res.ok,
              code: res.ok ? "PULLED" : "PULL_FAIL",
              message: res.message,
              details: res.details,
              dashboard,
              persist,
              widget: widgetPayload(dashboard),
            };
          });
          return jsonResponse(payload, payload.ok === false && payload.code === "NO_SOURCE" ? 409 : 200);
        } catch (e) {
          const status = (e as { status?: number }).status === 401 ? 401 : 500;
          return jsonResponse(
            {
              ok: false,
              code: status === 401 ? "UNPAIRED" : `HTTP_${status}`,
              error: e instanceof Error ? e.message : String(e),
            },
            status,
          );
        }
      },
    },
  },
});
