import { useCallback, useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, CheckCircle2, Cloud, Loader2, RefreshCw, Rocket, ShieldAlert, Clock } from "lucide-react";
import {
  loadPublishQueueCached,
  refreshPublishQueue,
  publishApprovedBots,
  scheduleCloudPublish,
  cancelCloudPublish,
  getCloudLoungeStatus,
} from "@/lib/juicychat/actions";
import { MobileNav, DesktopNavLinks } from "@/components/mobile-nav";
import { formatAgo, formatWhen } from "@/lib/juicychat/format";
import type { PublishQueue, PublishQueueRow, PublishResult } from "@/lib/juicychat/publish-bots";
import { browserCacheReady } from "@/lib/juicychat/browser-sync";

export const Route = createFileRoute("/publish")({ component: PublishPage });

type CloudJob = {
  id: string;
  characterId: string;
  characterName: string;
  fireAtMs: number;
  status: string;
  resultMessage?: string | null;
};

type CloudStatus = {
  jobs?: CloudJob[];
  last?: { startedAt?: string; finishedAt?: string | null; ok?: boolean | null; message?: string | null } | null;
  lastPull?: { startedAt?: string; finishedAt?: string | null } | null;
  persist?: { lastPullAt?: string | null } | null;
  publishFired?: number;
};

function visBadge(v: string) {
  if (v === "public") return "bg-success/15 text-success";
  if (v === "unlisted") return "bg-warning/15 text-warning";
  return "bg-elevated text-muted";
}

function BotList({
  rows,
  selectable,
  selected,
  onToggle,
  action,
  schedule,
}: {
  rows: PublishQueueRow[];
  selectable?: boolean;
  selected?: Set<string>;
  onToggle?: (id: string) => void;
  action?: (row: PublishQueueRow) => void;
  schedule?: (row: PublishQueueRow, fireAtMs: number) => void;
}) {
  if (!rows.length) return <p className="text-sm text-muted">None.</p>;
  return (
    <ul className="divide-y divide-border/70">
      {rows.map((r) => (
        <li key={r.characterId} className="flex flex-col gap-2 py-2.5">
          <div className="flex items-center gap-3">
            {selectable ? (
              <input
                type="checkbox"
                checked={selected?.has(r.characterId) ?? false}
                onChange={() => onToggle?.(r.characterId)}
                className="size-4 accent-[var(--color-primary)]"
              />
            ) : null}
            {r.characterThumb ? (
              <img src={r.characterThumb} alt="" className="size-10 rounded-lg object-cover" />
            ) : (
              <div className="size-10 rounded-lg bg-elevated" />
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold">{r.characterName}</div>
              <div className="text-[11px] text-muted">
                audit {r.auditType ?? "—"} · {r.chats.toLocaleString()} chats
              </div>
            </div>
            <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${visBadge(r.visibilityLabel)}`}>
              {r.visibilityLabel}
            </span>
            {r.canPublish && action ? (
              <button
                type="button"
                onClick={() => action(r)}
                className="rounded-lg bg-primary px-2.5 py-1 text-xs font-semibold text-primary-fg"
              >
                Publish
              </button>
            ) : null}
          </div>
          {r.canPublish && schedule ? (
            <form
              className="flex flex-wrap items-center gap-2 pl-7"
              onSubmit={(e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                const local = String(fd.get("when") || "");
                const ms = local ? new Date(local).getTime() : NaN;
                if (!Number.isFinite(ms)) return;
                schedule(r, ms);
              }}
            >
              <input
                type="datetime-local"
                name="when"
                required
                className="h-9 rounded-lg border border-border bg-bg px-2 text-xs"
              />
              <button
                type="submit"
                className="inline-flex h-9 items-center gap-1 rounded-lg border border-border px-2.5 text-xs font-semibold"
              >
                <Cloud className="size-3" /> Schedule on Vercel
              </button>
            </form>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function PublishPage() {
  const [q, setQ] = useState<PublishQueue | null>(null);
  const [loading, setLoading] = useState(true);
  const [pulling, setPulling] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<PublishResult[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [jobs, setJobs] = useState<CloudJob[]>([]);
  const [lastCheckAt, setLastCheckAt] = useState<string | null>(null);

  const applyQueue = useCallback((next: PublishQueue) => {
    setQ(next);
    const pendingIds = new Set(next.pending.map((p) => p.characterId));
    setSelected((prev) => new Set([...prev].filter((id) => pendingIds.has(id))));
  }, []);

  const applyStatus = useCallback((s: CloudStatus) => {
    setJobs((s.jobs || []) as CloudJob[]);
    const at =
      s.last?.finishedAt ||
      s.last?.startedAt ||
      s.lastPull?.finishedAt ||
      s.lastPull?.startedAt ||
      s.persist?.lastPullAt ||
      null;
    if (at) setLastCheckAt(at);
  }, []);

  const reloadJobs = useCallback(async () => {
    try {
      const s = (await getCloudLoungeStatus()) as CloudStatus;
      applyStatus(s);
      return s;
    } catch {
      return null;
    }
  }, [applyStatus]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        await browserCacheReady();
        const cached = (await loadPublishQueueCached()) as PublishQueue;
        if (!cancelled) applyQueue(cached);
        if (!cancelled) await reloadJobs();
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applyQueue, reloadJobs]);

  useEffect(() => {
    const tick = async () => {
      if (typeof document !== "undefined" && document.hidden) return;
      const s = await reloadJobs();
      if (s && (s.publishFired || 0) > 0) {
        try {
          applyQueue((await loadPublishQueueCached()) as PublishQueue);
        } catch {
          /* */
        }
      }
    };
    const id = window.setInterval(() => void tick(), 60_000);
    return () => window.clearInterval(id);
  }, [applyQueue, reloadJobs]);

  const onTickNow = useCallback(async () => {
    const s = await reloadJobs();
    if (s && (s.publishFired || 0) > 0) {
      try {
        applyQueue((await loadPublishQueueCached()) as PublishQueue);
      } catch {
        /* */
      }
    }
  }, [applyQueue, reloadJobs]);

  const onRefresh = useCallback(async () => {
    setPulling(true);
    setError(null);
    try {
      applyQueue((await refreshPublishQueue()) as PublishQueue);
      await reloadJobs();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPulling(false);
    }
  }, [applyQueue, reloadJobs]);

  const onPublish = useCallback(
    async (ids: string[]) => {
      if (!ids.length) return;
      if (!confirm(`Publish ${ids.length} approved bot(s) now on Vercel? This is the same as JuicyChat “Publish now”.`)) {
        return;
      }
      setPublishing(true);
      setError(null);
      try {
        const res = (await publishApprovedBots({ data: { characterIds: ids } })) as {
          results: PublishResult[];
          queue: PublishQueue;
        };
        setResults(res.results);
        applyQueue(res.queue);
        await reloadJobs();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setPublishing(false);
      }
    },
    [applyQueue, reloadJobs],
  );

  const onSchedule = useCallback(
    async (row: PublishQueueRow, fireAtMs: number) => {
      if (!Number.isFinite(fireAtMs) || fireAtMs < Date.now() + 10_000) {
        setError("Pick a time at least a few seconds in the future.");
        return;
      }
      const when = new Date(fireAtMs).toLocaleString();
      if (!confirm(`Schedule ONLY “${row.characterName}” for ${when} on Vercel (cloud)?`)) return;
      setPublishing(true);
      setError(null);
      try {
        await scheduleCloudPublish({
          data: {
            characterId: row.characterId,
            characterName: row.characterName,
            fireAtMs,
          },
        });
        await reloadJobs();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setPublishing(false);
      }
    },
    [reloadJobs],
  );

  const onCancelJob = useCallback(
    async (id: string, name: string) => {
      if (!confirm(`Cancel the cloud schedule for “${name}”?`)) return;
      try {
        await cancelCloudPublish({ data: { id } });
        await reloadJobs();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [reloadJobs],
  );

  const toggle = (id: string) => {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  const scheduled = jobs.filter((j) => j.status === "scheduled");

  return (
    <div className="min-h-[calc(100dvh-var(--grok-banner-h,0px))] bg-bg pb-24 text-fg md:pb-10">
      <header className="sticky top-0 z-30 border-b border-border bg-bg/90 px-4 py-3 backdrop-blur md:px-6">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link to="/" className="grid size-9 place-items-center rounded-xl border border-border text-muted">
              <ArrowLeft className="size-4" />
            </Link>
            <div>
              <h1 className="font-[Syne] text-lg font-extrabold">Release queue</h1>
              <p className="text-[11px] text-muted">
                {q?.scrapedAt ? formatWhen(q.scrapedAt) : "cached"} · {q?.total ?? 0} bots · cloud publish
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <DesktopNavLinks />
            <button
              type="button"
              onClick={() => void onRefresh()}
              disabled={pulling || publishing}
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-border px-3 text-sm font-semibold disabled:opacity-60"
            >
              {pulling ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
              Refresh
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-5 md:px-6">
        {error ? (
          <div className="mb-4 rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">{error}</div>
        ) : null}

        <section className="mb-5 rounded-2xl border border-border bg-surface/70 p-4 text-sm text-muted">
          <p>
            JuicyChat is a two-step release. Review is <strong className="text-fg">not</strong> publish.
            Approved bots are published <strong className="text-fg">on Vercel in the cloud</strong> — the
            Android app no longer fires publishes from the phone.
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>
              <strong className="text-fg">Publish now</strong> runs on this server using your stored JuicyChat session.
            </li>
            <li>
              <strong className="text-fg">Schedule</strong> stores the job in the cloud. It goes
              live on the <strong className="text-fg">first successful check after the time you
              pick</strong> — target every 15 minutes, often later. Opening this tab (and keeping
              it open) also fires anything already due. Scrapes follow the Config schedule.
            </li>
            <li>
              <strong className="text-fg">auditType 15</strong> — Approved, pending release. Trigger:{" "}
              <code className="text-xs">userPublishCharacter</code>.
            </li>
          </ul>
        </section>

        {loading ? (
          <div className="flex min-h-40 items-center justify-center">
            <Loader2 className="size-8 animate-spin text-primary" />
          </div>
        ) : (
          <>
            <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ["Pending release", q?.pending.length ?? 0, "text-success"],
                ["Under review", q?.review.length ?? 0, "text-warning"],
                ["Rejected", q?.rejected.length ?? 0, "text-danger"],
                ["Live", q?.liveCount ?? 0, "text-fg"],
              ].map(([l, v, c]) => (
                <div key={String(l)} className="rounded-xl border border-border bg-bg/40 px-3 py-3">
                  <div className="text-[10px] uppercase tracking-wide text-faint">{l}</div>
                  <div className={`mt-1 text-2xl font-extrabold ${c}`}>{v}</div>
                </div>
              ))}
            </div>

            <section className="mb-5 rounded-2xl border border-primary/30 bg-surface/70 p-4">
              <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                <h2 className="flex items-center gap-2 font-semibold">
                  <Cloud className="size-4 text-primary" /> Scheduled on Vercel
                </h2>
                <button
                  type="button"
                  disabled={publishing}
                  onClick={() => void onTickNow()}
                  className="rounded-lg border border-border px-2.5 py-1 text-xs font-semibold disabled:opacity-60"
                >
                  Check due now
                </button>
              </div>
              <p className="mb-3 text-[12px] text-muted">
                Last cloud check:{" "}
                <span className="font-medium text-fg">
                  {lastCheckAt ? `${formatAgo(lastCheckAt)} · ${formatWhen(lastCheckAt)}` : "not yet"}
                </span>
                {lastCheckAt && Date.now() - Date.parse(lastCheckAt) > 20 * 60_000
                  ? " · lagging — due jobs wait for the next check, or tap Check due now"
                  : " · due bots fire on the next check after their time"}
              </p>
              {scheduled.length ? (
                <ul className="divide-y divide-border/70">
                  {scheduled.map((j) => {
                    const due = j.fireAtMs <= Date.now();
                    return (
                      <li key={j.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                        <div>
                          <div className="text-sm font-semibold">{j.characterName}</div>
                          <div className="text-[11px] text-muted">
                            {due
                              ? `Due since ${formatWhen(new Date(j.fireAtMs).toISOString())} · waiting for a check`
                              : `Fires after ${formatWhen(new Date(j.fireAtMs).toISOString())} on the next check`}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => void onCancelJob(j.id, j.characterName)}
                          className="rounded-lg border border-border px-2.5 py-1 text-xs font-semibold"
                        >
                          Cancel
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-sm text-muted">None. Use “Schedule on Vercel” on a pending bot.</p>
              )}
            </section>

            <section className="mb-5 rounded-2xl border border-success/30 bg-surface/70 p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="flex items-center gap-2 font-semibold">
                  <Rocket className="size-4 text-success" /> Pending release — approved, not live
                </h2>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={publishing || !(q?.pending.length)}
                    onClick={() =>
                      setSelected(new Set((q?.pending || []).map((p) => p.characterId)))
                    }
                    className="h-10 rounded-lg border border-border px-3 text-xs font-semibold disabled:opacity-60"
                  >
                    Select all
                  </button>
                  <button
                    type="button"
                    disabled={publishing || selected.size === 0}
                    onClick={() => setSelected(new Set())}
                    className="h-10 rounded-lg border border-border px-3 text-xs font-semibold disabled:opacity-60"
                  >
                    Clear
                  </button>
                  <button
                    type="button"
                    disabled={publishing || selected.size === 0}
                    onClick={() => void onPublish([...selected])}
                    className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-3 text-sm font-semibold text-primary-fg disabled:opacity-60"
                  >
                    {publishing ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
                    Publish selected ({selected.size})
                  </button>
                </div>
              </div>
              <BotList
                rows={q?.pending || []}
                selectable
                selected={selected}
                onToggle={toggle}
                action={(row) => void onPublish([row.characterId])}
                schedule={(row, ms) => void onSchedule(row, ms)}
              />
            </section>

            <section className="mb-5 rounded-2xl border border-border bg-surface/70 p-4">
              <h2 className="mb-2 flex items-center gap-2 font-semibold">
                <Clock className="size-4 text-warning" /> Under review
              </h2>
              <BotList rows={q?.review || []} />
            </section>

            <section className="mb-5 rounded-2xl border border-border bg-surface/70 p-4">
              <h2 className="mb-2 flex items-center gap-2 font-semibold">
                <ShieldAlert className="size-4 text-danger" /> Rejected
              </h2>
              <BotList rows={q?.rejected || []} />
            </section>

            <section className="mb-5 rounded-2xl border border-border bg-surface/70 p-4">
              <h2 className="mb-2 font-semibold">Drafts (never approved / never submitted)</h2>
              <BotList rows={q?.drafts || []} />
            </section>

            {q?.takenPrivate?.length ? (
              <section className="mb-5 rounded-2xl border border-border bg-surface/70 p-4">
                <h2 className="mb-2 font-semibold">Previously published, now private/unlisted</h2>
                <BotList rows={q.takenPrivate} />
              </section>
            ) : null}

            {results.length ? (
              <section className="rounded-2xl border border-border bg-surface/70 p-4">
                <h2 className="mb-2 font-semibold">Last publish run</h2>
                <ul className="text-sm">
                  {results.map((r) => (
                    <li key={r.characterId} className={r.ok ? "text-success" : "text-danger"}>
                      {r.ok ? "✓" : "✕"} {r.characterName} — {r.message}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </>
        )}
      </main>
      <MobileNav />
    </div>
  );
}
