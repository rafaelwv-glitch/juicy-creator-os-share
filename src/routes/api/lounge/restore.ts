import { createFileRoute } from "@tanstack/react-router";
import { jsonResponse, optionsResponse, readJsonBody } from "@/lib/juicychat/http";
import { withResolvedUserStore } from "@/lib/juicychat/identity";
import { applyBackup } from "@/lib/juicychat/backup";
import { replaceJobsFromBackup } from "@/lib/juicychat/cloud-publish";
import type { JuicySession } from "@/lib/juicychat/session";

function normalizeBackup(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const data = raw as Record<string, unknown>;
  const inner =
    data.backup && typeof data.backup === "object"
      ? (data.backup as Record<string, unknown>)
      : data;
  const session = inner.session as (JuicySession & { loungeUserId?: string }) | null | undefined;
  if (session && !session.userId && session.loungeUserId) {
    session.userId = session.loungeUserId;
  }
  return inner;
}

export const Route = createFileRoute("/api/lounge/restore")({
  server: {
    handlers: {
      OPTIONS: async () => optionsResponse(),
      POST: async ({ request }) => {
        try {
          const raw = await readJsonBody(request);
          const backup = normalizeBackup(raw) as {
            publishJobs?: unknown;
            deviceToken?: string;
          };
          const result = await withResolvedUserStore(request, raw, async () => {
            const applied = applyBackup(backup, { allowCredentials: true });
            const jobs =
              backup?.publishJobs ??
              (backup as { files?: Record<string, unknown> }).files?.["publish-jobs.json"];
            if (Array.isArray(jobs)) {
              await replaceJobsFromBackup(jobs);
            }
            return applied;
          });
          return jsonResponse({ ...result, cloud: true });
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
