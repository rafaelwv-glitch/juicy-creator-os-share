import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ArrowLeft,
  Bot,
  Clock,
  Heart,
  Loader2,
  RefreshCw,
  Sparkles,
  Star,
  Tag,
  TrendingUp,
} from "lucide-react";
import { getTimingAnalysis, refreshNotifications } from "@/lib/juicychat/actions";
import { MobileNav, DesktopNavLinks } from "@/components/mobile-nav";
import { DataToolsPanel } from "@/components/data-tools-panel";
import type {
  TimingAnalysis,
  SlotScore,
  BotTimingRow,
  TagTimingRow,
} from "@/lib/juicychat/notifications";
import { browserCacheReady } from "@/lib/juicychat/browser-sync";

export const Route = createFileRoute("/timing")({ component: TimingDashboard });

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Mon-first display

function formatNum(n: number | null | undefined) {
  if (n == null || Number.isNaN(n)) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(n >= 100_000 ? 0 : 1)}k`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function formatWhen(iso: string | null | undefined) {
  if (!iso) return "never";
  try {
    return new Date(iso).toLocaleString("en-GB", {
      timeZone: "Europe/Madrid",
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

function heatColor(total: number, max: number): string {
  if (!total || max <= 0) return "rgba(34, 37, 74, 0.45)";
  const t = Math.min(1, total / max);
  const r = Math.round(139 + (255 - 139) * t);
  const g = Math.round(124 + (107 - 124) * t);
  const b = Math.round(255 + (181 - 255) * t);
  const a = 0.25 + t * 0.75;
  return `rgba(${r},${g},${b},${a.toFixed(3)})`;
}

const tooltipStyle = {
  background: "#12132a",
  border: "1px solid #2a2d55",
  borderRadius: 8,
  fontSize: 12,
  color: "#e8e9ff",
};

function TimingDashboard() {
  const [analysis, setAnalysis] = useState<TimingAnalysis | null>(null);
  const [bootLoading, setBootLoading] = useState(true);
  const [pulling, setPulling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [lookbackDays, setLookbackDays] = useState(30);
  const [tagFilter, setTagFilter] = useState<string>("all");
  const pullLock = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setBootLoading(true);
      setError(null);
      try {
        await browserCacheReady();
        const data = (await getTimingAnalysis()) as TimingAnalysis;
        if (!cancelled) setAnalysis(data);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setBootLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onPull = useCallback(async () => {
    if (pullLock.current) return;
    pullLock.current = true;
    setPulling(true);
    setError(null);
    setStatusMsg(null);
    try {
      const res = (await refreshNotifications({
        data: { lookbackDays, maxPages: 150 },
      })) as {
        analysis: TimingAnalysis;
        added: number;
        pages: number;
        apiTotal: number;
        stoppedReason: string;
        eventCount: number;
      };
      setAnalysis(res.analysis);
      setStatusMsg(
        `Pulled ${res.pages} page(s) · +${res.added} new · ${res.eventCount} stored · stop: ${res.stoppedReason}` +
          (res.apiTotal ? ` · API total ≈ ${res.apiTotal}` : ""),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPulling(false);
      pullLock.current = false;
    }
  }, [lookbackDays]);

  const maxHeat = useMemo(() => {
    if (!analysis?.heatmap?.length) return 1;
    return Math.max(1, ...analysis.heatmap.map((c) => c.total));
  }, [analysis]);

  const heatMap = useMemo(() => {
    const m = new Map<string, { likes: number; favorites: number; total: number }>();
    for (const c of analysis?.heatmap ?? []) {
      m.set(`${c.day}-${c.hour}`, c);
    }
    return m;
  }, [analysis]);

  const dayChart = useMemo(() => {
    const rows = analysis?.byDayOfWeek ?? [];
    return DAY_ORDER.map((d) => {
      const row = rows.find((r) => r.day === d) ?? {
        day: d,
        dayLabel: DAY_LABELS[d]!,
        likes: 0,
        favorites: 0,
        total: 0,
      };
      return row;
    });
  }, [analysis]);

  const hourChart = useMemo(() => {
    return (analysis?.byHour ?? []).map((h) => ({
      ...h,
      label: `${String(h.hour).padStart(2, "0")}`,
    }));
  }, [analysis]);

  const filteredTags = useMemo(() => {
    return (analysis?.tags ?? []).filter((t) => t.tag !== "(untagged)" || t.total > 0);
  }, [analysis]);

  const selectedTag: TagTimingRow | null = useMemo(() => {
    if (tagFilter === "all") return null;
    return filteredTags.find((t) => t.tag === tagFilter) ?? null;
  }, [tagFilter, filteredTags]);

  const bots: BotTimingRow[] = analysis?.bots ?? [];

  return (
    <div className="min-h-[calc(100dvh-var(--grok-banner-h,0px))] bg-bg pb-24 text-fg md:pb-10">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -left-24 top-0 h-72 w-72 rounded-full bg-primary/20 blur-3xl" />
        <div className="absolute right-0 top-40 h-80 w-80 rounded-full bg-accent/10 blur-3xl" />
      </div>

      <div className="relative mx-auto max-w-7xl px-4 pb-16 pt-6 sm:px-6 lg:px-8">
        <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 rounded-full border border-border bg-surface/80 px-3 py-1 text-xs font-medium text-muted backdrop-blur">
              <Clock className="size-3.5 text-primary" />
              Best time to post · {analysis?.timezone ?? "Europe/Madrid"}
            </div>
            <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
              Timing <span className="text-muted">dashboard</span>
            </h1>
            <p className="max-w-2xl text-sm text-muted">
              Likes & favorites from your interaction feed, bucketed by day × hour.
              {analysis?.lastScrapedAt ? (
                <>
                  {" "}
                  · last pull{" "}
                  <time dateTime={analysis.lastScrapedAt}>{formatWhen(analysis.lastScrapedAt)}</time>
                </>
              ) : (
                " · no notifications pulled yet"
              )}
              {analysis?.rangeStart && analysis?.rangeEnd ? (
                <>
                  {" "}
                  · range {formatWhen(analysis.rangeStart)} → {formatWhen(analysis.rangeEnd)}
                </>
              ) : null}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Link
              to="/"
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-sm font-medium text-fg transition hover:border-border-strong hover:bg-surface-2"
            >
              <ArrowLeft className="size-4 text-primary" />
              Lounge
            </Link>
          <div className="ml-auto hidden md:block"><DesktopNavLinks /></div>
            <label className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-xs text-muted">
              Lookback
              <select
                value={lookbackDays}
                onChange={(e) => setLookbackDays(Number(e.target.value))}
                className="bg-transparent text-sm font-medium text-fg outline-none"
              >
                <option value={7}>7 days</option>
                <option value={14}>14 days</option>
                <option value={30}>30 days</option>
                <option value={60}>60 days</option>
                <option value={90}>90 days</option>
              </select>
            </label>
            <button
              type="button"
              onClick={() => void onPull()}
              disabled={pulling}
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-fg transition hover:brightness-110 disabled:opacity-60"
            >
              {pulling ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RefreshCw className="size-4" />
              )}
              {pulling ? "Pulling…" : "Pull notifications"}
            </button>
          </div>
        </header>

        {error && (
          <div className="mb-4 rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
            {error}
          </div>
        )}
        {statusMsg && (
          <div className="mb-4 rounded-lg border border-primary/30 bg-primary/10 px-4 py-2 text-sm text-primary">
            {statusMsg}
          </div>
        )}

        {bootLoading ? (
          <div className="flex min-h-48 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-surface/50 px-6 py-12 text-center">
            <Loader2 className="size-8 animate-spin text-primary" />
            <p className="text-sm text-muted">Loading timing analysis…</p>
          </div>
        ) : !analysis || analysis.eventCount === 0 ? (
          <div className="flex min-h-48 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-surface/50 px-6 py-12 text-center">
            <Sparkles className="size-8 text-primary" />
            <p className="text-sm text-muted">
              No like/favorite events yet. Connect a JuicyChat session on the lounge page, then pull
              notifications.
            </p>
            <button
              type="button"
              onClick={() => void onPull()}
              disabled={pulling}
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-fg disabled:opacity-60"
            >
              {pulling ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RefreshCw className="size-4" />
              )}
              Pull notifications
            </button>
          </div>
        ) : (
          <>
            <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Kpi
                icon={<TrendingUp className="size-4" />}
                label="Events"
                value={formatNum(analysis.eventCount)}
                sub={`${analysis.lookbackDays}d lookback`}
              />
              <Kpi
                icon={<Heart className="size-4" />}
                label="Likes"
                value={formatNum(analysis.likeCount)}
                sub="actionType 3"
              />
              <Kpi
                icon={<Star className="size-4" />}
                label="Favorites"
                value={formatNum(analysis.favoriteCount)}
                sub="actionType 2"
              />
              <Kpi
                icon={<Bot className="size-4" />}
                label="Bots"
                value={formatNum(analysis.uniqueBots)}
                sub={`${analysis.pagesFetched} pages last pull`}
              />
            </div>

            <section className="mb-6 rounded-xl border border-border bg-surface/80 p-4 sm:p-5">
              <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold">Activity heatmap</h2>
                  <p className="text-xs text-muted">
                    Day × hour in {analysis.timezone}. Brighter = more likes + favorites.
                  </p>
                </div>
                <div className="flex items-center gap-2 text-[10px] text-faint">
                  <span>Low</span>
                  <div className="flex h-3 w-24 overflow-hidden rounded">
                    {Array.from({ length: 8 }, (_, i) => (
                      <div
                        key={i}
                        className="flex-1"
                        style={{ background: heatColor((i + 1) * (maxHeat / 8), maxHeat) }}
                      />
                    ))}
                  </div>
                  <span>High</span>
                </div>
              </div>
              <div className="overflow-x-auto">
                <div className="inline-block min-w-[640px]">
                  <div
                    className="grid gap-0.5"
                    style={{ gridTemplateColumns: `3rem repeat(24, minmax(1.1rem, 1fr))` }}
                  >
                    <div />
                    {Array.from({ length: 24 }, (_, h) => (
                      <div
                        key={`h-${h}`}
                        className="text-center text-[9px] tabular-nums text-faint"
                      >
                        {h % 3 === 0 ? String(h).padStart(2, "0") : ""}
                      </div>
                    ))}
                    {DAY_ORDER.map((day) => (
                      <HeatRow
                        key={day}
                        day={day}
                        dayLabel={DAY_LABELS[day]!}
                        heatMap={heatMap}
                        maxHeat={maxHeat}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </section>

            <div className="mb-6 grid gap-4 lg:grid-cols-2">
              <section className="rounded-xl border border-border bg-surface/80 p-4 sm:p-5">
                <h2 className="mb-1 text-sm font-semibold">Best slots overall</h2>
                <p className="mb-3 text-xs text-muted">Weighted score = likes + favorites × 1.5</p>
                <div className="space-y-2">
                  {(analysis.overallBestSlots ?? []).map((slot, i) => (
                    <SlotRow key={slot.label} slot={slot} rank={i + 1} />
                  ))}
                  {!analysis.overallBestSlots?.length && (
                    <p className="py-4 text-center text-xs text-muted">No slots yet.</p>
                  )}
                </div>
              </section>

              <section className="rounded-xl border border-border bg-surface/80 p-4 sm:p-5">
                <h2 className="mb-3 text-sm font-semibold">By day of week</h2>
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={dayChart} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#2a2d55" vertical={false} />
                      <XAxis dataKey="dayLabel" tick={{ fill: "#9498c4", fontSize: 11 }} />
                      <YAxis tick={{ fill: "#5c618f", fontSize: 10 }} width={36} />
                      <Tooltip
                        contentStyle={tooltipStyle}
                        formatter={(v: number, name: string) => [
                          v,
                          name === "likes" ? "Likes" : "Favorites",
                        ]}
                      />
                      <Bar dataKey="likes" stackId="a" fill="#8b7cff" />
                      <Bar dataKey="favorites" stackId="a" fill="#ff6bb5" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </section>
            </div>

            <section className="mb-6 rounded-xl border border-border bg-surface/80 p-4 sm:p-5">
              <h2 className="mb-3 text-sm font-semibold">By hour of day</h2>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={hourChart} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#2a2d55" vertical={false} />
                    <XAxis dataKey="label" tick={{ fill: "#9498c4", fontSize: 10 }} interval={1} />
                    <YAxis tick={{ fill: "#5c618f", fontSize: 10 }} width={36} />
                    <Tooltip
                      contentStyle={tooltipStyle}
                      labelFormatter={(l) => `${l}:00–${l}:59`}
                      formatter={(v: number, name: string) => [
                        v,
                        name === "likes" ? "Likes" : "Favorites",
                      ]}
                    />
                    <Bar dataKey="likes" stackId="a" fill="#8b7cff" />
                    <Bar dataKey="favorites" stackId="a" fill="#ff6bb5" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>

            <section className="mb-6 rounded-xl border border-border bg-surface/80 p-4 sm:p-5">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Tag className="size-4 text-primary" />
                  <h2 className="text-sm font-semibold">Best times by tag</h2>
                </div>
                <select
                  value={tagFilter}
                  onChange={(e) => setTagFilter(e.target.value)}
                  className="h-9 rounded-lg border border-border bg-surface px-2 text-xs text-fg"
                >
                  <option value="all">All tags (overview)</option>
                  {filteredTags.map((t) => (
                    <option key={t.tag} value={t.tag}>
                      {t.tag} ({t.total})
                    </option>
                  ))}
                </select>
              </div>

              {selectedTag ? (
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-3 text-xs text-muted">
                    <span>
                      <strong className="text-fg">{selectedTag.bots}</strong> bots
                    </span>
                    <span>
                      <Heart className="mr-0.5 inline size-3 text-primary" />
                      {formatNum(selectedTag.likes)} likes
                    </span>
                    <span>
                      <Star className="mr-0.5 inline size-3 text-accent" />
                      {formatNum(selectedTag.favorites)} favs
                    </span>
                  </div>
                  <div className="space-y-2">
                    {selectedTag.bestSlots.map((slot, i) => (
                      <SlotRow key={slot.label} slot={slot} rank={i + 1} />
                    ))}
                  </div>
                  <div className="h-40">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={selectedTag.byHour.map((total, hour) => ({
                          hour,
                          label: String(hour).padStart(2, "0"),
                          total,
                        }))}
                        margin={{ top: 4, right: 8, left: 0, bottom: 0 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="#2a2d55" vertical={false} />
                        <XAxis
                          dataKey="label"
                          tick={{ fill: "#9498c4", fontSize: 10 }}
                          interval={2}
                        />
                        <YAxis tick={{ fill: "#5c618f", fontSize: 10 }} width={32} />
                        <Tooltip contentStyle={tooltipStyle} />
                        <Bar dataKey="total" fill="#8b7cff" radius={[3, 3, 0, 0]}>
                          {selectedTag.byHour.map((_, i) => (
                            <Cell
                              key={i}
                              fill={
                                i === selectedTag.bestSlots[0]?.hour ? "#ff6bb5" : "#8b7cff"
                              }
                            />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px] text-left text-sm">
                    <thead>
                      <tr className="border-b border-border text-[11px] uppercase tracking-wide text-faint">
                        <th className="pb-2 pr-3 font-medium">Tag</th>
                        <th className="pb-2 pr-3 font-medium">Bots</th>
                        <th className="pb-2 pr-3 font-medium">Events</th>
                        <th className="pb-2 font-medium">Top slots</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredTags.slice(0, 20).map((t) => (
                        <tr
                          key={t.tag}
                          className="border-b border-border/60 last:border-0 hover:bg-elevated/40"
                        >
                          <td className="py-2.5 pr-3">
                            <button
                              type="button"
                              onClick={() => setTagFilter(t.tag)}
                              className="font-medium text-primary hover:underline"
                            >
                              {t.tag}
                            </button>
                          </td>
                          <td className="py-2.5 pr-3 tabular-nums text-muted">{t.bots}</td>
                          <td className="py-2.5 pr-3 tabular-nums">
                            {formatNum(t.total)}
                            <span className="ml-1 text-[10px] text-faint">
                              ({t.likes}L / {t.favorites}F)
                            </span>
                          </td>
                          <td className="py-2.5 text-xs text-muted">
                            {t.bestSlots
                              .slice(0, 2)
                              .map((s) => s.label)
                              .join(" · ") || "—"}
                          </td>
                        </tr>
                      ))}
                      {!filteredTags.length && (
                        <tr>
                          <td colSpan={4} className="py-6 text-center text-xs text-muted">
                            No tag data — refresh lounge snapshot so bots have tags.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="mb-6 rounded-xl border border-border bg-surface/80 p-4 sm:p-5">
              <div className="mb-4 flex items-center gap-2">
                <Bot className="size-4 text-primary" />
                <h2 className="text-sm font-semibold">Per-bot timing</h2>
                <span className="text-xs text-faint">{bots.length} bots</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-border text-[11px] uppercase tracking-wide text-faint">
                      <th className="pb-2 pr-3 font-medium">Bot</th>
                      <th className="pb-2 pr-3 font-medium">Tags</th>
                      <th className="pb-2 pr-3 font-medium">Likes</th>
                      <th className="pb-2 pr-3 font-medium">Favs</th>
                      <th className="pb-2 pr-3 font-medium">Total</th>
                      <th className="pb-2 font-medium">Best slots</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bots.map((b) => (
                      <tr
                        key={b.characterId}
                        className="border-b border-border/60 last:border-0 hover:bg-elevated/40"
                      >
                        <td className="py-2.5 pr-3">
                          <div
                            className="max-w-[200px] truncate font-medium"
                            title={b.characterName}
                          >
                            {b.characterName}
                          </div>
                          <div className="font-mono text-[10px] text-faint">
                            {b.characterId.slice(0, 12)}…
                          </div>
                        </td>
                        <td className="py-2.5 pr-3">
                          <div className="flex max-w-[180px] flex-wrap gap-1">
                            {(b.tags.length ? b.tags : ["—"]).slice(0, 4).map((t) => (
                              <span
                                key={t}
                                className="rounded-md bg-elevated px-1.5 py-0.5 text-[10px] text-muted"
                              >
                                {t}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="py-2.5 pr-3 tabular-nums text-muted">
                          {formatNum(b.likes)}
                        </td>
                        <td className="py-2.5 pr-3 tabular-nums text-muted">
                          {formatNum(b.favorites)}
                        </td>
                        <td className="py-2.5 pr-3 tabular-nums font-medium">
                          {formatNum(b.total)}
                        </td>
                        <td className="py-2.5 text-xs text-muted">
                          {b.bestSlots
                            .slice(0, 3)
                            .map(
                              (s) =>
                                `${s.dayLabel} ${String(s.hour).padStart(2, "0")}h (${s.total})`,
                            )
                            .join(" · ") || "—"}
                        </td>
                      </tr>
                    ))}
                    {!bots.length && (
                      <tr>
                        <td colSpan={6} className="py-6 text-center text-xs text-muted">
                          No bot events.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="rounded-xl border border-border bg-surface/80 p-4 sm:p-5">
              <h2 className="mb-3 text-sm font-semibold">Recent events</h2>
              <div className="max-h-72 space-y-1.5 overflow-y-auto">
                {(analysis.recentEvents ?? []).map((ev) => (
                  <div
                    key={ev.messageId}
                    className="flex flex-wrap items-center gap-2 rounded-lg bg-bg/50 px-3 py-2 text-xs"
                  >
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                        ev.kind === "like"
                          ? "bg-primary/15 text-primary"
                          : "bg-accent/15 text-accent"
                      }`}
                    >
                      {ev.kind === "like" ? (
                        <Heart className="size-3" />
                      ) : (
                        <Star className="size-3" />
                      )}
                      {ev.kind}
                    </span>
                    <span className="font-medium">{ev.characterName}</span>
                    {ev.senderName ? (
                      <span className="text-faint">from {ev.senderName}</span>
                    ) : null}
                    <span className="ml-auto tabular-nums text-faint">
                      {new Date(ev.ts).toLocaleString("en-GB", {
                        timeZone: analysis.timezone,
                        dateStyle: "short",
                        timeStyle: "short",
                      })}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          </>
        )}
      </div>
      <DataToolsPanel
        className="mx-auto mt-8 max-w-7xl px-4 sm:px-6 lg:px-8"
        snapshot={null}
        growth={null}
        onImported={async () => {
          try {
            setAnalysis(await getTimingAnalysis());
          } catch {
            /* */
          }
        }}
      />
      <MobileNav />
    </div>
  );
}

function HeatRow({
  day,
  dayLabel,
  heatMap,
  maxHeat,
}: {
  day: number;
  dayLabel: string;
  heatMap: Map<string, { likes: number; favorites: number; total: number }>;
  maxHeat: number;
}) {
  return (
    <>
      <div className="flex items-center text-[11px] font-medium text-muted">{dayLabel}</div>
      {Array.from({ length: 24 }, (_, hour) => {
        const c = heatMap.get(`${day}-${hour}`);
        const total = c?.total ?? 0;
        const title = total
          ? `${dayLabel} ${String(hour).padStart(2, "0")}:00 — ${total} (${c?.likes ?? 0}L / ${c?.favorites ?? 0}F)`
          : `${dayLabel} ${String(hour).padStart(2, "0")}:00 — none`;
        return (
          <div
            key={hour}
            title={title}
            className="aspect-square rounded-[3px] border border-border/30 transition hover:ring-1 hover:ring-primary/60"
            style={{ background: heatColor(total, maxHeat) }}
          />
        );
      })}
    </>
  );
}

function SlotRow({ slot, rank }: { slot: SlotScore; rank: number }) {
  return (
    <div className="flex items-center gap-3 rounded-lg bg-bg/50 px-3 py-2">
      <span className="grid size-6 place-items-center rounded-md bg-elevated text-[11px] font-bold text-primary">
        {rank}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{slot.label}</div>
        <div className="text-[10px] text-faint">
          score {slot.score.toFixed(1)} · {slot.likes} likes · {slot.favorites} favs
        </div>
      </div>
      <span className="tabular-nums text-sm font-semibold text-fg">{slot.total}</span>
    </div>
  );
}

function Kpi({
  icon,
  label,
  value,
  sub,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface/80 p-3 sm:p-4">
      <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted">
        <span className="text-primary">{icon}</span>
        {label}
      </div>
      <div className="font-display text-2xl font-bold tracking-tight">{value}</div>
      <div className="mt-0.5 text-[11px] text-faint">{sub}</div>
    </div>
  );
}
