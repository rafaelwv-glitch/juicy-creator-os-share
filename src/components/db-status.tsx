import { useEffect, useState } from "react";
import { Database, Loader2 } from "lucide-react";
import { formatWhen } from "@/lib/juicychat/format";

export type PersistHealth = {
  db?: "neon" | "pglite";
  ok?: boolean;
  latencyMs?: number;
  error?: string | null;
  durable?: boolean;
  local?: boolean;
  browserCache?: boolean;
  browserScoped?: boolean;
  browserSavedAt?: string | null;
  schema?: boolean;
  schemaSolid?: boolean;
  hasSession?: boolean;
  webhook?: boolean;
  webhookLastOk?: boolean | null;
  webhookLastAt?: string | null;
  snapshotAt?: string | null;
  bots?: number;
  growthDays?: number;
  followerDays?: number;
  notifications?: number;
  scheduledJobs?: number;
  keys?: number;
  timezone?: string;
  lastPullAt?: string | null;
  lastPullOk?: boolean | null;
  lastPullMessage?: string | null;
  lastPullKind?: string | null;
  lastOkPullAt?: string | null;
  lastOkPullMessage?: string | null;
  dataDir?: string | null;
  pgliteDir?: string | null;
  clientHome?: string | null;
};

type PublicHealth = {
  db?: "neon" | "pglite";
  ok?: boolean;
  durable?: boolean;
  local?: boolean;
  browserCache?: boolean;
  latencyMs?: number;
  schema?: boolean;
  schemaSolid?: boolean;
  error?: string | null;
  dataDir?: string | null;
  pgliteDir?: string | null;
  clientHome?: string | null;
};

function tone(h: {
  db?: string;
  ok?: boolean;
  durable?: boolean;
  local?: boolean;
  browserCache?: boolean;
  pgliteDir?: string | null;
}) {
  if (h.ok === false) return "danger" as const;
  if (h.pgliteDir || (h.db === "pglite" && h.durable)) return "success" as const;
  if (h.browserCache) return "success" as const;
  if (h.db === "neon" && h.durable !== false) return "success" as const;
  if (h.db === "pglite") return "warning" as const;
  return "muted" as const;
}

function engineName(h: {
  db?: string;
  local?: boolean;
  durable?: boolean;
  browserCache?: boolean;
  pgliteDir?: string | null;
}) {
  if (h.pgliteDir || (h.db === "pglite" && h.durable)) return "Local PGLite";
  if (h.browserCache) return "This browser";
  if (h.db === "neon") return h.local ? "Local Postgres" : "Neon";
  if (h.db === "pglite") return h.durable ? "Local PGLite" : "Preview DB";
  return "Database";
}

function label(h: { db?: string; ok?: boolean; local?: boolean; durable?: boolean }) {
  if (h.ok === false) return "DB down";
  return engineName(h);
}

const PILL: Record<string, string> = {
  success: "border-success/30 text-success",
  warning: "border-warning/40 text-warning",
  danger: "border-danger/30 text-danger",
  muted: "border-border text-muted",
};
const DOT: Record<string, string> = {
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  muted: "bg-faint",
};
const CARD: Record<string, string> = {
  success: "border-success/30 bg-success/10",
  warning: "border-warning/30 bg-warning/10",
  danger: "border-danger/30 bg-danger/10",
  muted: "border-border bg-surface",
};

function usePublicHealth(ms = 12000) {
  const [h, setH] = useState<PublicHealth | null>(null);
  useEffect(() => {
    let stop = false;
    const load = () => {
      void fetch("/api/health", { cache: "no-store" })
        .then((r) => r.json())
        .then((d: PublicHealth) => {
          if (!stop) setH(d);
        })
        .catch(() => {
          if (!stop) setH({ ok: false, error: "unreachable" });
        });
    };
    load();
    const id = window.setInterval(load, ms);
    return () => {
      stop = true;
      window.clearInterval(id);
    };
  }, [ms]);
  return h;
}

/** Compact live badge for the login page. */
export function PublicDbBadge() {
  const h = usePublicHealth();
  if (!h) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-border bg-bg/50 px-3 py-2 text-[12px] text-muted">
        <Loader2 className="size-3.5 animate-spin" />
        Checking database…
      </div>
    );
  }
  const t = tone(h);
  const title =
    h.ok === false
      ? "Database unreachable"
      : h.db === "neon"
        ? h.local
          ? "Local Postgres connected"
          : "Neon Postgres connected"
        : h.durable
          ? "Local PGLite connected"
          : "Preview database (resets on restart)";
  const sub =
    h.ok === false
      ? h.error || "Cannot reach the database"
      : h.db === "neon" || h.durable
        ? `Accounts, webhook, history, and schedules persist${h.latencyMs != null ? ` · ${h.latencyMs}ms` : ""}`
        : `In-memory only — set DATABASE_URL or use ./data/pglite${h.latencyMs != null ? ` · ${h.latencyMs}ms` : ""}`;
  return (
    <div className={`flex items-start gap-2.5 rounded-xl border px-3 py-2.5 ${CARD[t]}`}>
      <span className={`mt-1.5 size-2 shrink-0 rounded-full ${DOT[t]}`} />
      <div className="min-w-0">
        <div className={`text-[13px] font-semibold ${t === "success" ? "text-success" : t === "warning" ? "text-warning" : t === "danger" ? "text-danger" : "text-fg"}`}>
          {title}
        </div>
        <div className="text-[11px] text-muted">{sub}</div>
      </div>
    </div>
  );
}

/** Header pill with inventory popover. */
export function DbStatusIndicator({ persist }: { persist?: PersistHealth | null }) {
  const live = usePublicHealth(15000);
  const [open, setOpen] = useState(false);
  const h = persist || live;
  if (!h) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted">
        <Loader2 className="size-3 animate-spin" />
        Database
      </span>
    );
  }
  const t = tone(h);
  const rows: Array<[string, string]> = [
    ["Engine", engineName(h) + (h.db === "pglite" && !h.durable && !h.pgliteDir && !h.browserCache ? " (embedded)" : "")],
    ["Reachable", h.ok === false ? persist?.error || live?.error || "no" : `yes${h.latencyMs != null ? ` · ${h.latencyMs}ms` : ""}`],
    ["Local DB", persist?.pgliteDir || persist?.dataDir || (persist?.browserCache ? "IndexedDB" : "none")],
    ["JuicyChat session", persist?.hasSession ? "saved" : "none"],
    [
      "Grok webhook",
      persist?.webhook
        ? persist.webhookLastOk === false
          ? "saved · last delivery failed"
          : "saved"
        : "not set",
    ],
    ["Latest snapshot", persist?.snapshotAt ? `${persist.bots ?? 0} bots` : "none"],
    ["Growth history", `${persist?.growthDays ?? 0} day(s)`],
    ["Follower history", `${persist?.followerDays ?? 0} day(s)`],
    ["Notifications", String(persist?.notifications ?? 0)],
    ["Scheduled publishes", String(persist?.scheduledJobs ?? 0)],
    [
      "Last successful full",
      persist?.lastOkPullAt ? formatWhen(persist.lastOkPullAt) : "never",
    ],
    [
      "Last pull",
      persist?.lastPullAt
        ? `${persist.lastPullOk === true ? "ok" : persist.lastPullOk === false ? "failed" : "running"} · ${formatWhen(persist.lastPullAt)}`
        : "never",
    ],
  ];
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] ${PILL[t]}`}
        aria-expanded={open}
      >
        <span className={`size-1.5 rounded-full ${DOT[t]}`} />
        <Database className="size-3" />
        {label(h)}
        {h.pgliteDir || h.durable ? " · saved" : h.browserCache ? " · saved" : h.db === "pglite" ? " · local" : ""}
      </button>
      {open ? (
        <div className="absolute left-0 z-30 mt-2 w-72 rounded-xl border border-border bg-surface p-3 text-left shadow-xl">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-faint">
            {h.pgliteDir || h.dataDir ? "Stored on this machine" : h.browserCache ? "Stored in this browser" : "Stored in database"}
          </div>
          <dl className="space-y-1.5 text-[12px]">
            {rows.map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3">
                <dt className="text-muted">{k}</dt>
                <dd className="text-right text-fg">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
    </div>
  );
}

function Cell({
  label: k,
  value,
  ok,
}: {
  label: string;
  value: string;
  ok: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-bg/50 px-3 py-2">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-faint">
        <span className={`size-1.5 rounded-full ${ok ? "bg-success" : "bg-faint"}`} />
        {k}
      </div>
      <div className="mt-0.5 truncate text-sm font-semibold text-fg">{value}</div>
    </div>
  );
}

/** Full dashboard card — live connection + what is actually stored. */
export function DatabaseStatusPanel({ persist }: { persist?: PersistHealth | null }) {
  const live = usePublicHealth(12000);
  const h: PersistHealth = { ...(live || {}), ...(persist || {}) };
  const t = persist || live ? tone(h) : "muted";
  const connected = h.ok !== false && Boolean(h.db);
  const title =
    h.ok === false
      ? "Database unreachable"
      : h.pgliteDir || (h.db === "pglite" && h.durable)
        ? "Local PGLite · file-backed"
        : h.browserCache
          ? "This browser · IndexedDB"
          : h.db === "neon"
            ? h.local
              ? "Local Postgres · connected"
              : "Neon Postgres · connected"
            : h.db === "pglite"
              ? "Preview database · local"
              : "Checking database…";
  const blurb =
    h.ok === false
      ? h.error || "Webhook, history, and schedules cannot be saved until this recovers."
      : h.pgliteDir || h.dataDir
        ? `Reads and writes ${h.clientHome || h.dataDir}. Copy that folder to back up.`
        : h.browserCache
          ? "JuicyChat session and warehouse stay in this browser as a cache. The file database on this machine is the source of truth."
          : h.db === "neon" || h.durable
            ? "Webhook, settings, history, and scheduled publishes are saved here."
            : "This preview resets on restart. Use Docker Postgres or file-backed PGLite to persist.";

  return (
    <section className={`rounded-xl border p-4 sm:p-5 ${CARD[t]}`}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-start gap-2.5">
          <span className={`mt-1.5 size-2.5 shrink-0 rounded-full ${DOT[t]} ${connected && t === "success" ? "animate-pulse" : ""}`} />
          <div>
            <div className="flex items-center gap-2">
              <Database className="size-4 text-fg" />
              <h2 className="text-sm font-semibold text-fg">{title}</h2>
            </div>
            <p className="mt-0.5 text-[12px] text-muted">{blurb}</p>
          </div>
        </div>
        <div className="text-right text-[11px] text-muted">
          {h.latencyMs != null ? `${h.latencyMs} ms` : live ? "…" : ""}
          {h.schemaSolid ? <div className="text-success">schema ready</div> : h.schema ? <div>legacy schema</div> : null}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Cell label="Session" value={persist?.hasSession ? "saved" : "none"} ok={Boolean(persist?.hasSession)} />
        <Cell label="Disk DB" value={h.pgliteDir ? "PGLite" : h.dataDir ? "files" : "none"} ok={Boolean(h.pgliteDir || h.dataDir)} />
        <Cell label="Browser" value={persist?.browserCache ? "IndexedDB" : "empty"} ok={Boolean(persist?.browserCache)} />
        <Cell
          label="Webhook"
          value={
            persist?.webhook
              ? persist.webhookLastOk === false
                ? "last failed"
                : "on"
              : "off"
          }
          ok={Boolean(persist?.webhook)}
        />
        <Cell
          label="History"
          value={`${persist?.growthDays ?? 0} days`}
          ok={(persist?.growthDays ?? 0) > 0}
        />
        <Cell
          label="Schedules"
          value={`${persist?.scheduledJobs ?? 0} queued`}
          ok={(persist?.scheduledJobs ?? 0) > 0}
        />
      </div>
      {h.clientHome || h.dataDir ? (
        <p className="mt-3 break-all rounded-lg border border-border bg-bg/50 px-3 py-2 font-mono text-[11px] text-muted">
          {h.clientHome || h.dataDir}
        </p>
      ) : null}
      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="rounded-lg border border-border bg-bg/50 px-3 py-2">
          <div className="text-[10px] uppercase tracking-wide text-faint">Last successful full</div>
          <div className="mt-0.5 text-sm font-semibold text-fg">
            {persist?.lastOkPullAt ? formatWhen(persist.lastOkPullAt) : "Never"}
          </div>
          <div className="text-[11px] text-muted">
            {persist?.lastOkPullMessage || (persist?.lastOkPullAt ? "Completed" : "No successful pull yet")}
          </div>
        </div>
        <div className={`rounded-lg border px-3 py-2 ${
          persist?.lastPullOk === true
            ? "border-success/30 bg-success/10"
            : persist?.lastPullOk === false
              ? "border-danger/30 bg-danger/10"
              : "border-border bg-bg/50"
        }`}>
          <div className="text-[10px] uppercase tracking-wide text-faint">Last pull</div>
          <div className={`mt-0.5 text-sm font-semibold ${
            persist?.lastPullOk === true
              ? "text-success"
              : persist?.lastPullOk === false
                ? "text-danger"
                : "text-fg"
          }`}>
            {!persist?.lastPullAt
              ? "Never"
              : persist.lastPullOk === true
                ? "Success"
                : persist.lastPullOk === false
                  ? "Failed"
                  : "Running"}
            {persist?.lastPullAt ? ` · ${formatWhen(persist.lastPullAt)}` : ""}
          </div>
          <div className="text-[11px] text-muted">
            {persist?.lastPullKind === "manual"
              ? "Complete · "
              : persist?.lastPullKind === "pull"
                ? persist.lastPullMessage?.toLowerCase().includes("complete")
                  ? "Cron (complete) · "
                  : persist.lastPullMessage?.toLowerCase().includes("not due") ||
                      persist.lastPullMessage?.toLowerCase().includes("paused")
                    ? "Cron (idle) · "
                    : "Cron (light) · "
                : ""}
            {persist?.lastPullMessage || "Waiting for the next pull"}
          </div>
        </div>
      </div>
      <p className="mt-2 text-[11px] text-muted">
        Followers {persist?.followerDays ?? 0}d · notifications {persist?.notifications ?? 0}
        {persist?.bots ? ` · snapshot ${persist.bots} bots` : ""}
        {persist?.timezone ? ` · ${persist.timezone}` : ""}
      </p>
    </section>
  );
}
