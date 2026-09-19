import { useCallback, useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ArrowLeft, Loader2, RefreshCw, TrendingUp, Users } from "lucide-react";
import { loadFollowersCached, refreshFollowers } from "@/lib/juicychat/actions";
import { MobileNav, DesktopNavLinks } from "@/components/mobile-nav";
import { formatDeltaFull, formatFull, formatWhen } from "@/lib/juicychat/format";
import { timezoneCity, getDisplayTimezone } from "@/lib/juicychat/timezone";
import type { FollowerAnalysis } from "@/lib/juicychat/followers";
import { browserCacheReady } from "@/lib/juicychat/browser-sync";

export const Route = createFileRoute("/followers")({ component: FollowersPage });

const tooltipStyle = {
  background: "var(--color-surface)",
  border: "1px solid var(--color-border)",
  borderRadius: 10,
  fontSize: 12,
  color: "var(--color-fg)",
};

function deltaClass(n: number | null) {
  if (n == null || n === 0) return "text-muted";
  return n > 0 ? "text-success" : "text-danger";
}

function FollowersPage() {
  const [data, setData] = useState<FollowerAnalysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [pulling, setPulling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await browserCacheReady();
      setData((await loadFollowersCached()) as FollowerAnalysis);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onPull = useCallback(async () => {
    setPulling(true);
    setError(null);
    try {
      const next = (await refreshFollowers({ data: {} })) as FollowerAnalysis;
      setData(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPulling(false);
    }
  }, []);

  const series = data?.series || [];
  const counts = series.map((p) => p.count);
  const cMin = counts.length ? Math.min(...counts) : 0;
  const cMax = counts.length ? Math.max(...counts) : 0;
  const pad = Math.max(25, Math.round((cMax - cMin) * 0.12) || 25);
  const trendDomain: [number, number] = [Math.max(0, cMin - pad), cMax + pad];
  const pending = data?.pendingFollows ?? 0;

  return (
    <div className="min-h-[calc(100dvh-var(--grok-banner-h,0px))] bg-bg pb-24 text-fg md:pb-10">
      <header className="sticky top-0 z-30 border-b border-border bg-bg/90 px-4 py-3 backdrop-blur md:px-6">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link to="/" className="grid size-9 place-items-center rounded-xl border border-border text-muted">
              <ArrowLeft className="size-4" />
            </Link>
            <div>
              <h1 className="font-[Syne] text-lg font-extrabold">Followers</h1>
              <p className="text-[11px] text-muted">
                Precise count · {data?.scrapedAt ? formatWhen(data.scrapedAt) : "not pulled yet"}
                {data?.source ? ` · ${data.source}` : ""}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <DesktopNavLinks />
            <button
              type="button"
              onClick={() => void onPull()}
              disabled={pulling}
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-3 text-sm font-semibold text-primary-fg disabled:opacity-60"
            >
              {pulling ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
              {pulling ? "Pulling…" : "Refresh"}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-5 md:px-6">
        {error ? (
          <div className="mb-4 rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">{error}</div>
        ) : null}

        {loading ? (
          <div className="flex min-h-48 items-center justify-center">
            <Loader2 className="size-8 animate-spin text-primary" />
          </div>
        ) : (
          <>
            <section className="mb-5 rounded-2xl border border-border bg-surface/70 p-5">
              <div className="text-[11px] uppercase tracking-wide text-muted">Exact follower count</div>
              <div className="mt-1 flex flex-wrap items-end gap-3">
                <div className="font-[Syne] text-5xl font-extrabold tracking-tight">{formatFull(data?.count)}</div>
                <Users className="mb-2 size-6 text-primary" />
              </div>
              <p className="mt-2 text-xs text-muted">
                Integer from JuicyChat (not the 4.49k-style abbreviation). Source: {data?.source || "—"}.
                {pending > 0
                  ? ` +${pending} named follow events since that total last moved — JuicyChat often lags the notification feed.`
                  : ""}
              </p>
            </section>

            <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ["Δ today", data?.dailyDelta],
                ["Δ 7 days", data?.weeklyDelta],
                ["Δ 30 days", data?.monthlyDelta],
                ["Per day (7d)", data?.velocityPerDay],
              ].map(([l, v]) => (
                <div key={String(l)} className="rounded-xl border border-border bg-bg/40 px-3 py-3">
                  <div className="text-[10px] uppercase tracking-wide text-faint">{l}</div>
                  <div className={`mt-1 text-lg font-extrabold ${deltaClass(v as number | null)}`}>
                    {formatDeltaFull(v as number | null)}
                  </div>
                  {l === "Δ today" && data?.dailyDeltaSource === "follows" ? (
                    <p className="mt-1 text-[10px] text-muted">from follow events · total not ticked yet</p>
                  ) : null}
                </div>
              ))}
            </div>

            <div className="mb-5 grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-border bg-bg/40 px-3 py-3">
                <div className="text-[10px] uppercase tracking-wide text-faint">Follow events (today)</div>
                <div className="mt-1 text-lg font-extrabold">{formatFull(data?.follows1d ?? 0)}</div>
                <p className="text-[11px] text-muted">Named follows today ({timezoneCity(getDisplayTimezone())}). Net total can lag or drop if people unfollow.</p>
              </div>
              <div className="rounded-xl border border-border bg-bg/40 px-3 py-3">
                <div className="text-[10px] uppercase tracking-wide text-faint">Follow events (7d)</div>
                <div className="mt-1 text-lg font-extrabold">{formatFull(data?.follows7d ?? 0)}</div>
              </div>
            </div>

            <section className="mb-5 rounded-2xl border border-border bg-surface/70 p-4">
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
                <TrendingUp className="size-4 text-primary" /> Follower trend
              </div>
              <div className="h-56 w-full">
                {series.length > 1 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={series}>
                      <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="date" tick={{ fill: "var(--color-faint)", fontSize: 10 }} />
                      <YAxis
                        tick={{ fill: "var(--color-faint)", fontSize: 10 }}
                        width={48}
                        allowDecimals={false}
                        domain={trendDomain}
                      />
                      <Tooltip contentStyle={tooltipStyle} formatter={(v) => formatFull(Number(v))} />
                      <Line type="monotone" dataKey="count" stroke="var(--color-chart-1)" strokeWidth={2.2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="flex h-full items-center justify-center text-sm text-muted">
                    Need 2+ scrape days — tap Refresh, then again tomorrow.
                  </p>
                )}
              </div>
              {series.length > 1 ? (
                <p className="mt-2 text-[11px] text-muted">
                  Axis zoomed to the follower range so day-to-day growth is visible
                  {pending > 0 ? " · last point includes follow events JuicyChat has not added to the total yet" : ""}.
                </p>
              ) : null}
            </section>

            <section className="mb-5 rounded-2xl border border-border bg-surface/70 p-4">
              <div className="mb-2 text-sm font-semibold">Daily delta</div>
              <div className="h-44 w-full">
                {series.length > 1 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={series}>
                      <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="date" tick={{ fill: "var(--color-faint)", fontSize: 10 }} />
                      <YAxis tick={{ fill: "var(--color-faint)", fontSize: 10 }} width={40} />
                      <Tooltip contentStyle={tooltipStyle} formatter={(v) => formatDeltaFull(Number(v))} />
                      <Line type="monotone" dataKey="delta" stroke="var(--color-chart-2)" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="flex h-full items-center justify-center text-sm text-muted">Daily change appears after the second scrape day.</p>
                )}
              </div>
              {pending > 0 ? (
                <p className="mt-2 text-[11px] text-muted">
                  Last day uses named follow events because the JuicyChat total stayed flat.
                </p>
              ) : null}
            </section>

            {data?.sample?.length ? (
              <section className="rounded-2xl border border-border bg-surface/70 p-4">
                <div className="mb-2 text-sm font-semibold">Latest followers (sample)</div>
                <ul className="divide-y divide-border/70">
                  {data.sample.slice(0, 20).map((f) => (
                    <li key={f.userId} className="flex items-center justify-between gap-2 py-2 text-sm">
                      <span className="truncate">@{f.userName}</span>
                      <span className="text-xs text-muted">
                        {f.followersCount != null ? formatFull(f.followersCount) + " fol" : ""}
                      </span>
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
