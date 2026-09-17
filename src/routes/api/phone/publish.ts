import { createFileRoute } from "@tanstack/react-router";
import { jsonResponse, optionsResponse, readJsonBody } from "@/lib/juicychat/http";
import { phonePublish } from "@/lib/juicychat/phone-auth";

type Body = { cookie?: string; characterIds?: string[] };

export const Route = createFileRoute("/api/phone/publish")({
  server: {
    handlers: {
      OPTIONS: async () => optionsResponse(),
      POST: async ({ request }) => {
        try {
          const body = (await readJsonBody(request)) as Body | null;
          const cookie = (body?.cookie || request.headers.get("x-jl-cookie") || "").trim();
          const ids = (body?.characterIds || []).map(String).filter(Boolean);
          if (!cookie) return jsonResponse({ ok: false, message: "No JuicyChat cookie." }, 401);
          if (!ids.length) return jsonResponse({ ok: false, message: "No bots selected." }, 400);
          const r = await phonePublish(cookie, ids);
          return jsonResponse(r);
        } catch (e) {
          return jsonResponse(
            { ok: false, message: e instanceof Error ? e.message : String(e) },
            500,
          );
        }
      },
    },
  },
});