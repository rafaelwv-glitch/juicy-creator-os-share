import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ArrowLeft,
  Clock,
  Loader2,
  Newspaper,
  RefreshCw,
  Search,
  Tags,
  TrendingUp,
  Users,
} from "lucide-react";
import { loadNewFeedCached, refreshNewFeed } from "@/lib/juicychat/actions";
import { DesktopNavLinks, MobileNav } from "@/components/mobile-nav";
import { formatNum, formatWhen } from "@/lib/juicychat/format";
import type { NewFeedCard, NewFeedView } from "@/lib/juicychat/new-feed";
import { browserCacheReady } from "@/lib/juicychat/browser-sync";

export const Route = createFileRoute("/new-feed")({ component: NewFeedPage });

const tooltipStyle = {
  background: "var(--color-surface)",
  border: "1px solid var(--color-border)",
  borderRadius: 10,
  fontSize: 12,
  color: "var(--color-fg)",
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function formatPub(ms: number | undefined) {
  if (!ms) return "—";
  return formatWhen(ms);
}

function NewFeedPage() {
  const [data, setData] = useState<NewFeedView | null>(null);
  const [loading, setLoading] = useState(true);
  const [pulling, setPulling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<"titles" | "creators" | "tags">("titles");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await browserCacheReady();
      const v = (await loadNewFeedCached()) as NewFeedView;
      setData(v);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onRefresh = async () => {
    setPulling(true);
    setError(null);
    try {
      const v = (await refreshNewFeed({ data: {} })) as NewFeedView;
      setData(v);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPulling(false);
    }
  };

  const hasPull = Boolean(data?.lastScrapedAt);
  const filtered = useMemo(() => {
    const rows = data?.latest || [];
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((r) => {
      const hay = `${r.characterName} ${r.userName} ${r.tags.join(" ")}`.toLowerCase();
      return hay.includes(needle);
    });
  }, [data, q]);

  const hourData = useMemo(
    () =>
      (data?.hourCounts || []).map((n, h) => ({
        h: `${String(h).padStart(2, "0")}`,
        n,
      })),
    [data],
  );
  const weekData = useMemo(
    () =>
      (data?.weekdayCounts || []).map((n, i) => ({
        d: WEEKDAYS[i],
        n,
      })),
    [data],
  );

  return (
    <div className="min-h-dvh overflow-x-hidden bg-bg pb-24 text-fg md:pb-10">
      <header className="sticky top-0 z-30 border-b border-border bg-bg/95 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              to="/"
              className="grid size-11 shrink-0 place-items-center rounded-xl border border-border bg-surface text-muted hover:text-fg"
            >
              <ArrowLeft className="size-4" />
            </Link>
            <div className="min-w-0">
              <h1 className="font-display text-lg font-bold tracking-tight">New bot creation</h1>
              <p className="truncate text-[11px] text-muted">
                Homepage New · unfiltered · titles and metadata · dates kept
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <DesktopNavLinks />
            <button
              type="button"
              onClick={() => void onRefresh()}
              disabled={pulling}
              className="inline-flex h-11 items-center gap-2 rounded-xl bg-primary px-3 text-sm font-semibold text-primary-fg disabled:opacity-60"
            >
              {pulling ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
              {pulling ? "Paging New…" : "Refresh New"}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl min-w-0 space-y-5 px-4 py-5">
        <p className="text-xs text-muted">
          Manual only — not on Lounge Refresh all, not on scheduled jobs. Each pull is dated
          (Madrid) and merges into the warehouse so creator volume and tag mix accrue.
        </p>

        {error ? (
          <div className="rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
            {error}
          </div>
        ) : null}

        {loading ? (
          <div className="flex h-40 items-center justify-center text-muted">
            <Loader2 className="mr-2 size-5 animate-spin" /> Loading…
          </div>
        ) : !hasPull ? (
          <div className="rounded-2xl border border-dashed border-border bg-surface/50 p-10 text-center">
            <Newspaper className="mx-auto mb-3 size-8 text-primary" />
            <p className="text-sm text-muted">
              No New-feed snapshot yet. Refresh from this tab to pull titles, creators, publish
              times, and tags. Photos are skipped.
            </p>
            <button
              type="button"
              onClick={() => void onRefresh()}
              disabled={pulling}
              className="mt-4 inline-flex h-11 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-fg"
            >
              {pulling ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
              Pull homepage New
            </button>
          </div>
        ) : (
          <>
            <p className="text-xs text-muted">
              Snapshot {data?.lastDate} · {formatWhen(data?.lastScrapedAt)} Madrid
              {data?.firstDate && data.firstDate !== data.lastDate
                ? ` · accrued ${data.firstDate} → ${data.lastDate}`
                : ""}
              {` · ${data?.lastPages ?? 0} pages`}
              {data?.lastApiTotal != null ? ` · feed total ${formatNum(data.lastApiTotal)}` : ""}
              {data?.warnings?.length ? ` · ${data.warnings.length} warning(s)` : ""}
            </p>

            <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Kpi label="This pull" value={formatNum(data?.lastCount)} hint="titles in New" />
              <Kpi
                label="First seen today"
                value={formatNum(data?.lastNewCount)}
                hint="new to the warehouse"
              />
              <Kpi
                label="Accrued bots"
                value={formatNum(data?.catalogSize)}
                hint={`${formatNum(data?.dayCount)} dated pulls`}
              />
              <Kpi
                label="Creators"
                value={formatNum(data?.creatorCount)}
                hint="unique publishers seen"
              />
            </section>

            {data && data.volume.length > 1 ? (
              <Panel title="Volume by date" icon={TrendingUp} hint="Each refresh is a Madrid calendar day">
                <div className="h-52">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={data.volume} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" />
                      <XAxis dataKey="date" tick={{ fontSize: 10, fill: "var(--color-muted)" }} />
                      <YAxis tick={{ fontSize: 10, fill: "var(--color-muted)" }} width={36} />
                      <Tooltip contentStyle={tooltipStyle} />
                      <Legend />
                      <Line type="monotone" dataKey="count" name="In New" stroke="var(--color-primary)" dot={false} strokeWidth={2} />
                      <Line type="monotone" dataKey="newCount" name="First seen" stroke="var(--color-success)" dot={false} strokeWidth={2} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </Panel>
            ) : null}

            <div className="grid gap-3 lg:grid-cols-2">
              <Panel title="When they publish" icon={Clock} hint="First-publish hour, Madrid, accrued catalog">
                <div className="h-44">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={hourData} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
                      <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" />
                      <XAxis dataKey="h" tick={{ fontSize: 9, fill: "var(--color-muted)" }} interval={2} />
                      <YAxis tick={{ fontSize: 10, fill: "var(--color-muted)" }} width={28} />
                      <Tooltip contentStyle={tooltipStyle} />
                      <Bar dataKey="n" name="Bots" fill="var(--color-primary)" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {weekData.map((w) => (
                    <span
                      key={w.d}
                      className="rounded-full border border-border bg-bg px-2 py-0.5 text-[11px] tabular-nums text-muted"
                    >
                      {w.d} {formatNum(w.n)}
                    </span>
                  ))}
                </div>
              </Panel>

              <Panel title="Topic shift" icon={Tags} hint="Tag count this pull vs the previous dated pull">
                {data && data.tagShift.length ? (
                  <ul className="space-y-1.5">
                    {data.tagShift.slice(0, 12).map((t) => (
                      <li
                        key={t.tag}
                        className="flex items-center justify-between gap-2 rounded-lg border border-border bg-bg/60 px-2.5 py-1.5 text-sm"
                      >
                        <span className="truncate font-medium">{t.tag}</span>
                        <span className="shrink-0 tabular-nums text-xs text-muted">
                          {t.prev} → {t.now}{" "}
                          <span className={t.delta > 0 ? "text-success" : t.delta < 0 ? "text-danger" : "text-faint"}>
                            {t.delta > 0 ? `+${t.delta}` : t.delta}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted">Need two dated pulls before a shift appears.</p>
                )}
              </Panel>
            </div>

            <div className="flex flex-wrap gap-1 rounded-2xl border border-border bg-surface/80 p-1">
              {(
                [
                  ["titles", "Titles"],
                  ["creators", "Creators"],
                  ["tags", "Tags"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setTab(id)}
                  className={`h-11 flex-1 rounded-xl px-3 text-sm font-semibold ${
                    tab === id ? "bg-elevated text-fg shadow-sm" : "text-muted hover:text-fg"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {tab === "titles" ? (
              <section className="rounded-2xl border border-border bg-surface/90 p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold">This snapshot · {data?.lastDate}</h2>
                  <label className="relative min-w-[12rem] flex-1 sm:max-w-xs">
                    <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
                    <input
                      value={q}
                      onChange={(e) => setQ(e.target.value)}
                      placeholder="Title, creator, tag"
                      className="h-11 w-full rounded-xl border border-border bg-bg pl-9 pr-3 text-sm outline-none focus:border-primary"
                    />
                  </label>
                </div>
                <TitleTable rows={filtered} />
              </section>
            ) : null}

            {tab === "creators" ? (
              <section className="rounded-2xl border border-border bg-surface/90 p-4">
                <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                  <Users className="size-4 text-primary" />
                  Who posts — accrued {data?.firstDate} → {data?.lastDate}
                </h2>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[36rem] text-left text-sm">
                    <thead className="text-[11px] uppercase tracking-wide text-faint">
                      <tr>
                        <th className="pb-2 font-medium">Creator</th>
                        <th className="pb-2 font-medium tabular-nums">Bots</th>
                        <th className="pb-2 font-medium">First seen</th>
                        <th className="pb-2 font-medium">Last seen</th>
                        <th className="pb-2 font-medium">Tags</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(data?.topCreators || []).map((c) => (
                        <tr key={c.userId || c.userName} className="border-t border-border/70">
                          <td className="py-2 font-medium">@{c.userName || c.userId}</td>
                          <td className="py-2 tabular-nums">{c.bots}</td>
                          <td className="py-2 text-muted">{c.firstDate}</td>
                          <td className="py-2 text-muted">{c.lastDate}</td>
                          <td className="py-2 text-xs text-muted">{c.tags.join(" · ") || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ) : null}

            {tab === "tags" ? (
              <section className="rounded-2xl border border-border bg-surface/90 p-4">
                <h2 className="mb-3 text-sm font-semibold">Accrued tag mix</h2>
                <div className="flex flex-wrap gap-1.5">
                  {(data?.topTags || []).map((t) => (
                    <span
                      key={t.tag}
                      className="inline-flex items-center gap-1.5 rounded-full border border-border bg-bg px-2.5 py-1 text-xs"
                    >
                      <span>{t.tag}</span>
                      <span className="tabular-nums text-muted">{t.n}</span>
                    </span>
                  ))}
                </div>
              </section>
            ) : null}
          </>
        )}
      </main>
      <MobileNav />
    </div>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-2xl border border-border bg-surface/90 p-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-faint">{label}</p>
      <p className="mt-1 font-display text-2xl font-bold tabular-nums">{value}</p>
      <p className="text-[11px] text-muted">{hint}</p>
    </div>
  );
}

function Panel({
  title,
  hint,
  icon: Icon,
  children,
}: {
  title: string;
  hint: string;
  icon: typeof Clock;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border bg-surface/90 p-4">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <Icon className="size-4 text-primary" />
        {title}
      </h2>
      <p className="mb-3 text-[11px] text-muted">{hint}</p>
      {children}
    </section>
  );
}

function TitleTable({ rows }: { rows: NewFeedCard[] }) {
  if (!rows.length) {
    return <p className="text-sm text-muted">No titles match.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[40rem] text-left text-sm">
        <thead className="text-[11px] uppercase tracking-wide text-faint">
          <tr>
            <th className="pb-2 font-medium tabular-nums">#</th>
            <th className="pb-2 font-medium">Title</th>
            <th className="pb-2 font-medium">Creator</th>
            <th className="pb-2 font-medium">Published</th>
            <th className="pb-2 font-medium">Tags</th>
            <th className="pb-2 font-medium tabular-nums">Chats</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 500).map((r) => (
            <tr key={r.characterId} className="border-t border-border/70 align-top">
              <td className="py-2 tabular-nums text-faint">{r.rank}</td>
              <td className="py-2">
                <span className="font-medium">{r.characterName}</span>
                {r.own ? (
                  <span className="ml-1.5 rounded-full border border-success/30 bg-success/10 px-1.5 py-0.5 text-[10px] font-semibold text-success">
                    you
                  </span>
                ) : null}
              </td>
              <td className="py-2 text-muted">@{r.userName || r.userId || "—"}</td>
              <td className="py-2 whitespace-nowrap text-muted">{formatPub(r.gmtFirstPublish || r.gmtCreate)}</td>
              <td className="py-2 text-xs text-muted">{r.tags.slice(0, 8).join(" · ") || "—"}</td>
              <td className="py-2 tabular-nums">{formatNum(r.chatCount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > 500 ? (
        <p className="mt-2 text-[11px] text-faint">Showing 500 of {formatNum(rows.length)} — search to narrow.</p>
      ) : null}
    </div>
  );
}
