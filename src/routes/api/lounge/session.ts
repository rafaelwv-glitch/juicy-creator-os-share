import { createFileRoute } from "@tanstack/react-router";
import { jsonResponse, optionsResponse, readJsonBody } from "@/lib/juicychat/http";
import { withResolvedUserStore } from "@/lib/juicychat/identity";
import { saveSession, type JuicySession } from "@/lib/juicychat/session";

function isSession(v: unknown): v is JuicySession {
  return Boolean(v && typeof v === "object" && typeof (v as JuicySession).cookie === "string");
}

export const Route = createFileRoute("/api/lounge/session")({
  server: {
    handlers: {
      OPTIONS: async () => optionsResponse(),
      POST: async ({ request }) => {
        try {
          const body = (await readJsonBody(request)) as {
            session?: unknown;
            deviceToken?: string;
          } | null;
          const session = isSession(body?.session)
            ? body!.session
            : isSession(body)
              ? (body as JuicySession)
              : null;
          if (!session) return jsonResponse({ ok: false, error: "Missing session cookie" }, 400);
          await withResolvedUserStore(request, body, async () => {
            saveSession({
              ...session,
              source: session.source || "android",
              loggedInAt: session.loggedInAt || new Date().toISOString(),
            });
          });
          return jsonResponse({
            ok: true,
            userId: session.userId || null,
            userName: session.userName || null,
          });
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
