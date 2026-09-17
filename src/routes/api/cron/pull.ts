import { createFileRoute } from "@tanstack/react-router";
import { assertCronOrPreview, jsonResponse, optionsResponse } from "@/lib/juicychat/http";
import { runDailyPullAllAccounts } from "@/lib/juicychat/daily-pull";

export const maxDuration = 60;

async function handle(request: Request) {
  try {
    assertCronOrPreview(request);
  } catch (e) {
    return jsonResponse({ ok: false, error: e instanceof Error ? e.message : "Unauthorized" }, 401);
  }
  const result = await runDailyPullAllAccounts("pull");
  return jsonResponse(result, result.ok ? 200 : 500);
}

export const Route = createFileRoute("/api/cron/pull")({
  server: {
    handlers: {
      OPTIONS: async () => optionsResponse(),
      GET: async ({ request }) => handle(request),
      POST: async ({ request }) => handle(request),
    },
  },
});
