import { createFileRoute } from "@tanstack/react-router";
import { jsonResponse, optionsResponse, readJsonBody } from "@/lib/juicychat/http";
import { withResolvedUserStore } from "@/lib/juicychat/identity";
import {
  deliverGrokHook,
  loadGrokHook,
  publicHookView,
  rotateSecrets,
  saveGrokHook,
  webhookUrlError,
} from "@/lib/juicychat/grok-hook";

export const Route = createFileRoute("/api/lounge/hook")({
  server: {
    handlers: {
      OPTIONS: async () => optionsResponse(),
      GET: async ({ request }) => {
        try {
          const view = await withResolvedUserStore(request, null, async () => publicHookView(loadGrokHook()));
          return jsonResponse({ ok: true, hook: view });
        } catch (e) {
          const status = (e as { status?: number }).status === 401 ? 401 : 500;
          return jsonResponse(
            { ok: false, error: e instanceof Error ? e.message : String(e) },
            status,
          );
        }
      },
      POST: async ({ request }) => {
        try {
          const body = (await readJsonBody(request)) as {
            url?: string;
            enabled?: boolean;
            secret?: string;
            rotateSecret?: boolean;
            rotatePullToken?: boolean;
            test?: boolean;
          } | null;
          const payload = await withResolvedUserStore(request, body, async () => {
            let hook = loadGrokHook();
            if (typeof body?.url === "string") {
              const url = body.url.trim();
              const bad = webhookUrlError(url);
              if (url && bad) return { ok: false as const, error: bad };
              hook.url = url;
            }
            if (typeof body?.secret === "string" && body.secret.trim()) {
              hook.secret = body.secret.trim();
            }
            if (typeof body?.enabled === "boolean") hook.enabled = body.enabled && Boolean(hook.url);
            saveGrokHook(hook);
            if (body?.rotateSecret) hook = rotateSecrets(hook, "secret");
            if (body?.rotatePullToken) hook = rotateSecrets(hook, "pull");
            if (body?.test) hook = await deliverGrokHook();
            return {
              ok: true as const,
              hook: publicHookView(hook),
              secret: body?.rotateSecret || body?.secret ? hook.secret : undefined,
              pullToken: hook.pullToken,
            };
          });
          return jsonResponse(payload, payload.ok ? 200 : 400);
        } catch (e) {
          const status = (e as { status?: number }).status === 401 ? 401 : 500;
          return jsonResponse(
            { ok: false, error: e instanceof Error ? e.message : String(e) },
            status,
          );
        }
      },
    },
  },
});
