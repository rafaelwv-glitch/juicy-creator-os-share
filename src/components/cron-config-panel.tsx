import { useCallback, useEffect, useMemo, useState } from "react";
import { Clock, Loader2, Plus, Rocket, Trash2 } from "lucide-react";
import { getPullSchedule, savePullSchedule, getCloudLoungeStatus } from "@/lib/juicychat/actions";
import { formatAgo, formatWhen } from "@/lib/juicychat/format";
import { timezoneCity } from "@/lib/juicychat/timezone";

type Sources = Record<string, boolean>;

type Job = {
  id: string;
  name: string;
  enabled: boolean;
  when: "time" | "interval";
  hour: number;
  minute: number;
  intervalHours: number;
  complete: boolean;
  sources: Sources;
  lastFiredAt?: string | null;
};

type SourceMeta = { key: string; label: string; hint: string };

type Upcoming = {
  at: string;
  jobId: string;
  name: string;
  when: string;
  depth: "complete" | "light";
  sources: string[];
  overdue?: boolean;
};

type View = {
  schedule: { enabled: boolean; timezone?: string };
  jobs: Job[];
  upcoming: Upcoming[];
  sourceMeta: SourceMeta[];
  intervalOptions: number[];
  timezone?: string;
};

function hhmm(hour: number, minute: number) {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function parseTime(raw: string): { hour: number; minute: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(raw.trim());
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

function nid() {
  return `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function allOn(meta: SourceMeta[]): Sources {
  const s: Sources = {};
  for (const m of meta) s[m.key] = true;
  return s;
}

function onSources(job: Job, meta: SourceMeta[]): SourceMeta[] {
  const picked = meta.filter((m) => job.sources[m.key]);
  return picked.length ? picked : meta.filter((m) => m.key === "lounge");
}

function whenLine(job: Job, tz?: string) {
  if (job.when === "interval") {
    const n = job.intervalHours || 12;
    return `Every ${n} hour${n === 1 ? "" : "s"}`;
  }
  return `${hhmm(job.hour, job.minute)} ${timezoneCity(tz || "UTC")}`;
}

function blankJob(meta: SourceMeta[]): Job {
  return {
    id: nid(),
    name: "New scrape",
    enabled: true,
    when: "time",
    hour: 12,
    minute: 0,
    intervalHours: 12,
    complete: false,
    sources: allOn(meta),
    lastFiredAt: null,
  };
}

function SourceChips({
  keys,
  meta,
  compact,
}: {
  keys: string[];
  meta: SourceMeta[];
  compact?: boolean;
}) {
  const items = keys
    .map((k) => meta.find((m) => m.key === k) || { key: k, label: k, hint: "" })
    .filter(Boolean);
  const shown = items.length ? items : [{ key: "lounge", label: "Lounge snapshot", hint: "" }];
  return (
    <span className="flex flex-wrap gap-1">
      {shown.map((m) => (
        <span
          key={m.key}
          className={`rounded-full border border-border bg-bg px-2 py-0.5 font-medium ${
            compact ? "text-[10px]" : "text-[11px]"
          }`}
        >
          {m.label}
        </span>
      ))}
    </span>
  );
}

function DepthBadge({ complete }: { complete: boolean }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
        complete
          ? "border border-primary/30 bg-primary/10 text-primary"
          : "border border-border bg-bg text-muted"
      }`}
    >
      {complete ? "Complete" : "Light"}
    </span>
  );
}

export function CronConfigPanel({ className = "" }: { className?: string }) {
  const [view, setView] = useState<View | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [ok, setOk] = useState<boolean | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [lastCheckAt, setLastCheckAt] = useState<string | null>(null);

  const meta = view?.sourceMeta || [];

  const apply = useCallback((v: View) => {
    setView(v);
    setEnabled(v.schedule?.enabled !== false);
    const next = (v.jobs || []).map((j) => ({ ...j, sources: { ...(j.sources || {}) } }));
    setJobs(next);
    setOpenId((cur) => (cur && next.some((j) => j.id === cur) ? cur : next[0]?.id || null));
  }, []);

  const reload = useCallback(async () => {
    const [v, status] = await Promise.all([
      getPullSchedule() as Promise<View>,
      getCloudLoungeStatus().catch(() => null),
    ]);
    apply(v);
    if (status && typeof status === "object") {
      const s = status as {
        last?: { finishedAt?: string | null; startedAt?: string } | null;
        lastPull?: { finishedAt?: string | null; startedAt?: string } | null;
        persist?: { lastPullAt?: string | null } | null;
      };
      const at =
        s.last?.finishedAt || s.last?.startedAt || s.lastPull?.finishedAt || s.lastPull?.startedAt || s.persist?.lastPullAt || null;
      if (at) setLastCheckAt(at);
    }
    return v;
  }, [apply]);

  useEffect(() => {
    void reload().catch((e) => {
      setMsg(e instanceof Error ? e.message : String(e));
      setOk(false);
    });
    const onTz = () => void reload().catch(() => undefined);
    window.addEventListener("jl-timezone-changed", onTz);
    return () => window.removeEventListener("jl-timezone-changed", onTz);
  }, [reload]);

  const patch = (id: string, next: Partial<Job>) => {
    setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, ...next } : j)));
  };

  const onSave = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const cleaned = jobs.map((j) => {
        const sources = { ...j.sources };
        if (meta.length && !meta.some((m) => sources[m.key])) sources.lounge = true;
        return { ...j, name: (j.name || "Unnamed scrape").slice(0, 40), sources };
      });
      const v = (await savePullSchedule({
        data: { enabled, jobs: cleaned },
      })) as View;
      apply(v);
      setMsg("Jobs saved. The next cloud check will honor them.");
      setOk(true);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
      setOk(false);
    } finally {
      setBusy(false);
    }
  };

  const upcoming = useMemo(() => {
    if (!enabled) return [];
    return (view?.upcoming || []).filter((u) => jobs.some((j) => j.id === u.jobId && j.enabled));
  }, [enabled, view?.upcoming, jobs]);

  if (!view) {
    return (
      <section className={`rounded-xl border border-border bg-surface/80 p-4 sm:p-5 ${className}`}>
        <div className="flex items-center gap-2 text-sm text-muted">
          <Loader2 className="size-4 animate-spin" />
          Loading jobs…
        </div>
      </section>
    );
  }

  return (
    <section className={`rounded-xl border border-primary/30 bg-primary/5 p-4 sm:p-5 ${className}`}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-start gap-2">
          <Clock className="mt-0.5 size-4 text-primary" />
          <div>
            <h2 className="text-sm font-semibold">Scheduled jobs</h2>
            <p className="mt-0.5 max-w-xl text-[12px] text-muted">
              Each row is one scrape — its own clock, depth, and feeds. A late cloud check
              still runs a missed slot (it no longer expires after 20 minutes). Releases stay
              a separate always-on check.
            </p>
          </div>
        </div>
        <label className="inline-flex items-center gap-2 text-xs font-semibold">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="size-4 accent-primary"
          />
          {enabled ? "Scrapes on" : "Scrapes paused"}
        </label>
      </div>

      <div className="mb-4 rounded-xl border border-border bg-bg/50 p-3">
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-faint">
          Next on the clock
        </div>
        {!enabled ? (
          <p className="text-sm text-muted">Scrapes paused. Releases still fire on the next cloud check.</p>
        ) : upcoming.length ? (
          <ol className="space-y-2.5">
            {upcoming.map((u) => (
              <li key={`${u.jobId}-${u.at}`} className="space-y-1">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold">{u.name}</span>
                    <DepthBadge complete={u.depth === "complete"} />
                  </div>
                  <div className="font-mono text-xs text-fg">
                    {u.overdue || Date.parse(u.at) < Date.now() - 30_000
                      ? "Overdue · next cloud check"
                      : formatWhen(u.at)}
                  </div>
                </div>
                <SourceChips keys={u.sources} meta={meta} compact />
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-muted">No enabled scrape jobs. Add one below.</p>
        )}
      </div>

      <article className="mb-3 rounded-xl border border-border bg-bg/40 px-3 py-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex items-start gap-2">
            <Rocket className="mt-0.5 size-4 text-primary" />
            <div>
              <div className="text-sm font-semibold">Releases</div>
              <p className="text-[12px] text-muted">
                Due scheduled bots fire on the first successful cloud check after the time you
                pick. Target is every 15 minutes. Opening Release also fires anything already due.
              </p>
              <p className="mt-1 text-[11px] text-faint">
                Last check:{" "}
                <span className="font-medium text-fg">
                  {lastCheckAt ? `${formatAgo(lastCheckAt)} · ${formatWhen(lastCheckAt)}` : "not yet"}
                </span>
              </p>
            </div>
          </div>
          <span
            className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
              lastCheckAt && Date.now() - Date.parse(lastCheckAt) > 20 * 60_000
                ? "border-warning/30 bg-warning/10 text-warning"
                : "border-success/30 bg-success/10 text-success"
            }`}
          >
            {lastCheckAt && Date.now() - Date.parse(lastCheckAt) > 20 * 60_000 ? "Lagging" : "Always on"}
          </span>
        </div>
      </article>

      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-faint">
        Scrape jobs — each pulls only what you tick
      </div>

      <div className="space-y-3">
        {jobs.map((job) => {
          const open = openId === job.id;
          const chips = onSources(job, meta);
          return (
            <article
              key={job.id}
              className={`rounded-xl border px-3 py-3 ${
                job.enabled && enabled
                  ? "border-primary/30 bg-bg/60"
                  : "border-border bg-bg/30 opacity-80"
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <button
                  type="button"
                  onClick={() => setOpenId(open ? null : job.id)}
                  className="min-w-0 flex-1 text-left"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold">{job.name || "Unnamed scrape"}</span>
                    <DepthBadge complete={job.complete} />
                  </div>
                  <div className="mt-1 text-[12px] font-medium text-fg/80">
                    {whenLine(job, view.timezone || view.schedule?.timezone)}
                  </div>
                  <div className="mt-1.5">
                    <SourceChips keys={chips.map((c) => c.key)} meta={meta} />
                  </div>
                  {job.lastFiredAt ? (
                    <div className="mt-1.5 text-[11px] text-faint">
                      Last run {formatWhen(job.lastFiredAt)}
                    </div>
                  ) : (
                    <div className="mt-1.5 text-[11px] text-faint">Never run</div>
                  )}
                </button>
                <label className="inline-flex items-center gap-2 text-xs font-semibold">
                  <input
                    type="checkbox"
                    checked={job.enabled}
                    onChange={(e) => patch(job.id, { enabled: e.target.checked })}
                    className="size-4 accent-primary"
                  />
                  {job.enabled ? "On" : "Off"}
                </label>
              </div>

              {open ? (
                <div className="mt-3 space-y-3 border-t border-border pt-3">
                  <label className="block">
                    <span className="text-[11px] font-medium text-muted">Job name</span>
                    <input
                      value={job.name}
                      onChange={(e) => patch(job.id, { name: e.target.value })}
                      maxLength={40}
                      className="mt-1 h-10 w-full rounded-lg border border-border bg-bg px-3 text-sm"
                    />
                  </label>

                  <div>
                    <div className="mb-1.5 text-[11px] font-medium text-muted">When this job runs</div>
                    <div className="mb-2 grid gap-1 rounded-xl border border-border bg-bg/40 p-1 sm:grid-cols-2">
                      <button
                        type="button"
                        onClick={() => patch(job.id, { when: "time" })}
                        className={`rounded-lg px-3 py-2 text-xs font-semibold ${
                          job.when === "time" ? "bg-elevated text-fg shadow-sm" : "text-muted"
                        }`}
                      >
                        One time of day
                      </button>
                      <button
                        type="button"
                        onClick={() => patch(job.id, { when: "interval" })}
                        className={`rounded-lg px-3 py-2 text-xs font-semibold ${
                          job.when === "interval" ? "bg-elevated text-fg shadow-sm" : "text-muted"
                        }`}
                      >
                        Every N hours
                      </button>
                    </div>
                    {job.when === "time" ? (
                      <input
                        type="time"
                        value={hhmm(job.hour, job.minute)}
                        onChange={(e) => {
                          const p = parseTime(e.target.value);
                          if (p) patch(job.id, p);
                        }}
                        className="h-10 rounded-lg border border-border bg-bg px-3 text-sm"
                      />
                    ) : (
                      <select
                        value={job.intervalHours}
                        onChange={(e) => patch(job.id, { intervalHours: Number(e.target.value) })}
                        className="h-10 rounded-lg border border-border bg-bg px-3 text-sm"
                      >
                        {(view.intervalOptions || [1, 2, 3, 4, 6, 8, 12, 24]).map((n) => (
                          <option key={n} value={n}>
                            Every {n} hour{n === 1 ? "" : "s"}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>

                  <div>
                    <div className="mb-1.5 text-[11px] font-medium text-muted">How deep this job goes</div>
                    <div className="grid gap-1 rounded-xl border border-border bg-bg/40 p-1 sm:grid-cols-2">
                      <button
                        type="button"
                        onClick={() => patch(job.id, { complete: false })}
                        className={`rounded-lg px-3 py-2 text-left ${
                          !job.complete ? "bg-elevated text-fg shadow-sm" : "text-muted"
                        }`}
                      >
                        <div className="text-xs font-semibold">Light</div>
                        <div className="text-[11px] text-faint">
                          First pages only. No rival enrich. Fits the regular cloud budget.
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => patch(job.id, { complete: true })}
                        className={`rounded-lg px-3 py-2 text-left ${
                          job.complete ? "bg-elevated text-fg shadow-sm" : "text-muted"
                        }`}
                      >
                        <div className="text-xs font-semibold">Complete</div>
                        <div className="text-[11px] text-faint">
                          Same as Refresh all — full feeds, ranks, tags, rival MRT.
                        </div>
                      </button>
                    </div>
                  </div>

                  <div>
                    <div className="mb-1.5 text-[11px] font-medium text-muted">This job pulls</div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {meta.map((s) => {
                        const on = Boolean(job.sources[s.key]);
                        return (
                          <label
                            key={s.key}
                            className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 ${
                              on ? "border-primary/30 bg-primary/10" : "border-border bg-bg/40"
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={on}
                              onChange={() =>
                                patch(job.id, {
                                  sources: { ...job.sources, [s.key]: !on },
                                })
                              }
                              className="mt-0.5 size-4 accent-primary"
                            />
                            <span>
                              <span className="block text-xs font-semibold">{s.label}</span>
                              <span className="text-[11px] text-muted">{s.hint}</span>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>

                  {jobs.length > 1 ? (
                    <button
                      type="button"
                      onClick={() => {
                        setJobs((prev) => prev.filter((j) => j.id !== job.id));
                        if (openId === job.id) setOpenId(null);
                      }}
                      className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-danger/30 px-3 text-xs font-semibold text-danger"
                    >
                      <Trash2 className="size-3.5" />
                      Remove job
                    </button>
                  ) : null}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setOpenId(job.id)}
                  className="mt-2 text-[11px] font-semibold text-primary"
                >
                  Edit when / what this pulls
                </button>
              )}
            </article>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={jobs.length >= 8}
          onClick={() => {
            const j = blankJob(meta);
            setJobs((prev) => [...prev, j]);
            setOpenId(j.id);
          }}
          className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-border bg-bg px-3 text-sm font-semibold disabled:opacity-50"
        >
          <Plus className="size-4" />
          Add scrape job
        </button>
        <button
          type="button"
          onClick={() => void onSave()}
          disabled={busy || !jobs.length}
          className="inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-fg disabled:opacity-60"
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : null}
          Save jobs
        </button>
      </div>
      {msg ? <p className={`mt-2 text-xs ${ok ? "text-success" : "text-danger"}`}>{msg}</p> : null}
    </section>
  );
}
