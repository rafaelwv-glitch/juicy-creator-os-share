import { createFileRoute } from "@tanstack/react-router";
import { jsonResponse, optionsResponse, readJsonBody } from "@/lib/juicychat/http";
import {
  phoneCookieLogin,
  phoneMagicRedeem,
  phoneMagicSend,
  phoneMe,
  phonePasswordLogin,
} from "@/lib/juicychat/phone-auth";

type Body = {
  action?: string;
  userNo?: string;
  password?: string;
  email?: string;
  link?: string;
  cookie?: string;
  cfToken?: string;
};

function cookieFrom(request: Request, body: Body | null): string {
  const header = request.headers.get("x-jl-cookie") || "";
  return (body?.cookie || header || "").trim();
}

export const Route = createFileRoute("/api/phone/session")({
  server: {
    handlers: {
      OPTIONS: async () => optionsResponse(),
      POST: async ({ request }) => {
        try {
          const body = (await readJsonBody(request)) as Body | null;
          const action = (body?.action || "me").trim();
          if (action === "password") {
            const r = await phonePasswordLogin(
              body?.userNo || "",
              body?.password || "",
              body?.email,
            );
            return jsonResponse(r, r.ok ? 200 : 400);
          }
          if (action === "magic-send") {
            const r = await phoneMagicSend(body?.email || "", body?.cfToken);
            return jsonResponse(r, r.ok ? 200 : 400);
          }
          if (action === "magic-redeem") {
            const r = await phoneMagicRedeem(body?.link || "", body?.email);
            return jsonResponse(r, r.ok ? 200 : 400);
          }
          if (action === "cookie" || action === "google-cookie") {
            const r = await phoneCookieLogin(
              cookieFrom(request, body),
              action === "google-cookie" ? "google" : "manual-cookie",
              body?.email,
            );
            return jsonResponse(r, r.ok ? 200 : 400);
          }
          if (action === "me") {
            const cookie = cookieFrom(request, body);
            if (!cookie) return jsonResponse({ ok: false, message: "No session cookie." }, 401);
            const r = await phoneMe(cookie);
            return jsonResponse(r, r.ok ? 200 : 401);
          }
          return jsonResponse({ ok: false, message: `Unknown action: ${action}` }, 400);
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