import { useMemo, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Award,
  Bot,
  Crosshair,
  Flame,
  Heart,
  Loader2,
  MessageSquare,
  Minus,
  RefreshCw,
  Fingerprint,
  Sparkles,
  Star,
  Trophy,
  TrendingUp,
  Users,
  Coins,
} from "lucide-react";
import type { CreatorDashboard } from "@/lib/juicychat/dashboard";
import { refreshRanklistBoards } from "@/lib/juicychat/actions";
import { formatDelta, formatNum, formatPct, formatWhen } from "@/lib/juicychat/format";
import { BotPerformancePanel } from "@/components/bot-performance";
import { ProductionYieldPanel } from "@/components/production-yield";
import { ExposurePanel } from "@/components/exposure-panel";
import { DashboardSignalsPanel } from "@/components/dashboard-signals-panel";
import type { DeepSignals, LeaderboardBoard } from "@/lib/juicychat/deep-signals";
import { deriveCommentPulse, recentComments } from "@/lib/juicychat/comment-pulse";

const tooltipStyle = {
  background: "var(--color-surface)",
  border: "1px solid var(--color-border)",
  borderRadius: 10,
  fontSize: 12,
  color: "var(--color-fg)",
};

function Delta({ n }: { n: number | null | undefined }) {
  if (n == null || Number.isNaN(n) || n === 0) {
    return (
      <span className="inline-flex items-center gap-0.5 text-faint">
        <Minus className="size-3" />
        {formatDelta(n)}
      </span>
    );
  }
  if (n > 0) {
    return (
      <span className="inline-flex items-center gap-0.5 text-success">
        <ArrowUpRight className="size-3" />
        {formatDelta(n)}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-0.5 text-danger">
      <ArrowDownRight className="size-3" />
      {formatDelta(n)}
    </span>
  );
}

function Panel({
  title,
  icon,
  action,
  children,
  className = "",
}: {
  title: string;
  icon?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`min-w-0 max-w-full overflow-hidden rounded-2xl border border-border bg-surface/90 p-4 shadow-[0_0_0_1px_rgba(139,124,255,0.04)] sm:p-5 ${className}`}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          {icon}
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function KpiCard({
  label,
  value,
  delta,
  icon,
  accent,
}: {
  label: string;
  value: string;
  delta?: number | null;
  icon: ReactNode;
  accent?: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-gradient-to-b from-surface-2/80 to-surface/90 p-3.5 sm:p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="text-[11px] font-medium uppercase tracking-wider text-muted">{label}</div>
        <div className={`rounded-lg p-1.5 ${accent || "bg-primary/15 text-primary"}`}>{icon}</div>
      </div>
      <div className="mt-2 font-display text-2xl font-bold tracking-tight sm:text-3xl">{value}</div>
      {delta !== undefined ? (
        <div className="mt-1 text-xs">
          <Delta n={delta} /> <span className="text-faint">vs prior day</span>
        </div>
      ) : null}
    </div>
  );
}

export function CreatorDashboardView({
  dash,
  onTrackHint,
  onDashboard,
}: {
  dash: CreatorDashboard;
  onTrackHint?: () => void;
  onDashboard?: (d: CreatorDashboard) => void;
}) {
  const snap = dash.snapshot;
  const growth = dash.growth;
  const deep = dash.deep;
  const totals = snap?.totals;
  const dod = growth.dayOverDay;

  const daily = growth.dailyGrowth || [];
  const enrichMap = useMemo(() => {
    const m = new Map<string, (typeof deep extends null ? never : NonNullable<typeof deep>["botEnrichment"][0])>();
    deep?.botEnrichment.forEach((b) => m.set(b.characterId, b));
    return m;
  }, [deep]);

  const trending = deep?.leaderboards?.find((b) => b.id === "c_30d_all");
  const allTime = deep?.leaderboards?.find((b) => b.id === "c_all_all");

  const topBots = useMemo(() => {
    const bots = [...(snap?.bots || [])].sort((a, b) => (b.chatCount ?? 0) - (a.chatCount ?? 0));
    return bots.slice(0, 25);
  }, [snap]);

  const publishBuckets = dash.publish?.byDayOfWeek || [];

  const commentPulse = useMemo(
    () =>
      deriveCommentPulse({
        pulse: deep?.commentPulse,
        enrichment: deep?.botEnrichment,
        comments: dash.insights?.comments,
        bots: snap?.bots,
        limit: 12,
      }),
    [deep, dash.insights, snap],
  );
  const latestComments = useMemo(
    () => recentComments(dash.insights?.comments, 8),
    [dash.insights],
  );

  if (!snap) {
    return (
      <div className="space-y-5">
        <div className="rounded-2xl border border-dashed border-border bg-surface/50 px-6 py-16 text-center">
          <Sparkles className="mx-auto size-8 text-primary" />
          <h2 className="font-display mt-3 text-xl font-bold">No lounge data yet</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted">
            Connect JuicyChat and run a full refresh to build your creator dashboard — growth, ranks,
            tags, comments, and rivals.
          </p>
        </div>
        <DashboardSignalsPanel signals={dash.signals} />
      </div>
    );
  }

  return (
    <div className="min-w-0 max-w-full space-y-5 overflow-x-hidden">
      {/* KPI grid */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <KpiCard
          label="Chats"
          value={formatNum(totals?.chats)}
          delta={dod?.chats}
          icon={<MessageSquare className="size-4" />}
          accent="bg-chart-1/15 text-chart-1"
        />
        <KpiCard
          label="Likes"
          value={formatNum(totals?.likes)}
          delta={dod?.likes}
          icon={<Heart className="size-4" />}
          accent="bg-chart-2/15 text-chart-2"
        />
        <KpiCard
          label="Favorites"
          value={formatNum(totals?.favorites)}
          delta={dod?.favorites}
          icon={<Star className="size-4" />}
          accent="bg-chart-3/15 text-chart-3"
        />
        <KpiCard
          label="Followers"
          value={formatNum(totals?.followers)}
          delta={dod?.followers}
          icon={<Users className="size-4" />}
          accent="bg-chart-4/15 text-chart-4"
        />
        <KpiCard
          label="Bots"
          value={formatNum(totals?.bots)}
          delta={dod?.bots}
          icon={<Bot className="size-4" />}
        />
        <KpiCard
          label="Interactions"
          value={formatNum(totals?.interactions)}
          delta={dod?.interactions}
          icon={<Activity className="size-4" />}
          accent="bg-accent/15 text-accent"
        />
      </div>

      {dash.economy ? (
        <Panel
          title="Economy & inventory"
          icon={<Coins className="size-4 text-primary" />}
          action={
            <span className="text-[11px] text-muted">
              {dash.economy.vip.userVipId || "VIP"}
              {dash.economy.checkInStreak != null ? ` · check-in ${dash.economy.checkInStreak}` : ""}
            </span>
          }
        >
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
            {(
              [
                ["Coins", dash.economy.vip.coin, dash.economy.vip.vipMaxCoin != null ? `/ ${formatNum(dash.economy.vip.vipMaxCoin)}` : ""],
                ["Gems", dash.economy.vip.gems, "wallet"],
                ["Income gems", dash.economy.vip.incomeGems, "lifetime"],
                ["Frozen gems", dash.economy.vip.frozenGems, "locked"],
                ["Campaigns", dash.economy.campaignCount, "revenue"],
                ["Public figures", dash.economy.inventory.spaceFigures, "on space"],
              ] as const
            ).map(([label, value, sub]) => (
              <div key={label} className="rounded-xl border border-border/70 bg-bg/40 px-3 py-2">
                <div className="text-[10px] uppercase tracking-wide text-faint">{label}</div>
                <div className="text-lg font-semibold">{formatNum(value)}</div>
                <div className="text-[11px] text-muted">{sub}</div>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
            <span>
              Space · {formatNum(dash.economy.inventory.spacePublicChars)} public chars ·{" "}
              {formatNum(dash.economy.inventory.spaceGalleries)} galleries ·{" "}
              {formatNum(dash.economy.inventory.spacePublicImages)} images
            </span>
            <span>
              Memories · {formatNum(dash.economy.inventory.memoriesPublic)} public /{" "}
              {formatNum(dash.economy.inventory.memoriesPrivate)} private
            </span>
            <span>
              Owned · {formatNum(dash.economy.inventory.figuresOwned)} figures ·{" "}
              {formatNum(dash.economy.inventory.videosOwned)} videos ·{" "}
              {formatNum(dash.economy.inventory.genPicsOwned)} gen pics ·{" "}
              {formatNum(dash.economy.inventory.backpackItems)} backpack
            </span>
          </div>
          {dash.economy.vip.leftover && Object.keys(dash.economy.vip.leftover).length ? (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {Object.entries(dash.economy.vip.leftover)
                .slice(0, 12)
                .map(([k, v]) => (
                  <span
                    key={k}
                    className="rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-[11px] text-accent"
                  >
                    {k} · {String(v)}
                  </span>
                ))}
            </div>
          ) : null}
          {dash.economy.botSignals?.length ? (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[520px] text-left text-xs">
                <thead className="text-muted">
                  <tr className="border-b border-border">
                    <th className="py-1.5 pr-2 font-medium">Bot</th>
                    <th className="py-1.5 pr-2 font-medium">Shares</th>
                    <th className="py-1.5 pr-2 font-medium">Card length</th>
                    <th className="py-1.5 pr-2 font-medium">Gallery views</th>
                    <th className="py-1.5 font-medium">Campaign gems</th>
                  </tr>
                </thead>
                <tbody>
                  {dash.economy.botSignals.slice(0, 8).map((b) => (
                    <tr key={b.characterId} className="border-b border-border/40">
                      <td className="max-w-[240px] truncate py-1.5 pr-2 font-medium">{b.characterName}</td>
                      <td className="py-1.5 pr-2">{formatNum(b.shareCount)}</td>
                      <td className="py-1.5 pr-2">{formatNum(b.textLength)}</td>
                      <td className="py-1.5 pr-2">{formatNum(b.galleryPageView)}</td>
                      <td className="py-1.5">{formatNum(b.revenueGems)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </Panel>
      ) : null}

      <DashboardSignalsPanel signals={dash.signals} />

      {/* Quality strip */}
      {deep?.quality ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {[
            { l: "Avg score10", v: deep.quality.avgScore10 != null ? deep.quality.avgScore10.toFixed(1) : "—" },
            { l: "Median chats", v: formatNum(deep.quality.medianChats) },
            { l: "Top-10 share", v: formatPct(deep.quality.top10ChatShare, 0) },
            { l: "Engagement", v: formatPct(deep.quality.engagementRate, 1) },
            {
              l: "Trending",
              v: trending?.yourRank != null ? `#${trending.yourRank}` : "—",
            },
            {
              l: "All-time",
              v: allTime?.yourRank != null ? `#${allTime.yourRank}` : "—",
            },
          ].map((x) => (
            <div
              key={x.l}
              className="rounded-xl border border-border/80 bg-bg/40 px-3 py-2.5"
            >
              <div className="text-[10px] uppercase tracking-wide text-faint">{x.l}</div>
              <div className="mt-0.5 text-sm font-semibold">{x.v}</div>
            </div>
          ))}
        </div>
      ) : null}

      <div className="grid min-w-0 gap-5 lg:grid-cols-5">
        <Panel
          title="Daily growth"
          icon={<TrendingUp className="size-4 text-primary" />}
          className="lg:col-span-3"
          action={<span className="text-[11px] text-muted">{growth.daysTracked}d tracked</span>}
        >
          <div className="space-y-4">
            {(
              [
                ["interactions", "Δ Interactions", "var(--color-chart-1)"],
                ["likes", "Δ Likes", "var(--color-chart-2)"],
                ["chats", "Δ Chats", "var(--color-chart-3)"],
              ] as const
            ).map(([key, title, color]) => (
              <div key={key}>
                <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted">{title}</div>
                <div className="h-28 w-full sm:h-32">
                  {daily.length > 1 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={daily}>
                        <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="date" tick={{ fill: "var(--color-faint)", fontSize: 10 }} />
                        <YAxis tick={{ fill: "var(--color-faint)", fontSize: 10 }} width={36} />
                        <Tooltip contentStyle={tooltipStyle} />
                        <Line type="monotone" dataKey={key} stroke={color} strokeWidth={2} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex h-full items-center justify-center text-sm text-muted">
                      Need 2+ scrape days
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Panel>

        <Panel
          title="Signal mix"
          icon={<Flame className="size-4 text-accent" />}
          className="lg:col-span-2"
        >
          {dash.timing ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2 text-sm">
                {(
                  [
                    ["Likes", dash.timing.likeCount],
                    ["Favorites", dash.timing.favoriteCount],
                    ["Follows", dash.timing.followCount],
                    ["Comments", dash.timing.commentCount],
                    ["Gifts", dash.timing.giftCount],
                    ["Events", dash.timing.eventCount],
                  ] as const
                ).map(([l, v]) => (
                  <div key={l} className="rounded-lg bg-bg/50 px-2.5 py-2">
                    <div className="text-[10px] text-faint">{l}</div>
                    <div className="font-semibold">{formatNum(v)}</div>
                  </div>
                ))}
              </div>
              {dash.timing.overallBestSlots?.length ? (
                <div>
                  <div className="mb-1.5 text-[11px] font-medium text-muted">Best engagement slots</div>
                  <div className="flex flex-wrap gap-1.5">
                    {dash.timing.overallBestSlots.slice(0, 6).map((s) => (
                      <span
                        key={`${s.day}-${s.hour}`}
                        className="rounded-full border border-border bg-bg px-2 py-0.5 text-[11px]"
                      >
                        {s.label} · {formatNum(s.score)}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
              <Link to="/timing" className="text-xs font-medium text-primary hover:underline">
                Open full timing →
              </Link>
            </div>
          ) : (
            <p className="text-sm text-muted">Pull notifications to unlock engagement timing.</p>
          )}
        </Panel>
      </div>

      <RanklistPanel deep={deep} onDashboard={onDashboard} />

      <Panel
        title="Forensics"
        icon={<Fingerprint className="size-4 text-primary" />}
        action={
          <Link to="/forensics" className="text-xs font-medium text-primary hover:underline">
            Open forensics →
          </Link>
        }
      >
        <p className="text-sm text-muted">
          Tag popularity, warehouse creator overlap, and bot-level why-it-moved live on the Forensics
          tab. Open it to search the full catalog and see which tracked creators ride a tag.
        </p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {(snap.bots || [])
            .flatMap((b) => b.characterTags || [])
            .reduce<Array<{ tag: string; n: number }>>((acc, tag) => {
              const row = acc.find((x) => x.tag === tag);
              if (row) row.n += 1;
              else acc.push({ tag, n: 1 });
              return acc;
            }, [])
            .sort((a, b) => b.n - a.n)
            .slice(0, 10)
            .map((t) => (
              <span
                key={t.tag}
                className="rounded-full border border-border bg-bg/50 px-2 py-0.5 text-[11px] text-muted"
              >
                {t.tag} · {t.n}
              </span>
            ))}
        </div>
      </Panel>

      <BotPerformancePanel growth={growth} bots={snap.bots || []} />

      <ProductionYieldPanel
        bots={snap.bots || []}
        growth={growth}
        enrichment={deep?.botEnrichment}
      />

      <ExposurePanel
        bots={snap.bots || []}
        insights={dash.insights}
        commentPulse={commentPulse}
      />

      <div className="grid min-w-0 gap-5 lg:grid-cols-5">
        <Panel
          title="Bot portfolio"
          icon={<Bot className="size-4 text-primary" />}
          className="lg:col-span-3"
          action={
            <span className="text-[11px] text-muted">
              {totals?.publicBots ?? 0} public · {totals?.privateBots ?? 0} private
            </span>
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-xs">
              <thead className="text-muted">
                <tr className="border-b border-border">
                  <th className="py-2 pr-2 font-medium">Bot</th>
                  <th className="py-2 pr-2 font-medium">Chats</th>
                  <th className="py-2 pr-2 font-medium">Likes</th>
                  <th className="py-2 pr-2 font-medium">Score</th>
                  <th className="py-2 pr-2 font-medium">Comments</th>
                  <th className="py-2 pr-2 font-medium">Chats/day</th>
                  <th className="py-2 font-medium">Tags</th>
                </tr>
              </thead>
              <tbody>
                {topBots.map((b) => {
                  const e = enrichMap.get(b.characterId);
                  return (
                    <tr key={b.characterId} className="border-b border-border/50">
                      <td className="max-w-[160px] truncate py-2 pr-2 font-medium">{b.characterName}</td>
                      <td className="py-2 pr-2 font-semibold">{formatNum(b.chatCount)}</td>
                      <td className="py-2 pr-2">{formatNum(b.likeCount)}</td>
                      <td className="py-2 pr-2">{e?.detailScore10 ?? b.score10 ?? "—"}</td>
                      <td className="py-2 pr-2">{formatNum(e?.commentCount)}</td>
                      <td className="py-2 pr-2">
                        {e?.chatsPerDay != null ? e.chatsPerDay.toFixed(1) : "—"}
                      </td>
                      <td className="max-w-[140px] truncate py-2 text-muted">
                        {(e?.tags || b.characterTags || []).slice(0, 3).join(", ") || "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel
          title="Comment pulse"
          icon={<MessageSquare className="size-4 text-chart-2" />}
          className="lg:col-span-2"
          action={
            commentPulse.length ? (
              <span className="text-[11px] text-muted">
                {commentPulse.length} bot{commentPulse.length === 1 ? "" : "s"}
              </span>
            ) : null
          }
        >
          {commentPulse.length ? (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2 text-sm">
                {(
                  [
                    [
                      "Comments",
                      commentPulse.reduce((s, c) => s + (c.approxTotal ?? c.commentsFetched), 0),
                    ],
                    ["Bots", commentPulse.length],
                    [
                      "Likes on them",
                      commentPulse.reduce((s, c) => s + (c.likesOnComments || 0), 0),
                    ],
                  ] as const
                ).map(([label, value]) => (
                  <div key={label} className="rounded-lg bg-bg/50 px-2.5 py-2">
                    <div className="text-[10px] text-faint">{label}</div>
                    <div className="font-semibold">{formatNum(value)}</div>
                  </div>
                ))}
              </div>
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={commentPulse.slice(0, 8).map((c) => ({
                      name:
                        c.characterName.length > 18
                          ? `${c.characterName.slice(0, 17)}…`
                          : c.characterName,
                      comments: c.approxTotal ?? c.commentsFetched,
                    }))}
                    layout="vertical"
                    margin={{ left: 4, right: 12, top: 4, bottom: 0 }}
                  >
                    <XAxis type="number" tick={{ fill: "var(--color-faint)", fontSize: 10 }} />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={108}
                      tick={{ fill: "var(--color-muted)", fontSize: 10 }}
                    />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Bar dataKey="comments" fill="var(--color-chart-2)" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              {latestComments.length ? (
                <div>
                  <div className="mb-1.5 text-[11px] font-medium text-muted">Latest comments</div>
                  <ul className="space-y-1">
                    {latestComments.map((c) => (
                      <li
                        key={c.messageId || `${c.characterId}-${c.ts}-${c.senderName}`}
                        className="flex items-baseline justify-between gap-2 text-xs"
                      >
                        <span className="min-w-0 truncate">
                          <span className="font-medium text-fg">{c.senderName || "Someone"}</span>
                          <span className="text-faint"> on </span>
                          <span className="text-muted">{c.characterName}</span>
                        </span>
                        <span className="shrink-0 text-[10px] text-faint">{formatWhen(c.ts)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <p className="text-[11px] text-faint">
                Named comments from the notification archive
                {deep?.commentPulse?.some((c) => c.likesOnComments > 0)
                  ? ", merged with live comment-page likes"
                  : ""}
                .
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted">
              No comments in the archive yet. They appear after a lounge refresh while JuicyChat is
              connected.
            </p>
          )}
        </Panel>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Publish day effect" icon={<Award className="size-4 text-chart-5" />}>
          {publishBuckets.length ? (
            <div className="h-52">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={publishBuckets.map((b) => ({
                    day: b.label || String(b.key),
                    chatsPerDay: Number(Number(b.avgChatsPerDay || 0).toFixed(1)),
                    n: b.n ?? 0,
                  }))}
                >
                  <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="day" tick={{ fill: "var(--color-faint)", fontSize: 10 }} />
                  <YAxis tick={{ fill: "var(--color-faint)", fontSize: 10 }} width={36} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Bar dataKey="chatsPerDay" fill="var(--color-chart-5)" radius={[4, 4, 0, 0]}>
                    {publishBuckets.map((_, i) => (
                      <Cell key={i} fill="var(--color-chart-5)" fillOpacity={0.55 + (i % 3) * 0.15} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-sm text-muted">Publish timestamps missing on bots.</p>
          )}
        </Panel>

        <Panel
          title="Rival radar"
          icon={<Crosshair className="size-4 text-primary" />}
          action={
            <Link to="/stalker" className="text-xs font-medium text-primary hover:underline">
              Radar →
            </Link>
          }
        >
          {dash.rivals.compare.rows.length > 1 || dash.rivals.file.rivals.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-muted">
                  <tr className="border-b border-border">
                    <th className="py-1.5 pr-2">30d</th>
                    <th className="py-1.5 pr-2">Creator</th>
                    <th className="py-1.5 pr-2">Chats</th>
                    <th className="py-1.5 pr-2">Δ day</th>
                    <th className="py-1.5">30d launches</th>
                  </tr>
                </thead>
                <tbody>
                  {dash.rivals.compare.rows.slice(0, 8).map((r) => (
                    <tr key={r.userId} className={`border-b border-border/40 ${r.isYou ? "bg-primary/10" : ""}`}>
                      <td className="py-1.5 pr-2 text-muted">{r.rank30d != null ? `#${r.rank30d}` : "—"}</td>
                      <td className="py-1.5 pr-2 font-medium">
                        {r.isYou ? "You · " : ""}
                        {r.userName}
                        {!r.isYou && r.source === "neighbor" ? (
                          <span className="ml-1 text-[10px] text-accent">auto</span>
                        ) : null}
                      </td>
                      <td className="py-1.5 pr-2">{formatNum(r.totals.chats)}</td>
                      <td className="py-1.5">
                        <Delta n={r.dayOverDay?.chats} />
                      </td>
                      <td className="py-1.5 text-muted">{r.launches30 != null ? r.launches30 : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-sm text-muted">
              30-day neighbours appear after a ranklist.{" "}
              <Link to="/stalker" className="font-medium text-primary hover:underline" onClick={onTrackHint}>
                Open radar
              </Link>
            </div>
          )}
        </Panel>
      </div>

      {/* Discovery + insights strip */}
      {dash.insights?.discovery ? (
        <Panel title="Discovery placement" icon={<Sparkles className="size-4 text-primary" />}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {(dash.insights.discovery.feeds || []).map((f) => (
              <div key={f.id} className="rounded-xl border border-border/70 bg-bg/40 p-3">
                <div className="text-xs font-semibold">{f.label}</div>
                <div className="mt-1 text-[11px] text-muted">
                  {f.hits?.length
                    ? f.hits
                        .slice(0, 3)
                        .map((h) => `#${h.rank} ${h.characterName}`)
                        .join(" · ")
                    : "No bots in scanned pages"}
                </div>
              </div>
            ))}
          </div>
          <Link to="/insights" className="mt-3 inline-block text-xs font-medium text-primary hover:underline">
            Full insights →
          </Link>
        </Panel>
      ) : null}

      {dash.warnings?.length ? (
        <details className="rounded-xl border border-warning/30 bg-warning/5 px-4 py-3 text-xs text-muted">
          <summary className="cursor-pointer font-medium text-warning">
            {dash.warnings.length} scrape notes
          </summary>
          <ul className="mt-2 list-disc space-y-1 pl-4">
            {dash.warnings.slice(0, 20).map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </details>
      ) : null}

      <p className="text-center text-[11px] text-faint">
        Dashboard · {formatWhen(dash.scrapedAt)} · source {dash.source}
        {deep ? ` · deep ${formatWhen(deep.scrapedAt)}` : ""}
      </p>
    </div>
  );
}

function boardRows(b: LeaderboardBoard) {
  const rows = (b.listings && b.listings.length
    ? b.listings
    : b.aroundYou && b.aroundYou.length
      ? b.aroundYou
      : b.top) || [];
  return rows;
}

function RanklistPanel({
  deep,
  onDashboard,
}: {
  deep: DeepSignals | null | undefined;
  onDashboard?: (d: CreatorDashboard) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const refresh = async () => {
    setBusy(true);
    setErr(null);
    try {
      const next = (await refreshRanklistBoards()) as CreatorDashboard;
      onDashboard?.(next);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const boards = deep?.leaderboards || [];
  const hasListings = boards.some(
    (b) => (b.listings || b.aroundYou || b.top || []).length > 0 || (b.scanned || 0) > 0,
  );

  return (
    <Panel
      title="Ranklist boards"
      icon={<Trophy className="size-4 text-warning" />}
      action={
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={busy}
          className="inline-flex items-center gap-1 rounded-lg border border-border bg-bg px-2 py-1 text-[11px] font-medium text-muted hover:text-fg disabled:opacity-60"
        >
          {busy ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
          Refresh ranks
        </button>
      }
    >
      <div className="space-y-4">
        <p className="text-[11px] text-muted">
          Same boards as juicychat.ai/ranklistpage — trending (~39-day) and all-time, ALL / NEW.
          Rank is list position (not the gapped API <code>ranking</code> field).
        </p>
        {err ? <p className="text-xs text-danger">{err}</p> : null}
        {!deep || !hasListings ? (
          <p className="text-sm text-muted">
            No listings yet. Use Refresh ranks — this hits the four creator boards directly.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {boards.map((b) => {
              const rows = boardRows(b);
              return (
                <div key={b.id} className="rounded-xl border border-border/70 bg-bg/40 p-3">
                  <div className="text-[11px] font-medium uppercase tracking-wide text-muted">
                    {b.period} · {b.cohort}
                  </div>
                  <div className="mt-1 flex items-baseline justify-between gap-2">
                    <div className="text-xl font-extrabold text-primary">
                      {b.yourRank != null ? `#${b.yourRank}` : `Not in top ${b.scanned || 0}`}
                    </div>
                    <div className="text-[10px] text-faint">{formatNum(b.scanned)} listed</div>
                  </div>
                  {b.yourScore != null ? (
                    <div className="text-[11px] text-muted">score {formatNum(Math.round(b.yourScore))}</div>
                  ) : null}
                  <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto">
                    {rows.length ? (
                      rows.map((r) => (
                        <li
                          key={`${b.id}-${r.userId}-${r.rank}`}
                          className={`flex items-center justify-between gap-2 rounded-lg px-2 py-1 text-xs ${
                            r.isYou ? "bg-primary/15 ring-1 ring-primary/30" : "bg-bg/50"
                          }`}
                        >
                          <span className="truncate">
                            #{r.rank} {r.isYou ? "You · " : ""}@{r.userName}
                          </span>
                          <span className="shrink-0 text-muted">
                            {r.score != null ? formatNum(Math.round(r.score)) : formatNum(r.chatCount)}
                          </span>
                        </li>
                      ))
                    ) : (
                      <li className="px-2 py-1 text-xs text-muted">No rows returned.</li>
                    )}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
        {deep?.monthlyNew?.length ? (
          <div>
            <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted">
              Monthly NEW (featured since May 2026)
            </div>
            <ul className="space-y-1">
              {deep.monthlyNew.map((m) => (
                <li key={m.rankingDate} className="flex justify-between text-sm">
                  <span>{m.label}</span>
                  <span className="font-semibold text-primary">#{m.yourRank}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <div>
          <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted">
            Your bots on character boards
          </div>
          {(deep?.characterBoards || []).some((cb) => cb.own.length) ? (
            (deep?.characterBoards || []).map((cb) =>
              cb.own.length ? (
                <div key={cb.id} className="mb-2">
                  <div className="text-[11px] text-muted">{cb.label}</div>
                  <ul className="space-y-1">
                    {cb.own.slice(0, 8).map((r) => (
                      <li key={r.characterId} className="flex justify-between text-sm">
                        <span>
                          #{r.rank} {r.characterName}
                        </span>
                        <span className="text-muted">{formatNum(r.chatCount)} chats</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null,
            )
          ) : deep?.ownCharacterRanks?.length ? (
            <ul className="space-y-1.5">
              {deep.ownCharacterRanks.slice(0, 8).map((r) => (
                <li key={r.characterId} className="flex justify-between text-sm">
                  <span>
                    #{r.rank} {r.characterName}
                  </span>
                  <span className="text-muted">{formatNum(r.chatCount)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted">None of your bots in the scanned character pages.</p>
          )}
        </div>
      </div>
    </Panel>
  );
}
