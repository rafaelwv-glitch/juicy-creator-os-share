import { createFileRoute } from "@tanstack/react-router";
import { jsonResponse, optionsResponse, readJsonBody } from "@/lib/juicychat/http";
import { phoneQueue } from "@/lib/juicychat/phone-auth";

type Body = { cookie?: string };

export const Route = createFileRoute("/api/phone/queue")({
  server: {
    handlers: {
      OPTIONS: async () => optionsResponse(),
      POST: async ({ request }) => {
        try {
          const body = (await readJsonBody(request)) as Body | null;
          const cookie = (body?.cookie || request.headers.get("x-jl-cookie") || "").trim();
          if (!cookie) return jsonResponse({ ok: false, message: "No JuicyChat cookie." }, 401);
          const r = await phoneQueue(cookie);
          return jsonResponse(r, r.ok ? 200 : 401);
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