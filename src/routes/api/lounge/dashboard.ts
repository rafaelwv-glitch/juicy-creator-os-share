import { createFileRoute } from "@tanstack/react-router";
import { jsonResponse, optionsResponse } from "@/lib/juicychat/http";
import { withResolvedUserStore } from "@/lib/juicychat/identity";
import { getCachedOrEmptyDashboard } from "@/lib/juicychat/dashboard";
import { getCloudStatus } from "@/lib/juicychat/daily-pull";
import { listCloudJobs } from "@/lib/juicychat/cloud-publish";
import { loadSession } from "@/lib/juicychat/session";
import { widgetPayload } from "@/lib/juicychat/widget-payload";
import { persistHealth } from "@/lib/juicychat/user-kv";
import { currentLoungeUserId } from "@/lib/juicychat/paths";
import { loadGrokHook, publicHookView } from "@/lib/juicychat/grok-hook";

export const Route = createFileRoute("/api/lounge/dashboard")({
  server: {
    handlers: {
      OPTIONS: async () => optionsResponse(),
      GET: async ({ request }) => {
        try {
          const payload = await withResolvedUserStore(request, null, async () => {
            const dashboard = getCachedOrEmptyDashboard();
            const status = await getCloudStatus();
            const jobs = await listCloudJobs();
            const session = loadSession();
            const persist = await persistHealth(currentLoungeUserId());
            return {
              dashboard,
              widget: widgetPayload(dashboard),
              status: {
                ...status,
                jobs,
                scheduled: jobs.filter((j) => j.status === "scheduled").length,
              },
              hasJuicySession: Boolean(session?.cookie),
              juicyUser: session?.userName || session?.userId || null,
              grok: publicHookView(loadGrokHook()),
              persist,
            };
          });
          return jsonResponse({ ok: true, linked: true, code: "LINKED", ...payload });
        } catch (e) {
          const status = (e as { status?: number }).status === 401 ? 401 : 500;
          return jsonResponse(
            {
              ok: false,
              linked: false,
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
