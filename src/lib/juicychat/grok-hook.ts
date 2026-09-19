/**
 * Grok automation delivery without a GitHub PAT in the cloud.
 *
 * Grok inbound webhooks are a signed POST + Bearer. HTTP 401 is almost always
 * (a) the grok.com/automations *page* URL, or (b) missing Authorization.
 */
import { createHmac, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { currentLoungeUserId, dataPath, ensureDataDir } from "./paths";
import { buildLoungeReport } from "./github-report";
import { getCachedOrEmptyDashboard } from "./dashboard";
import { loungeTimezone } from "./timezone-server";

const FILE = "grok-hook.json";

export type GrokHook = {
  url: string;
  secret: string;
  pullToken: string;
  enabled: boolean;
  lastAt?: string | null;
  lastOk?: boolean | null;
  lastStatus?: number | null;
  lastError?: string | null;
};

function empty(): GrokHook {
  return {
    url: "",
    secret: randomBytes(24).toString("base64url"),
    pullToken: randomBytes(24).toString("base64url"),
    enabled: false,
    lastAt: null,
    lastOk: null,
    lastStatus: null,
    lastError: null,
  };
}

export function loadGrokHook(): GrokHook {
  try {
    const p = dataPath(FILE);
    if (!existsSync(p)) return empty();
    const raw = JSON.parse(readFileSync(p, "utf8")) as Partial<GrokHook>;
    return {
      ...empty(),
      ...raw,
      url: String(raw.url || ""),
      secret: String(raw.secret || empty().secret),
      pullToken: String(raw.pullToken || empty().pullToken),
      enabled: Boolean(raw.enabled && raw.url),
    };
  } catch {
    return empty();
  }
}

export function saveGrokHook(h: GrokHook): void {
  ensureDataDir();
  writeFileSync(dataPath(FILE), JSON.stringify(h), "utf8");
  const uid = currentLoungeUserId();
  if (uid) {
    void import("./relational")
      .then((m) => m.upsertGrokHook(uid, h))
      .catch(() => undefined);
  }
}

export function publicHookView(h: GrokHook) {
  return {
    url: h.url,
    enabled: h.enabled && Boolean(h.url),
    pullToken: h.pullToken,
    secretTail: h.secret ? h.secret.slice(-4) : "",
    lastAt: h.lastAt || null,
    lastOk: h.lastOk ?? null,
    lastStatus: h.lastStatus ?? null,
    lastError: h.lastError || null,
  };
}

export function webhookUrlError(url: string): string | null {
  if (!url) return "Paste the webhook URL from grok.com/automations";
  if (!/^https:\/\//i.test(url)) return "Webhook URL must be https://";
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/+$/, "") || "/";
    const grokHost = /(^|\.)(grok\.com|x\.ai)$/i.test(u.hostname);
    if (grokHost && (/^\/automations$/i.test(path) || /^\/automations\/[0-9a-f-]+$/i.test(path))) {
      return "That's the Grok automations page (HTTP 401). Open the advisor and copy the Webhook URL — it contains /webhook/ — not the address bar.";
    }
  } catch {
    return "Invalid URL";
  }
  return null;
}

function hmacKey(secret: string): Buffer | string {
  const s = secret.trim();
  if (s.startsWith("whsec_")) {
    try {
      return Buffer.from(s.slice("whsec_".length), "base64");
    } catch {
      return s;
    }
  }
  return s;
}

export function signBodyHex(secret: string, body: string): string {
  return createHmac("sha256", hmacKey(secret)).update(body).digest("hex");
}

export function currentLoungeReport() {
  const dash = getCachedOrEmptyDashboard();
  return buildLoungeReport({
    snapshot: dash.snapshot,
    growth: dash.growth,
    appVersion: "11.0.0",
    timezone: loungeTimezone(),
  });
}

export function compactLoungeReport() {
  const full = currentLoungeReport() as Record<string, unknown> & {
    unpublished?: { counts?: unknown; bots?: Array<Record<string, unknown>> };
    liveTop?: unknown[];
    kpis?: unknown;
    creator?: unknown;
    generatedAt?: string;
    timezone?: string;
    schema?: string;
    note?: string;
  };
  const bots = Array.isArray(full.unpublished?.bots) ? full.unpublished.bots.slice(0, 30) : [];
  return {
    schema: full.schema || "juicy-lounge-report/v1",
    generatedAt: full.generatedAt,
    timezone: full.timezone || loungeTimezone(),
    appVersion: "11.0.0",
    creator: full.creator || null,
    kpis: full.kpis || null,
    unpublished: {
      counts: full.unpublished?.counts || {},
      bots: bots.map((b) => ({
        characterId: b.characterId,
        name: b.name,
        status: b.status,
        statusLabel: b.statusLabel,
        canPublish: b.canPublish,
        tags: Array.isArray(b.tags) ? b.tags.slice(0, 6) : [],
        genre: b.genre || null,
        topic: typeof b.topic === "string" ? b.topic.slice(0, 160) : null,
      })),
    },
    liveTop: Array.isArray(full.liveTop) ? full.liveTop.slice(0, 8) : [],
    note: full.note || "",
  };
}

function clipErr(text: string, status: number, extra?: string): string {
  const t = [text.replace(/\s+/g, " ").trim(), extra].filter(Boolean).join(" · ").slice(0, 320);
  if (status === 401 && !t) {
    return "HTTP 401 · Grok rejected auth. Use the Webhook URL (path contains /webhook/), paste the signing secret, Save, then test.";
  }
  return t ? `HTTP ${status} · ${t}` : `HTTP ${status}`;
}

function grokHeaders(secret: string, body: string): Record<string, string> {
  const key = hmacKey(secret);
  const hex = createHmac("sha256", key).update(body).digest("hex");
  const ts = Math.floor(Date.now() / 1000).toString();
  const id = `msg_${ts}`;
  const std = createHmac("sha256", key).update(`${id}.${ts}.${body}`).digest("base64");
  return {
    "content-type": "application/json",
    accept: "application/json",
    authorization: `Bearer ${secret.trim()}`,
    "x-api-key": secret.trim(),
    "user-agent": "JuicyLounge-GrokHook/11",
    "x-lounge-event": "lounge.report",
    "x-lounge-signature": `sha256=${hex}`,
    "x-webhook-signature": `sha256=${hex}`,
    "x-hub-signature-256": `sha256=${hex}`,
    "x-grok-signature": `sha256=${hex}`,
    "webhook-id": id,
    "webhook-timestamp": ts,
    "webhook-signature": `v1,${std}`,
  };
}

export async function deliverGrokHook(): Promise<GrokHook> {
  const hook = loadGrokHook();
  if (!hook.enabled || !hook.url) return hook;
  const bad = webhookUrlError(hook.url);
  if (bad) {
    hook.lastAt = new Date().toISOString();
    hook.lastOk = false;
    hook.lastStatus = 401;
    hook.lastError = bad;
    saveGrokHook(hook);
    return hook;
  }
  const report = compactLoungeReport();
  const body = JSON.stringify(report);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(hook.url, {
      method: "POST",
      signal: ctrl.signal,
      redirect: "manual",
      headers: grokHeaders(hook.secret, body),
      body,
    });
    const text = await res.text().catch(() => "");
    const loc = res.headers.get("location");
    const www = res.headers.get("www-authenticate");
    const extra = [www ? `auth=${www}` : "", loc ? `location=${loc}` : ""].filter(Boolean).join(" ");
    hook.lastAt = new Date().toISOString();
    hook.lastOk = res.ok;
    hook.lastStatus = res.status;
    if (res.status >= 300 && res.status < 400) {
      hook.lastOk = false;
      hook.lastError = `HTTP ${res.status} redirect — this is not the webhook endpoint. Copy the Webhook URL from the automation, not the page.`;
    } else {
      hook.lastError = res.ok ? null : clipErr(text, res.status, extra || undefined);
    }
  } catch (e) {
    hook.lastAt = new Date().toISOString();
    hook.lastOk = false;
    hook.lastStatus = 0;
    hook.lastError = e instanceof Error ? e.message : String(e);
  } finally {
    clearTimeout(t);
    saveGrokHook(hook);
    const uid = currentLoungeUserId();
    if (uid) {
      void import("./relational")
        .then((m) => m.logWebhookDelivery(uid, hook))
        .catch(() => undefined);
    }
  }
  return hook;
}

export function rotateSecrets(h: GrokHook, which: "secret" | "pull" | "both"): GrokHook {
  const next = { ...h };
  if (which === "secret" || which === "both") next.secret = randomBytes(24).toString("base64url");
  if (which === "pull" || which === "both") next.pullToken = randomBytes(24).toString("base64url");
  saveGrokHook(next);
  return next;
}
