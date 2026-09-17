import { createFileRoute } from "@tanstack/react-router";
import { jsonResponse, optionsResponse } from "@/lib/juicychat/http";
import { DEVICE_HEADER, withResolvedUserStore } from "@/lib/juicychat/identity";
import { getCloudStatus } from "@/lib/juicychat/daily-pull";
import { listCloudJobs } from "@/lib/juicychat/cloud-publish";

export const Route = createFileRoute("/api/lounge/status")({
  server: {
    handlers: {
      OPTIONS: async () => optionsResponse(),
      GET: async ({ request }) => {
        const header =
          request.headers.get(DEVICE_HEADER) || request.headers.get("X-Lounge-Device") || "";
        try {
          const payload = await withResolvedUserStore(request, null, async () => {
            const status = await getCloudStatus();
            const jobs = await listCloudJobs();
            return {
              ...status,
              jobs,
              scheduled: jobs.filter((j) => j.status === "scheduled").length,
            };
          });
          return jsonResponse({ ok: true, linked: true, code: "LINKED", ...payload });
        } catch (e) {
          const status = (e as { status?: number }).status === 401 ? 401 : 500;
          const code =
            status === 401 ? (header.trim() ? "UNPAIRED" : "NO_TOKEN") : `HTTP_${status}`;
          return jsonResponse(
            {
              ok: false,
              linked: false,
              code,
              error: e instanceof Error ? e.message : String(e),
            },
            status,
          );
        }
      },
    },
  },
});
