import { createFileRoute } from "@tanstack/react-router";
import { jsonResponse, optionsResponse, readJsonBody } from "@/lib/juicychat/http";
import { getSessionUser } from "@/lib/auth/verify.server";
import { createPairCode, latestPairCode, redeemPairCode } from "@/lib/juicychat/pair";
import { saveSession, type JuicySession } from "@/lib/juicychat/session";
import { withUserStore } from "@/lib/juicychat/user-kv";

function isSession(v: unknown): v is JuicySession {
  return Boolean(v && typeof v === "object" && typeof (v as JuicySession).cookie === "string");
}

export const Route = createFileRoute("/api/lounge/pair")({
  server: {
    handlers: {
      OPTIONS: async () => optionsResponse(),
      GET: async () => {
        const user = await getSessionUser();
        if (!user) return jsonResponse({ ok: false, code: "SIGN_IN", error: "Sign in first" }, 401);
        const current = await latestPairCode(user.id);
        return jsonResponse({ ok: true, userId: user.id, email: user.email, pair: current });
      },
      POST: async ({ request }) => {
        try {
          const body = (await readJsonBody(request)) as {
            action?: string;
            code?: string;
            session?: unknown;
          } | null;
          const action = body?.action || "mint";

          if (action === "redeem") {
            const redeemed = await redeemPairCode(String(body?.code || ""));
            if (!redeemed) return jsonResponse({ ok: false, code: "INVALID_CODE", error: "Invalid or expired pairing code" }, 400);
            if (isSession(body?.session)) {
              const jcSession = body.session;
              await withUserStore(redeemed.userId, async () => {
                saveSession({
                  ...jcSession,
                  source: "android",
                  loggedInAt: new Date().toISOString(),
                });
              });
            }
            return jsonResponse({
              ok: true,
              linked: true,
              code: "LINKED",
              userId: redeemed.userId,
              deviceToken: redeemed.deviceToken,
            });
          }

          const user = await getSessionUser();
          if (!user) return jsonResponse({ ok: false, code: "SIGN_IN", error: "Sign in first" }, 401);
          const pair = await createPairCode(user.id);
          return jsonResponse({ ok: true, pair, userId: user.id });
        } catch (e) {
          return jsonResponse(
            { ok: false, error: e instanceof Error ? e.message : String(e) },
            400,
          );
        }
      },
    },
  },
});
