import { useCallback, useEffect, useState } from "react";
import { Copy, Loader2, RefreshCw, Webhook } from "lucide-react";

type HookView = {
  url: string;
  enabled: boolean;
  pullToken: string;
  secretTail: string;
  lastAt: string | null;
  lastOk: boolean | null;
  lastStatus: number | null;
  lastError: string | null;
};

export function GrokHookPanel({ className = "" }: { className?: string }) {
  const [hook, setHook] = useState<HookView | null>(null);
  const [url, setUrl] = useState("");
  const [signingSecret, setSigningSecret] = useState("");
  const [secret, setSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [ok, setOk] = useState<boolean | null>(null);

  const origin = typeof window !== "undefined" ? window.location.origin : "";

  const apply = (h: HookView, nextSecret?: string) => {
    setHook(h);
    setUrl(h.url || "");
    if (nextSecret) setSecret(nextSecret);
  };

  const reload = useCallback(async () => {
    const res = await fetch("/api/lounge/hook", { credentials: "include" });
    const data = (await res.json()) as { hook?: HookView; error?: string };
    if (!res.ok || !data.hook) throw new Error(data.error || "Could not load Grok hook");
    apply(data.hook);
  }, []);

  useEffect(() => {
    void reload().catch((e) => {
      setMsg(e instanceof Error ? e.message : String(e));
      setOk(false);
    });
  }, [reload]);

  const post = async (body: Record<string, unknown>, label: string) => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/lounge/hook", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        hook?: HookView;
        secret?: string;
        error?: string;
      };
      if (!res.ok || !data.ok || !data.hook) throw new Error(data.error || label);
      apply(data.hook, data.secret);
      const fail = data.hook.lastError && body.test ? data.hook.lastError : null;
      setMsg(fail || label);
      setOk(!fail);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
      setOk(false);
    } finally {
      setBusy(false);
    }
  };

  const pullUrl = hook?.pullToken ? `${origin}/api/lounge/report?token=${hook.pullToken}` : "";

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setMsg(label);
      setOk(true);
    } catch {
      setMsg("Could not copy");
      setOk(false);
    }
  };

  return (
    <section className={`rounded-xl border border-border bg-surface/80 p-4 sm:p-5 ${className}`}>
      <div className="mb-2 flex items-center gap-2">
        <Webhook className="size-4 text-primary" />
        <h2 className="text-sm font-semibold">Grok automation</h2>
      </div>
      <p className="mb-3 text-xs text-muted">
        Paste the <strong>Webhook URL</strong> from the advisor (the path contains{" "}
        <code>/webhook/</code>), plus the signing secret. The browser address{" "}
        <code>grok.com/automations/…</code> is the page — that returns HTTP 401.
      </p>

      <label className="text-[11px] text-muted">Grok webhook URL (https)</label>
      <input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="https://grok.com/…/webhook/…"
        className="mt-1 h-10 w-full rounded-xl border border-border bg-bg px-3 text-sm"
      />
      <label className="mt-2 block text-[11px] text-muted">Grok signing secret</label>
      <input
        value={signingSecret}
        onChange={(e) => setSigningSecret(e.target.value)}
        placeholder="Paste the secret shown next to the webhook URL"
        className="mt-1 h-10 w-full rounded-xl border border-border bg-bg px-3 font-mono text-sm"
      />
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void post(
              { url, enabled: Boolean(url), ...(signingSecret.trim() ? { secret: signingSecret.trim() } : {}) },
              "Webhook saved",
            )
          }
          className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-fg disabled:opacity-60"
        >
          {busy ? <Loader2 className="size-3 animate-spin" /> : null}
          Save webhook
        </button>
        <button
          type="button"
          disabled={busy || !hook?.url}
          onClick={() => void post({ test: true }, "Test ping sent")}
          className="inline-flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-xs font-semibold disabled:opacity-60"
        >
          Send test
        </button>
      </div>

      {secret ? (
        <p className="mt-2 break-all rounded-lg border border-warning/30 bg-warning/10 px-2 py-1.5 font-mono text-[11px] text-warning">
          Signing with: {secret}
        </p>
      ) : (
        <p className="mt-2 text-[11px] text-faint">HMAC tail ···{hook?.secretTail || "????"}</p>
      )}

      <div className="mt-4 rounded-lg border border-border bg-bg/40 p-3">
        <div className="mb-1 text-[10px] uppercase tracking-wide text-faint">Pull URL fallback</div>
        <p className="mb-2 break-all font-mono text-[11px] text-muted">{pullUrl || "Saving a webhook mints this too."}</p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!pullUrl}
            onClick={() => pullUrl && void copy(pullUrl, "Pull URL copied")}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-[11px] font-semibold"
          >
            <Copy className="size-3" /> Copy pull URL
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void post({ rotatePullToken: true }, "Pull token rotated")}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-[11px] font-semibold"
          >
            <RefreshCw className="size-3" /> Rotate token
          </button>
        </div>
      </div>

      {hook?.lastAt ? (
        <p className={`mt-2 text-[11px] ${hook.lastOk ? "text-success" : "text-danger"}`}>
          Last delivery {hook.lastAt}
          {hook.lastStatus != null ? ` · HTTP ${hook.lastStatus}` : ""}
          {hook.lastError ? ` · ${hook.lastError}` : ""}
        </p>
      ) : (
        <p className="mt-2 text-[11px] text-faint">No delivery yet — save URL + Grok secret, then Send test.</p>
      )}
      {msg ? <p className={`mt-1 text-xs ${ok ? "text-success" : "text-danger"}`}>{msg}</p> : null}
    </section>
  );
}
