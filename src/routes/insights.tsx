import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import {
  ArrowLeft,
  Gift,
  Loader2,
  RefreshCw,
  Sparkles,
  Star,
  Users,
  Wallet,
  MessageSquare,
  ShieldAlert,
  Image as ImageIcon,
  Brain,
  Compass,
  TrendingUp,
} from "lucide-react";
import {
  CartesianGrid,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import {
  loadCreatorInsightsCached,
  refreshCreatorInsights,
} from "@/lib/juicychat/actions";
import { MobileNav, DesktopNavLinks } from "@/components/mobile-nav";
import { DataToolsPanel } from "@/components/data-tools-panel";
import type { CreatorInsights, DiscoveryFeedId } from "@/lib/juicychat/insights";
import { browserCacheReady } from "@/lib/juicychat/browser-sync";
import { formatWhenInZone, getDisplayTimezone } from "@/lib/juicychat/timezone";

export const Route = createFileRoute("/insights")({ component: InsightsPage });

const FEED_COLORS: Record<string, string> = {
  popular: "bg-primary/15 text-primary border-primary/30",
  recent: "bg-chart-4/15 text-chart-4 border-chart-4/30",
  trending: "bg-accent/15 text-accent border-accent/30",
  immersive: "bg-chart-1/15 text-chart-1 border-chart-1/30",
  new: "bg-success/15 text-success border-success/30",
  editor: "bg-warning/15 text-warning border-warning/30",
};

function formatNum(n: number | null | undefined) {
  if (n == null || Number.isNaN(n)) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(n >= 100_000 ? 0 : 1)}k`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function formatWhen(iso: string | null | undefined) {
  if (!iso) return "never";
  return formatWhenInZone(iso, getDisplayTimezone());
}

function InsightsPage() {
  const [data, setData] = useState<CreatorInsights | null>(null);
  const [loading, setLoading] = useState(true);
  const [pulling, setPulling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        await browserCacheReady();
        const cached = (await loadCreatorInsightsCached()) as CreatorInsights | null;
        if (!cancelled) setData(cached);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onPull = useCallback(async () => {
    setPulling(true);
    setError(null);
    try {
      const res = (await refreshCreatorInsights({
        data: { followerPages: 15, walletPages: 8, discoveryPages: 40 },
      })) as CreatorInsights;
      setData(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPulling(false);
    }
  }, []);

  const benefit = data?.benefit as Record<string, number | string> | null | undefined;
  const stats = data?.stats as Record<string, number | string> | null | undefined;
  const own = data?.ownCharacterData as Record<string, number | string> | null | undefined;

  const scoreChatData = useMemo(
    () =>
      (data?.scoreVsEngagement ?? []).map((p) => ({
        ...p,
        x: p.chats,
        y: p.score10,
        z: Math.max(8, Math.min(40, (p.likes || 1) + 8)),
      })),
    [data],
  );
  const scoreLikeData = useMemo(
    () =>
      (data?.scoreVsEngagement ?? []).map((p) => ({
        ...p,
        x: p.likes,
        y: p.score10,
        z: Math.max(8, Math.min(40, Math.sqrt(p.chats || 1) / 2 + 8)),
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
              className="grid size-9 shrink-0 place-items-center rounded-xl border border-border bg-surface text-muted hover:text-fg"
            >
              <ArrowLeft className="size-4" />
            </Link>
            <div className="min-w-0">
              <h1 className="font-display text-lg font-bold tracking-tight">Creator Insights</h1>
              <p className="truncate text-[11px] text-muted">
                Score vs engagement · discovery feeds · followers · depth
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <DesktopNavLinks />
            <button
              type="button"
              onClick={() => void onPull()}
              disabled={pulling}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-3 text-sm font-semibold text-primary-fg disabled:opacity-60"
            >
              {pulling ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
              {pulling ? "Pulling…" : "Refresh insights"}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl min-w-0 space-y-5 px-4 py-5">
        {error ? (
          <div className="rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
            {error}
          </div>
        ) : null}

        {loading ? (
          <div className="flex h-40 items-center justify-center text-muted">
            <Loader2 className="mr-2 size-5 animate-spin" /> Loading…
          </div>
        ) : !data ? (
          <div className="rounded-2xl border border-dashed border-border bg-surface/50 p-10 text-center">
            <Sparkles className="mx-auto mb-3 size-8 text-primary" />
            <p className="text-sm text-muted">
              No insights yet. Log in, refresh the lounge, pull likes/favs, then refresh insights
              (includes discovery feed scan).
            </p>
            <button
              type="button"
              onClick={() => void onPull()}
              className="mt-4 inline-flex h-11 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-fg"
            >
              Pull creator insights
            </button>
          </div>
        ) : (
          <>
            <p className="text-xs text-muted">
              Updated {formatWhen(data.scrapedAt)} · {data.timezone}
              {data.warnings?.length ? ` · ${data.warnings.length} warning(s)` : ""}
              {data.discovery
                ? ` · discovery scanned ${Object.values(data.discovery.pagesByFeed || {}).reduce((a, b) => a + b, 0)} pages`
                : ""}
            </p>

            <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <Kpi icon={<Users className="size-4" />} label="Followers pulled" value={formatNum(data.followerCount)} />
              <Kpi
                icon={<MessageSquare className="size-4" />}
                label="Chats (stats)"
                value={formatNum(Number(stats?.chatCount ?? 0))}
              />
              <Kpi icon={<Star className="size-4" />} label="Likes (stats)" value={formatNum(Number(stats?.likeCount ?? 0))} />
              <Kpi
                icon={<Compass className="size-4" />}
                label="On discovery"
                value={formatNum(data.discovery?.matrix?.length ?? 0)}
              />
              <Kpi
                icon={<Gift className="size-4" />}
                label="Gifts+rewards"
                value={formatNum((data.notifSummary.gift || 0) + (data.notifSummary.reward || 0))}
              />
              <Kpi
                icon={<TrendingUp className="size-4" />}
                label="Scored bots"
                value={formatNum(data.scoreVsEngagement?.length ?? 0)}
              />
            </section>

            {/* Score vs engagement */}
            <section className="rounded-2xl border border-border bg-surface/80 p-4">
              <div className="mb-1 flex items-center gap-2">
                <TrendingUp className="size-4 text-primary" />
                <h2 className="text-sm font-semibold">Score vs engagement</h2>
              </div>
              <p className="mb-4 text-xs text-muted">
                JuicyChat <code className="text-fg/80">score10</code> (platform rank weight) vs your
                chats / likes. High chats + low score = underranked; high score + mid chats = discovery
                favor.
              </p>
              {scoreChatData.length ? (
                <div className="grid min-w-0 gap-4 lg:grid-cols-2">
                  <div className="min-w-0">
                    <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted">
                      Score × chats
                    </div>
                    <div className="h-56 w-full min-w-0">
                      <ResponsiveContainer width="100%" height="100%">
                        <ScatterChart margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
                          <CartesianGrid stroke="#2a2d55" strokeDasharray="3 3" />
                          <XAxis
                            type="number"
                            dataKey="x"
                            name="Chats"
                            tick={{ fill: "#5c618f", fontSize: 10 }}
                            tickFormatter={(v) => formatNum(Number(v))}
                          />
                          <YAxis
                            type="number"
                            dataKey="y"
                            name="Score"
                            tick={{ fill: "#5c618f", fontSize: 10 }}
                            tickFormatter={(v) => formatNum(Number(v))}
                            width={48}
                          />
                          <ZAxis type="number" dataKey="z" range={[40, 200]} />
                          <Tooltip
                            cursor={{ strokeDasharray: "3 3" }}
                            contentStyle={{
                              background: "#12132a",
                              border: "1px solid #2a2d55",
                              borderRadius: 8,
                              fontSize: 12,
                            }}
                            formatter={(value: number, name: string) => [
                              formatNum(value),
                              name === "y" ? "score10" : name === "x" ? "chats" : name,
                            ]}
                            labelFormatter={(_, payload) =>
                              payload?.[0]?.payload?.characterName || ""
                            }
                          />
                          <Scatter data={scoreChatData} fill="#8b7cff" fillOpacity={0.75} />
                        </ScatterChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                  <div className="min-w-0">
                    <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted">
                      Score × likes
                    </div>
                    <div className="h-56 w-full min-w-0">
                      <ResponsiveContainer width="100%" height="100%">
                        <ScatterChart margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
                          <CartesianGrid stroke="#2a2d55" strokeDasharray="3 3" />
                          <XAxis
                            type="number"
                            dataKey="x"
                            name="Likes"
                            tick={{ fill: "#5c618f", fontSize: 10 }}
                            tickFormatter={(v) => formatNum(Number(v))}
                          />
                          <YAxis
                            type="number"
                            dataKey="y"
                            name="Score"
                            tick={{ fill: "#5c618f", fontSize: 10 }}
                            tickFormatter={(v) => formatNum(Number(v))}
                            width={48}
                          />
                          <ZAxis type="number" dataKey="z" range={[40, 200]} />
                          <Tooltip
                            cursor={{ strokeDasharray: "3 3" }}
                            contentStyle={{
                              background: "#12132a",
                              border: "1px solid #2a2d55",
                              borderRadius: 8,
                              fontSize: 12,
                            }}
                            formatter={(value: number, name: string) => [
                              formatNum(value),
                              name === "y" ? "score10" : name === "x" ? "likes" : name,
                            ]}
                            labelFormatter={(_, payload) =>
                              payload?.[0]?.payload?.characterName || ""
                            }
                          />
                          <Scatter data={scoreLikeData} fill="#ff6bb5" fillOpacity={0.75} />
                        </ScatterChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-muted">No scored bots yet — refresh lounge then insights.</p>
              )}
            </section>

            {/* Discovery placement */}
            <section className="rounded-2xl border border-border bg-surface/80 p-4">
              <div className="mb-1 flex items-center gap-2">
                <Compass className="size-4 text-primary" />
                <h2 className="text-sm font-semibold">Discovery placement</h2>
              </div>
              <p className="mb-3 text-xs text-muted">
                Live scan of JuicyChat homepage feeds (Popular · Recent · Trending · Immersive · New · Editor
                Choice). Shows which of <strong>your</strong> bots appear and their rank in the
                scanned window (~top {40 * 50} for large feeds; full Editor list).
              </p>

              {data.discovery ? (
                <>
                  <div className="mb-4 flex flex-wrap gap-2">
                    {data.discovery.feeds.map((f) => (
                      <span
                        key={f.id}
                        className={`rounded-lg border px-2.5 py-1 text-xs font-medium ${FEED_COLORS[f.id] || "border-border text-muted"}`}
                      >
                        {f.label}: <b>{f.hits.length}</b>
                        <span className="opacity-70">
                          {" "}
                          · scanned {formatNum(f.scannedCount)}
                          {f.apiTotal != null ? ` / ${formatNum(f.apiTotal)}` : ""}
                        </span>
                      </span>
                    ))}
                  </div>

                  <div className="mb-4 grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
                    {data.discovery.feeds.map((f) => (
                      <div key={f.id} className="rounded-xl border border-border bg-bg/50 p-3">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <h3 className="text-xs font-semibold">{f.label}</h3>
                          <span className="text-[10px] text-muted">{f.hits.length} of yours</span>
                        </div>
                        <div className="max-h-48 space-y-1.5 overflow-y-auto">
                          {f.hits.slice(0, 15).map((h) => (
                            <div
                              key={`${f.id}-${h.characterId}`}
                              className="flex items-start justify-between gap-2 text-xs"
                            >
                              <span className="min-w-0 truncate">
                                <span className="mr-1.5 font-bold text-primary">#{h.rank}</span>
                                {h.characterName}
                              </span>
                              <span className="shrink-0 tabular-nums text-muted">
                                {formatNum(h.chats ?? 0)}c
                              </span>
                            </div>
                          ))}
                          {!f.hits.length ? (
                            <p className="text-[11px] text-muted">
                              None of yours in scanned top {f.scannedCount || "—"}.
                            </p>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[720px] text-left text-xs">
                      <thead className="text-muted">
                        <tr className="border-b border-border">
                          <th className="pb-2 font-medium">Bot</th>
                          <th className="pb-2 font-medium">Feeds</th>
                          <th className="pb-2 font-medium">Pop</th>
                          <th className="pb-2 font-medium">Rec</th>
                          <th className="pb-2 font-medium">Trend</th>
                          <th className="pb-2 font-medium">Imm</th>
                          <th className="pb-2 font-medium">New</th>
                          <th className="pb-2 font-medium">Editor</th>
                          <th className="pb-2 font-medium">Chats</th>
                          <th className="pb-2 font-medium">Score</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.discovery.matrix.slice(0, 40).map((row) => (
                          <tr key={row.characterId} className="border-b border-border/60">
                            <td className="max-w-[160px] truncate py-2 pr-2 font-medium">
                              {row.characterName}
                              {row.baseEditor === 1 ? (
                                <span className="ml-1 text-[10px] text-warning">★flag</span>
                              ) : null}
                              {row.baseImmersive === 1 ? (
                                <span className="ml-1 text-[10px] text-chart-1">★imm</span>
                              ) : null}
                            </td>
                            <td className="py-2">
                              <div className="flex flex-wrap gap-0.5">
                                {row.feeds.map((fid) => (
                                  <FeedPill key={fid} id={fid} />
                                ))}
                                {!row.feeds.length && row.baseEditor === 1 ? (
                                  <span className="text-[10px] text-muted">editor flag only</span>
                                ) : null}
                                {!row.feeds.length && row.baseImmersive === 1 ? (
                                  <span className="text-[10px] text-muted">immersive flag only</span>
                                ) : null}
                              </div>
                            </td>
                            {(["popular", "recent", "trending", "immersive", "new", "editor"] as DiscoveryFeedId[]).map(
                              (fid) => (
                                <td key={fid} className="py-2 tabular-nums text-muted">
                                  {row.ranks[fid] != null ? `#${row.ranks[fid]}` : "—"}
                                </td>
                              ),
                            )}
                            <td className="py-2 tabular-nums">{formatNum(row.chats)}</td>
                            <td className="py-2 tabular-nums">{formatNum(row.score10)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {!data.discovery.matrix.length ? (
                      <p className="py-3 text-xs text-muted">
                        No own bots found in the scanned discovery windows. Try again later or after
                        publishing.
                      </p>
                    ) : null}
                  </div>
                </>
              ) : (
                <p className="text-xs text-muted">
                  Discovery not scanned yet — pull insights while logged in.
                </p>
              )}
            </section>

            <div className="grid gap-4 lg:grid-cols-2">
              <section className="rounded-2xl border border-border bg-surface/80 p-4">
                <h2 className="mb-3 text-sm font-semibold">Creator benefits / quotas</h2>
                {benefit ? (
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <Mini label="Image remain" value={`${benefit.imageRemain ?? "—"} / ${benefit.imageTotal ?? "—"}`} />
                    <Mini label="Video remain" value={`${benefit.videoRemain ?? "—"} / ${benefit.videoTotal ?? "—"}`} />
                    <Mini label="Quarter bots" value={formatNum(Number(benefit.quarterBotCount ?? 0))} />
                    <Mini label="Quarter chats" value={formatNum(Number(benefit.quarterChatCount ?? 0))} />
                  </div>
                ) : (
                  <p className="text-xs text-muted">No benefit payload.</p>
                )}
                {own ? (
                  <div className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                    <Mini label="All bots" value={formatNum(Number(own.allCount ?? 0))} />
                    <Mini label="Public" value={formatNum(Number(own.publicCount ?? 0))} />
                    <Mini label="Private" value={formatNum(Number(own.privateCount ?? 0))} />
                    <Mini label="Unlisted" value={formatNum(Number(own.unlistedCount ?? 0))} />
                  </div>
                ) : null}
              </section>

              <section className="rounded-2xl border border-border bg-surface/80 p-4">
                <h2 className="mb-3 text-sm font-semibold">Notification mix (stored)</h2>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(data.notifSummary)
                    .sort((a, b) => b[1] - a[1])
                    .map(([k, v]) => (
                      <span
                        key={k}
                        className="rounded-lg border border-border bg-bg px-2.5 py-1 text-xs font-medium text-muted"
                      >
                        {k}: <span className="text-fg">{v}</span>
                      </span>
                    ))}
                  {!Object.keys(data.notifSummary).length ? (
                    <p className="text-xs text-muted">Pull likes/favs (expanded) on Timing first.</p>
                  ) : null}
                </div>
              </section>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <RankCard title="Top by chats" icon={<MessageSquare className="size-4" />} items={data.topByChats} />
              <RankCard title="Top by score10" icon={<Sparkles className="size-4" />} items={data.topByScore} />
              <RankCard title="Top by likes" icon={<Star className="size-4" />} items={data.topByLikes || []} />
              <RankCard title="Top by memories" icon={<Brain className="size-4" />} items={data.topByMemories} />
              <RankCard title="Top by gen pictures" icon={<ImageIcon className="size-4" />} items={data.topByGenPics} />
            </div>

            <section className="rounded-2xl border border-border bg-surface/80 p-4">
              <h2 className="mb-3 text-sm font-semibold">Bot depth (scores · discovery · content)</h2>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[800px] text-left text-xs">
                  <thead className="text-muted">
                    <tr className="border-b border-border">
                      <th className="pb-2 font-medium">Bot</th>
                      <th className="pb-2 font-medium">Chats</th>
                      <th className="pb-2 font-medium">Score10</th>
                      <th className="pb-2 font-medium">Mem</th>
                      <th className="pb-2 font-medium">Gen</th>
                      <th className="pb-2 font-medium">Age</th>
                      <th className="pb-2 font-medium">Feeds</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.botDepth.slice(0, 50).map((b) => (
                      <tr key={b.characterId} className="border-b border-border/60">
                        <td className="max-w-[180px] truncate py-2 pr-2 font-medium">{b.characterName}</td>
                        <td className="py-2 tabular-nums">{formatNum(b.chats)}</td>
                        <td className="py-2 tabular-nums">{formatNum(b.score10)}</td>
                        <td className="py-2 tabular-nums">{b.memoryCount ?? 0}</td>
                        <td className="py-2 tabular-nums">{b.genPictureCount ?? 0}</td>
                        <td className="py-2 tabular-nums">{b.ageDays != null ? `${b.ageDays}d` : "—"}</td>
                        <td className="py-2">
                          <div className="flex flex-wrap gap-0.5">
                            {(b.discoveryFeeds || []).map((fid) => (
                              <span
                                key={fid}
                                className={`rounded border px-1 text-[10px] ${FEED_COLORS[fid] || ""}`}
                                title={
                                  b.discoveryRanks?.[fid] != null
                                    ? `#${b.discoveryRanks[fid]}`
                                    : fid
                                }
                              >
                                {fid}
                                {b.discoveryRanks?.[fid] != null ? ` #${b.discoveryRanks[fid]}` : ""}
                              </span>
                            ))}
                            {b.baseEditor === 1 && !(b.discoveryFeeds || []).includes("editor") ? (
                              <span className="text-[10px] text-warning">★editor</span>
                            ) : null}
                            {b.baseImmersive === 1 && !(b.discoveryFeeds || []).includes("immersive") ? (
                              <span className="text-[10px] text-chart-1">★immersive</span>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <div className="grid gap-4 lg:grid-cols-2">
              <EventList title="Recent follows" icon={<Users className="size-4" />} events={data.follows} />
              <EventList title="Gifts & rewards" icon={<Gift className="size-4" />} events={data.giftsRewards} />
              <EventList title="Comments" icon={<MessageSquare className="size-4" />} events={data.comments} />
              <EventList title="Audit events" icon={<ShieldAlert className="size-4" />} events={data.audits} />
            </div>

            <section className="rounded-2xl border border-border bg-surface/80 p-4">
              <div className="mb-3 flex items-center gap-2">
                <Wallet className="size-4 text-primary" />
                <h2 className="text-sm font-semibold">Wallet / gems ledger</h2>
              </div>
              {data.wallet?.length ? (
                <div className="space-y-2">
                  {data.wallet.slice(0, 30).map((tx) => (
                    <div
                      key={tx.id}
                      className="flex items-start justify-between gap-3 rounded-lg border border-border bg-bg/60 px-3 py-2 text-xs"
                    >
                      <div>
                        <div className="font-medium">{tx.remark || `Type ${tx.type ?? "—"}`}</div>
                        <div className="text-muted">
                          {tx.ts
                            ? formatWhen(new Date(tx.ts < 1e12 ? tx.ts * 1000 : tx.ts).toISOString())
                            : "—"}
                        </div>
                      </div>
                      <div className="tabular-nums font-semibold text-primary">
                        {tx.gems != null ? tx.gems : tx.amount != null ? tx.amount : "—"}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted">No wallet rows (endpoint may require creator eligibility).</p>
              )}
            </section>

            <section className="rounded-2xl border border-border bg-surface/80 p-4">
              <h2 className="mb-3 text-sm font-semibold">Followers sample ({data.followerCount})</h2>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {data.followers.slice(0, 24).map((f) => (
                  <div key={f.userId} className="flex items-center gap-2 rounded-xl border border-border bg-bg/50 p-2">
                    {f.userAvatar ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={f.userAvatar}
                        alt=""
                        className="size-9 rounded-lg object-cover"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <div className="grid size-9 place-items-center rounded-lg bg-elevated text-primary">
                        <Users className="size-4" />
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">@{f.userName}</div>
                      <div className="text-[10px] text-muted">
                        {formatNum(f.followersCount)} fol · {formatNum(f.characterCount)} bots
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </>
        )}
      </main>
      <DataToolsPanel
        className="mx-auto mt-8 max-w-7xl px-4 sm:px-6 lg:px-8"
        snapshot={null}
        growth={null}
        accountLabel={data?.scrapedAt ? "Insights cache" : undefined}
        onImported={async () => {
          try {
            const cached = await loadCreatorInsightsCached();
            setData(cached as CreatorInsights | null);
          } catch {
            /* */
          }
        }}
      />
      <MobileNav />
    </div>
  );
}

function FeedPill({ id }: { id: string }) {
  return (
    <span className={`rounded border px-1 text-[10px] font-medium ${FEED_COLORS[id] || "border-border"}`}>
      {id}
    </span>
  );
}

function Kpi({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface/80 p-3">
      <div className="mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted">
        {icon}
        {label}
      </div>
      <div className="text-xl font-bold tabular-nums">{value}</div>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-bg/60 p-2">
      <div className="text-[10px] text-muted">{label}</div>
      <div className="font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function RankCard({
  title,
  icon,
  items,
}: {
  title: string;
  icon: React.ReactNode;
  items: Array<{ characterId: string; characterName: string; value: number }>;
}) {
  return (
    <section className="rounded-2xl border border-border bg-surface/80 p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <span className="text-primary">{icon}</span>
        {title}
      </div>
      <div className="space-y-2">
        {items.slice(0, 8).map((it, i) => (
          <div key={it.characterId} className="flex items-center justify-between gap-2 text-xs">
            <span className="min-w-0 truncate">
              <span className="mr-1.5 font-bold text-primary">#{i + 1}</span>
              {it.characterName}
            </span>
            <span className="tabular-nums font-semibold">{formatNum(it.value)}</span>
          </div>
        ))}
        {!items.length ? <p className="text-xs text-muted">No data yet.</p> : null}
      </div>
    </section>
  );
}

function EventList({
  title,
  icon,
  events,
}: {
  title: string;
  icon: React.ReactNode;
  events: CreatorInsights["follows"];
}) {
  return (
    <section className="rounded-2xl border border-border bg-surface/80 p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <span className="text-primary">{icon}</span>
        {title}
      </div>
      <div className="max-h-64 space-y-2 overflow-y-auto">
        {events.slice(0, 25).map((e) => (
          <div key={e.messageId} className="rounded-lg border border-border bg-bg/50 px-2.5 py-2 text-xs">
            <div className="font-medium">{e.characterName}</div>
            <div className="text-muted">
              {e.senderName ? `@${e.senderName} · ` : ""}
              {formatWhen(new Date(e.ts).toISOString())} · {e.kind}
            </div>
          </div>
        ))}
        {!events.length ? <p className="text-xs text-muted">No events of this type yet.</p> : null}
      </div>
    </section>
  );
}
