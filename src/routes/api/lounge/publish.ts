import { createFileRoute } from "@tanstack/react-router";
import { jsonResponse, optionsResponse, readJsonBody } from "@/lib/juicychat/http";
import { withResolvedUserStore } from "@/lib/juicychat/identity";
import { publishCharacters } from "@/lib/juicychat/publish-bots";
import { saveSession, type JuicySession } from "@/lib/juicychat/session";

function isSession(v: unknown): v is JuicySession {
  return Boolean(v && typeof v === "object" && typeof (v as JuicySession).cookie === "string");
}

export const Route = createFileRoute("/api/lounge/publish")({
  server: {
    handlers: {
      OPTIONS: async () => optionsResponse(),
      POST: async ({ request }) => {
        try {
          const body = (await readJsonBody(request)) as {
            characterIds?: string[];
            session?: unknown;
            deviceToken?: string;
          } | null;
          const ids = (body?.characterIds || []).map(String).filter(Boolean);
          if (!ids.length) return jsonResponse({ ok: false, error: "No bots selected." }, 400);
          const result = await withResolvedUserStore(request, body, async () => {
            if (isSession(body?.session)) saveSession(body.session);
            return publishCharacters(ids);
          });
          return jsonResponse({ ok: true, ...result });
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
