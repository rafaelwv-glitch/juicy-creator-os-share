import { useCallback, useEffect, useState } from "react";
import { Cloud, Loader2, RefreshCw, Smartphone } from "lucide-react";
import { getCloudLoungeStatus } from "@/lib/juicychat/actions";
import { postCloudRefresh } from "@/lib/juicychat/cloud-refresh";
import { formatWhen } from "@/lib/juicychat/format";
import { getBrowserStoreId, withBrowserHeaders } from "@/lib/juicychat/browser-store";

type Status = Awaited<ReturnType<typeof getCloudLoungeStatus>>;

export function CloudSyncPanel({ className = "" }: { className?: string }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [ok, setOk] = useState<boolean | null>(null);
  const [pair, setPair] = useState<{ code: string; expiresAt: string } | null>(null);
  const [pairBusy, setPairBusy] = useState(false);

  const reload = useCallback(async () => {
    const s = (await getCloudLoungeStatus()) as Status;
    setStatus(s);
    return s;
  }, []);

  useEffect(() => {
    void reload().catch((e) => {
      setMsg(e instanceof Error ? e.message : String(e));
      setOk(false);
    });
    void fetch("/api/lounge/pair", {
      credentials: "include",
      headers: withBrowserHeaders(),
    })
      .then((r) => r.json())
      .then((d) => {
        if (d?.pair) setPair(d.pair);
      })
      .catch(() => undefined);
  }, [reload]);

  const onPull = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await postCloudRefresh();
      setMsg(res.message);
      setOk(res.ok);
      await reload();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
      setOk(false);
    } finally {
      setBusy(false);
    }
  };

  const onPair = async () => {
    setPairBusy(true);
    try {
      const res = await fetch("/api/lounge/pair", {
        method: "POST",
        credentials: "include",
        headers: withBrowserHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ action: "mint", browserStoreId: getBrowserStoreId() }),
      });
      const data = (await res.json()) as { pair?: { code: string; expiresAt: string }; error?: string };
      if (!res.ok || !data.pair) throw new Error(data.error || "Could not mint pairing code");
      setPair(data.pair);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
      setOk(false);
    } finally {
      setPairBusy(false);
    }
  };

  const jobs = (status?.jobs || []) as Array<{ status: string }>;
  const scheduled = jobs.filter((j) => j.status === "scheduled");

  return (
    <section className={`rounded-xl border border-primary/30 bg-primary/5 p-4 sm:p-5 ${className}`}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Cloud className="size-4 text-primary" />
          <h2 className="text-sm font-semibold">Cloud lounge</h2>
        </div>
        <span className="text-[11px] text-muted">
          Europe/Madrid · {(status?.pullTimes || []).join(" · ") || "schedule on Config"}
        </span>
      </div>
      <p className="mb-3 text-xs text-muted">
        The phone is a remote. Scrapes, publishes, and Grok reports run here.
      </p>
      <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <div className={`rounded-lg border px-3 py-2 ${
          status?.lastPull?.ok === true
            ? "border-success/30 bg-success/10"
            : status?.lastPull?.ok === false
              ? "border-danger/30 bg-danger/10"
              : "border-border bg-bg/40"
        }`}>
          <div className="text-[10px] uppercase tracking-wide text-faint">Last pull</div>
          <div className={`mt-0.5 text-sm font-semibold ${
            status?.lastPull?.ok === true ? "text-success" : status?.lastPull?.ok === false ? "text-danger" : ""
          }`}>
            {status?.lastPull?.ok === true
              ? "Success"
              : status?.lastPull?.ok === false
                ? "Failed"
                : status?.lastPull
                  ? "Running"
                  : "Not yet"}
            {status?.lastPull?.finishedAt || status?.lastPull?.startedAt
              ? ` · ${formatWhen(status.lastPull.finishedAt || status.lastPull.startedAt)}`
              : ""}
          </div>
          <div className="text-[11px] text-muted">{status?.lastPull?.message || "Waiting"}</div>
        </div>
        <div className="rounded-lg border border-border bg-bg/40 px-3 py-2">
          <div className="text-[10px] uppercase tracking-wide text-faint">Next pulls</div>
          <div className="mt-0.5 text-sm font-semibold">
            {(status?.nextPulls || []).slice(0, 2).map((iso, i) => (
              <div key={iso || i}>{formatWhen(iso)}</div>
            ))}
            {!status?.nextPulls?.length ? "Set on Config" : null}
          </div>
        </div>
        <div className="rounded-lg border border-border bg-bg/40 px-3 py-2">
          <div className="text-[10px] uppercase tracking-wide text-faint">Source</div>
          <div className="mt-0.5 text-sm font-semibold">
            {status?.hasSession ? `@${status.userName || status.userId || "saved"}` : "Not connected"}
          </div>
          <div className="text-[11px] text-muted">{scheduled.length} scheduled</div>
        </div>
        <div className={`rounded-lg border px-3 py-2 ${status?.persist?.db === "neon" && status?.persist?.ok !== false ? "border-success/30 bg-success/10" : status?.persist?.ok === false ? "border-danger/30 bg-danger/10" : "border-border bg-bg/40"}`}>
          <div className="text-[10px] uppercase tracking-wide text-faint">Database</div>
          <div className="mt-0.5 text-sm font-semibold">
            {status?.persist?.db === "neon" ? "Neon · persistent" : status?.persist?.ok === false ? "Unreachable" : "Preview · local"}
          </div>
          <div className="text-[11px] text-muted">
            {status?.persist
              ? `${status.persist.growthDays ?? 0}d history · ${status.persist.scheduledJobs ?? scheduled.length} jobs · webhook ${status.persist.webhook ? "on" : "off"}`
              : "Checking…"}
          </div>
        </div>
      </div>

      <div className="mb-3 rounded-xl border border-border bg-bg/50 p-3">
        <div className="mb-1 flex items-center gap-2 text-sm font-semibold">
          <Smartphone className="size-4 text-primary" />
          Pair Android
        </div>
        <p className="mb-2 text-[11px] text-muted">
          Generate a code, type it in the app. The phone never logs into JuicyChat — it only
          holds this pairing token. Green dot on the phone = live.
        </p>
        {pair ? (
          <p className="font-mono text-lg font-bold tracking-[0.3em] text-fg">{pair.code}</p>
        ) : (
          <p className="text-xs text-muted">No active code</p>
        )}
        <button
          type="button"
          onClick={() => void onPair()}
          disabled={pairBusy}
          className="mt-2 inline-flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-xs font-semibold disabled:opacity-60"
        >
          {pairBusy ? <Loader2 className="size-3 animate-spin" /> : null}
          New pairing code (15 min)
        </button>
      </div>

      <button
        type="button"
        onClick={() => void onPull()}
        disabled={busy}
        className="inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-fg disabled:opacity-60"
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
        Pull all data now
      </button>
      <p className="mt-1.5 text-[11px] text-muted">
        Full scrape of every feed, rank, tag, comment pulse, and rival. Cron follows the Config
        schedule.
      </p>
      {msg ? <p className={`mt-2 text-xs ${ok ? "text-success" : "text-danger"}`}>{msg}</p> : null}
    </section>
  );
}
