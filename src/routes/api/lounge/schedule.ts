import { createFileRoute } from "@tanstack/react-router";
import { jsonResponse, optionsResponse, readJsonBody } from "@/lib/juicychat/http";
import { withResolvedUserStore } from "@/lib/juicychat/identity";
import {
  cancelCloudJob,
  listCloudJobs,
  scheduleCloudJob,
} from "@/lib/juicychat/cloud-publish";
import { saveSession, type JuicySession } from "@/lib/juicychat/session";

function isSession(v: unknown): v is JuicySession {
  return Boolean(v && typeof v === "object" && typeof (v as JuicySession).cookie === "string");
}

export const Route = createFileRoute("/api/lounge/schedule")({
  server: {
    handlers: {
      OPTIONS: async () => optionsResponse(),
      GET: async ({ request }) => {
        try {
          const jobs = await withResolvedUserStore(request, null, () => listCloudJobs());
          return jsonResponse({ ok: true, jobs });
        } catch (e) {
          const status = (e as { status?: number }).status === 401 ? 401 : 500;
          return jsonResponse(
            { ok: false, error: e instanceof Error ? e.message : String(e), jobs: [] },
            status,
          );
        }
      },
      POST: async ({ request }) => {
        try {
          const body = (await readJsonBody(request)) as {
            characterId?: string;
            characterName?: string;
            fireAtMs?: number;
            session?: unknown;
            deviceToken?: string;
          } | null;
          const result = await withResolvedUserStore(request, body, async () => {
            if (isSession(body?.session)) saveSession(body.session);
            return scheduleCloudJob({
              characterId: String(body?.characterId || ""),
              characterName: body?.characterName,
              fireAtMs: Number(body?.fireAtMs || 0),
              session: isSession(body?.session) ? body.session : null,
            });
          });
          return jsonResponse({ ok: true, job: result });
        } catch (e) {
          const status = (e as { status?: number }).status === 401 ? 401 : 400;
          return jsonResponse(
            { ok: false, error: e instanceof Error ? e.message : String(e) },
            status,
          );
        }
      },
      DELETE: async ({ request }) => {
        try {
          const url = new URL(request.url);
          const id = url.searchParams.get("id") || "";
          if (!id) return jsonResponse({ ok: false, error: "Missing id" }, 400);
          const ok = await withResolvedUserStore(request, null, () => cancelCloudJob(id));
          return jsonResponse({ ok });
        } catch (e) {
          const status = (e as { status?: number }).status === 401 ? 401 : 400;
          return jsonResponse(
            { ok: false, error: e instanceof Error ? e.message : String(e) },
            status,
          );
        }
      },
    },
  },
});
