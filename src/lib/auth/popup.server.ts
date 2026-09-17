/**
 * Live-preview sign-in popup — server-only (NEVER import from the client).
 *
 * Phase 1 (`?providerId=…`): 302 straight to the broker / Google / X.
 * Phase 2 (`?done=1`): tiny HTML that posts the session token back.
 *
 * The preview iframe is third-party (embedded on grok.com). Popups from that
 * iframe lose `window.opener`, and localStorage/BroadcastChannel are partitioned
 * — so we also stash the token in an in-memory handoff slot the iframe polls.
 */
import { auth, SESSION_TOKEN_COOKIE } from "./server";

type PopupMessage = {
  source: "grok-auth-popup";
  token: string | null;
  error?: string;
};

type HandoffSlot = { token: string | null; error?: string; at: number };

const g = globalThis as typeof globalThis & {
  __jlPopupHandoff__?: Map<string, HandoffSlot>;
};
function handoffSlots(): Map<string, HandoffSlot> {
  g.__jlPopupHandoff__ ??= new Map();
  return g.__jlPopupHandoff__;
}

function sweepHandoff() {
  const now = Date.now();
  for (const [id, slot] of handoffSlots()) {
    if (now - slot.at > 5 * 60_000) handoffSlots().delete(id);
  }
}

export function storePopupHandoff(
  id: string,
  payload: { token: string | null; error?: string },
): void {
  if (!id || id.length < 8 || id.length > 128) return;
  sweepHandoff();
  handoffSlots().set(id, { ...payload, at: Date.now() });
}

export function takePopupHandoff(
  id: string,
): { token: string | null; error?: string } | null {
  sweepHandoff();
  const slot = handoffSlots().get(id);
  if (!slot) return null;
  handoffSlots().delete(id);
  return { token: slot.token, error: slot.error };
}

/** GET/POST `/auth/popup/handoff` — iframe polls this after Google returns. */
export async function handlePopupHandoffRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });

  if (request.method === "GET") {
    const id = url.searchParams.get("id")?.trim() ?? "";
    if (!id) return json({ error: "missing id" }, 400);
    const slot = takePopupHandoff(id);
    if (!slot) return json({ pending: true });
    return json({ pending: false, source: "grok-auth-popup", ...slot });
  }

  if (request.method === "POST") {
    let body: { id?: string; token?: string | null; error?: string } = {};
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return json({ error: "bad json" }, 400);
    }
    const id = String(body.id ?? "").trim();
    if (!id) return json({ error: "missing id" }, 400);
    storePopupHandoff(id, {
      token: body.token ?? null,
      error: body.error,
    });
    return json({ ok: true });
  }

  return json({ error: "method" }, 405);
}

function publicRequestUrl(request: Request): URL {
  const url = new URL(request.url);
  const first = (v: string | null) => (v ?? "").split(",")[0].trim();
  const xfHost = first(request.headers.get("x-forwarded-host"));
  const hostHeader = first(request.headers.get("host"));
  const host = xfHost || hostHeader || url.host;
  const hostName = host.replace(/:\d+$/, "").replace(/^\[(.*)\]$/, "$1");
  const xfProto = first(request.headers.get("x-forwarded-proto")).toLowerCase();
  const proto =
    xfProto === "https" || xfProto === "http"
      ? xfProto
      : hostName.endsWith(".grok-sandbox.com") ||
          hostName.endsWith(".grok.me") ||
          hostName.endsWith(".vercel.app")
        ? "https"
        : url.protocol.replace(":", "") || "http";
  return new URL(`${proto}://${host}${url.pathname}${url.search}`);
}

function oauthFwdHeaders(request: Request, url: URL): Headers {
  const fwdHeaders = new Headers(request.headers);
  fwdHeaders.set("host", url.host);
  fwdHeaders.set("x-forwarded-host", url.host);
  fwdHeaders.set("x-forwarded-proto", url.protocol.replace(":", ""));
  fwdHeaders.set("origin", url.origin);
  fwdHeaders.set("content-type", "application/json");
  return fwdHeaders;
}

async function startOAuthSignIn(
  request: Request,
  url: URL,
  providerId: string,
  callbackURL: string,
  errorCallbackURL: string,
): Promise<Response> {
  const body = { providerId, callbackURL, errorCallbackURL };
  const headers = oauthFwdHeaders(request, url);
  const api = auth.api as Record<string, unknown>;
  const fn = api.signInWithOAuth2;
  if (typeof fn === "function") {
    return (fn as (opts: unknown) => Promise<Response>)({
      body,
      headers,
      asResponse: true,
    });
  }
  return auth.handler(
    new Request(`${url.origin}/api/auth/sign-in/oauth2`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }),
  );
}

export async function handleAuthPopupRequest(request: Request): Promise<Response> {
  const url = publicRequestUrl(request);
  const done = url.searchParams.get("done") === "1";
  const handoff = url.searchParams.get("handoff")?.trim() ?? "";

  if (done) {
    const errored = url.searchParams.has("error");
    const token = errored ? null : readCookie(request, SESSION_TOKEN_COOKIE);
    const message: PopupMessage = {
      source: "grok-auth-popup",
      token,
      ...(errored
        ? { error: url.searchParams.get("error") || "Google / X returned an error" }
        : !token
          ? { error: "Signed in, but the session cookie was missing. Try email below." }
          : {}),
    };
    if (handoff) {
      storePopupHandoff(handoff, { token: message.token, error: message.error });
    }
    return new Response(completionHtml(message, handoff), {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  }

  const providerId = url.searchParams.get("providerId")?.trim();
  if (!providerId) {
    return new Response("Missing providerId", {
      status: 400,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  const handoffQs = handoff ? `&handoff=${encodeURIComponent(handoff)}` : "";
  const back = `${url.origin}/auth/popup?done=1${handoffQs}`;
  const errorBack = `${url.origin}/auth/popup?done=1&error=1${handoffQs}`;
  try {
    const apiRes = await startOAuthSignIn(request, url, providerId, back, errorBack);

    if (!apiRes.ok) {
      const detail = await apiRes.text().catch(() => "");
      const message: PopupMessage = {
        source: "grok-auth-popup",
        token: null,
        error: detail || `oauth_init_failed_${apiRes.status}`,
      };
      if (handoff) storePopupHandoff(handoff, { token: null, error: message.error });
      return completionResponse(message, handoff);
    }

    const body = (await apiRes.json().catch(() => null)) as { url?: string } | null;
    const location = body?.url || apiRes.headers.get("location");
    if (!location) {
      const message: PopupMessage = {
        source: "grok-auth-popup",
        token: null,
        error: "oauth_init_missing_url",
      };
      if (handoff) storePopupHandoff(handoff, { token: null, error: message.error });
      return completionResponse(message, handoff);
    }

    const headers = new Headers({ location, "cache-control": "no-store" });
    for (const cookie of apiRes.headers.getSetCookie()) {
      headers.append("set-cookie", cookie);
    }
    return new Response(null, { status: 302, headers });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : "oauth_init_threw";
    if (handoff) storePopupHandoff(handoff, { token: null, error: errMsg });
    return completionResponse({
      source: "grok-auth-popup",
      token: null,
      error: errMsg,
    }, handoff);
  }
}

function completionResponse(message: PopupMessage, handoff: string): Response {
  return new Response(completionHtml(message, handoff), {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function completionHtml(message: PopupMessage, handoff: string): string {
  const payload = JSON.stringify(message).replace(/</g, "\\u003c");
  const handoffJson = JSON.stringify(handoff);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Signing in…</title>
<style>
  html,body{margin:0;min-height:100%;background:#0b0b0c;color:#a1a1aa;
    font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
  main{min-height:100vh;display:grid;place-items:center;padding:1.5rem;text-align:center}
</style>
</head>
<body>
<main><p>Signing you in… you can close this window.</p></main>
<script type="application/json" id="grok-auth-popup-msg">${payload}</script>
<script>
(function () {
  var el = document.getElementById("grok-auth-popup-msg");
  var msg = { source: "grok-auth-popup", token: null };
  try { if (el && el.textContent) msg = JSON.parse(el.textContent); } catch (e) {}
  var handoff = ${handoffJson};
  try {
    if (handoff) {
      fetch("/auth/popup/handoff", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: handoff, token: msg.token, error: msg.error }),
        keepalive: true
      }).catch(function () {});
    }
  } catch (e) {}
  try { localStorage.setItem("grok-auth-popup-result", JSON.stringify(msg)); } catch (e) {}
  try {
    var bc = new BroadcastChannel("grok-auth-popup");
    bc.postMessage(msg);
    setTimeout(function () { try { bc.close(); } catch (e) {} }, 200);
  } catch (e) {}
  try {
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage(msg, window.location.origin);
    }
  } catch (e) {}
  setTimeout(function () { try { window.close(); } catch (e) {} }, 800);
})();
</script>
</body>
</html>`;
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    if (trimmed.slice(0, eq) !== name) continue;
    const raw = trimmed.slice(eq + 1);
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return null;
}
