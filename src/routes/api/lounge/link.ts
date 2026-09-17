import { createFileRoute } from "@tanstack/react-router";
import { jsonResponse, optionsResponse } from "@/lib/juicychat/http";
import { DEVICE_HEADER, userIdFromDeviceToken } from "@/lib/juicychat/identity";

/**
 * Cheap Android companion ping.
 * Green path: a stored device token still maps to a lounge account.
 * Red path: structured `code` the phone can show next to the status dot.
 */
export const Route = createFileRoute("/api/lounge/link")({
  server: {
    handlers: {
      OPTIONS: async () => optionsResponse(),
      GET: async ({ request }) => {
        try {
          const token =
            request.headers.get(DEVICE_HEADER) ||
            request.headers.get("X-Lounge-Device") ||
            new URL(request.url).searchParams.get("deviceToken") ||
            "";
          if (!String(token).trim()) {
            return jsonResponse(
              {
                ok: false,
                linked: false,
                code: "NO_TOKEN",
                error: "No device token on this phone",
              },
              401,
            );
          }
          const userId = await userIdFromDeviceToken(token);
          if (!userId) {
            return jsonResponse(
              {
                ok: false,
                linked: false,
                code: "UNPAIRED",
                error: "Device token not recognized — pair again",
              },
              401,
            );
          }
          return jsonResponse({ ok: true, linked: true, code: "LINKED", userId });
        } catch (e) {
          return jsonResponse(
            {
              ok: false,
              linked: false,
              code: "HTTP_500",
              error: e instanceof Error ? e.message : String(e),
            },
            500,
          );
        }
      },
    },
  },
});
