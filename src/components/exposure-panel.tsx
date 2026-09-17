import { useMemo, useState } from "react";
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
import { Eye, Gem, Megaphone, Search, Sparkles, TrendingUp } from "lucide-react";
import type { JuicyBot } from "@/lib/juicychat/types";
import type { CommentPulse } from "@/lib/juicychat/deep-signals";
import {
  EXPOSURE_LABEL,
  analyzeExposure,
  formatExposureRatio,
  formatLiftPts,
  type ExposureDepth,
  type ExposureDiscovery,
  type ExposureRow,
  type ExposureStatus,
} from "@/lib/juicychat/exposure";
import { formatNum, formatPct } from "@/lib/juicychat/format";
import { formatScore10 } from "@/lib/juicychat/production";

const tooltipStyle = {
  background: "var(--color-surface)",
  border: "1px solid var(--color-border)",
  borderRadius: 10,
  fontSize: 12,
  color: "var(--color-fg)",
};

type Filter = "all" | "gem" | "over" | "amplified" | "feed-heavy";

function shortName(name: string, n = 22) {
  const s = name.replace(/\s+/g, " ").trim();
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function tone(s: ExposureStatus) {
  if (s === "gem") return "border-success/30 bg-success/10 text-success";
  if (s === "over") return "border-primary/30 bg-primary/10 text-primary";
  if (s === "amplified") return "border-chart-2/40 bg-chart-2/15 text-chart-2";
  if (s === "feed-heavy") return "border-warning/30 bg-warning/10 text-warning";
  return "border-border bg-bg/40 text-faint";
}

function feedLabel(r: ExposureRow) {
  if (!r.feeds.length) return "—";
  return r.feeds
    .map((f) => {
      const rank = r.ranks[f];
      return rank != null ? `${f} #${rank}` : f;
    })
    .join(" · ");
}

export function ExposurePanel({
  bots,
  insights,
  commentPulse,
}: {
  bots: JuicyBot[];
  insights?: { discovery?: ExposureDiscovery; botDepth?: ExposureDepth } | null;
  commentPulse?: CommentPulse[] | null;
}) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const commentCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const c of commentPulse || []) {
      m[c.characterId] = Math.max(m[c.characterId] || 0, c.approxTotal ?? c.commentsFetched);
    }
    return m;
  }, [commentPulse]);

  const report = useMemo(
    () =>
      analyzeExposure({
        bots,
        discovery: insights?.discovery,
        botDepth: insights?.botDepth,
        commentCounts,
      }),
    [bots, insights, commentCounts],
  );

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    let list = report.rows;
    if (filter !== "all") list = list.filter((r) => r.status === filter);
    if (s) {
      list = list.filter(
        (r) =>
          r.characterName.toLowerCase().includes(s) ||
          EXPOSURE_LABEL[r.status].toLowerCase().includes(s) ||
          r.feeds.some((f) => f.includes(s)),
      );
    }
    return list;
  }, [report.rows, q, filter]);

  const chart = (filter === "gem"
    ? report.gems
    : filter === "over"
      ? report.overperformers
      : filter === "amplified"
        ? report.amplified
        : filter === "feed-heavy"
          ? report.feedHeavy
          : report.rows
  )
    .slice(0, 8)
    .map((r) => ({
      name: shortName(r.characterName, 16),
      lift: Number((r.lift * 100).toFixed(0)),
      ratio: Number(Math.min(r.ratio, 20).toFixed(1)),
    }));

  if (!bots.length) return null;

  const chips: Array<{ id: Filter; label: string; n: number; icon: typeof Gem }> = [
    { id: "all", label: "All public", n: report.pool, icon: Eye },
    { id: "gem", label: "Gems", n: report.counts.gem, icon: Gem },
    { id: "over", label: "Overperformers", n: report.counts.over, icon: TrendingUp },
    { id: "amplified", label: "Amplified", n: report.counts.amplified, icon: Megaphone },
    { id: "feed-heavy", label: "Feed-heavy", n: report.counts["feed-heavy"], icon: Sparkles },
  ];

  return (
    <section className="min-w-0 max-w-full overflow-hidden rounded-2xl border border-border bg-surface/90 p-4 shadow-[0_0_0_1px_rgba(139,124,255,0.04)] sm:p-5">
      <div className="mb-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          <Gem className="size-4 text-success" />
          Exposure-adjusted performance
        </h2>
        <p className="mt-1 max-w-3xl text-xs text-muted">
          Chat percentile versus discovery percentile — a relative measure, not JuicyChat's
          formula. Expected chats are the roster quantile at the same discovery rank. Gems are high
          quality or attachment with almost no feed presence (highest-value to push). Overperformers
          convert without the feed. Amplified bots are on a feed and converting with it.
        </p>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {(
          [
            ["Underexposed gems", report.counts.gem, "high quality, low discovery", "text-success"],
            ["Overperformers", report.counts.over, "chats ≫ expected", "text-primary"],
            ["Platform-amplified", report.counts.amplified, "high feed + high chats", "text-chart-2"],
            [
              "On a feed",
              report.listed,
              `of ${report.pool} public · median unlisted ${formatNum(report.medianUnexposedChats)} chats`,
              "text-fg",
            ],
          ] as const
        ).map(([l, v, sub, color]) => (
          <div key={l} className="rounded-xl border border-border/70 bg-bg/40 px-2.5 py-2">
            <div className="text-[10px] uppercase tracking-wide text-faint">{l}</div>
            <div className={`text-lg font-semibold ${color}`}>{formatNum(v)}</div>
            <div className="text-[11px] text-muted">{sub}</div>
          </div>
        ))}
      </div>

      <div className="mb-3 flex flex-wrap gap-1.5">
        {chips.map((c) => {
          const Icon = c.icon;
          const on = filter === c.id;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => setFilter(c.id)}
              className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] ${
                on ? "border-primary/40 bg-primary/15 text-fg" : "border-border bg-bg/40 text-muted"
              }`}
            >
              <Icon className="size-3" />
              {c.label} · {c.n}
            </button>
          );
        })}
      </div>

      {chart.length > 2 ? (
        <div className="mb-4 h-40">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chart} margin={{ left: 0, right: 8 }}>
              <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="name" tick={{ fill: "var(--color-faint)", fontSize: 9 }} interval={0} />
              <YAxis tick={{ fill: "var(--color-faint)", fontSize: 10 }} width={32} />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(v, name) =>
                  name === "lift" ? [`${v} pts`, "lift"] : [`${v}x`, "ratio (capped)"]
                }
              />
              <Bar dataKey="lift" radius={[4, 4, 0, 0]}>
                {chart.map((_, i) => (
                  <Cell key={i} fill="var(--color-chart-4)" fillOpacity={0.55 + (i % 4) * 0.12} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : null}

      <div className="relative mb-2">
        <Search className="pointer-events-none absolute left-2.5 top-2.5 size-3.5 text-faint" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search bots, feeds, or status"
          className="w-full rounded-lg border border-border bg-bg px-8 py-2 text-sm outline-none focus:border-primary"
        />
      </div>

      <div className="max-h-[28rem] overflow-auto">
        <table className="w-full min-w-[820px] text-left text-xs">
          <thead className="sticky top-0 bg-surface text-muted">
            <tr className="border-b border-border">
              <th className="py-2 pr-2 font-medium">Bot</th>
              <th className="py-2 pr-2 font-medium">Chats</th>
              <th className="py-2 pr-2 font-medium">Expected</th>
              <th className="py-2 pr-2 font-medium">Ratio</th>
              <th className="py-2 pr-2 font-medium">Chat %</th>
              <th className="py-2 pr-2 font-medium">Disc %</th>
              <th className="py-2 pr-2 font-medium">Lift</th>
              <th className="py-2 pr-2 font-medium">Score</th>
              <th className="py-2 pr-2 font-medium">Feeds</th>
              <th className="py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.characterId} className="border-b border-border/40">
                <td className="max-w-[200px] truncate py-1.5 pr-2 font-medium" title={r.characterName}>
                  {r.characterName}
                </td>
                <td className="py-1.5 pr-2">{formatNum(r.chats)}</td>
                <td className="py-1.5 pr-2 text-muted">{formatNum(r.expectedChats)}</td>
                <td
                  className={`py-1.5 pr-2 font-semibold ${
                    r.ratio >= 2 ? "text-success" : r.ratio < 0.5 ? "text-danger" : ""
                  }`}
                >
                  {formatExposureRatio(r.ratio)}
                </td>
                <td className="py-1.5 pr-2">{formatPct(r.chatPct, 0)}</td>
                <td className="py-1.5 pr-2">{formatPct(r.exposurePct, 0)}</td>
                <td
                  className={`py-1.5 pr-2 ${
                    r.lift > 0.15 ? "text-success" : r.lift < -0.2 ? "text-danger" : "text-muted"
                  }`}
                >
                  {formatLiftPts(r.lift)}
                </td>
                <td className="py-1.5 pr-2">{formatScore10(r.score10)}</td>
                <td className="max-w-[160px] truncate py-1.5 pr-2 text-muted" title={feedLabel(r)}>
                  {feedLabel(r)}
                </td>
                <td className="py-1.5">
                  <span className={`rounded-full border px-1.5 py-0.5 text-[10px] ${tone(r.status)}`}>
                    {EXPOSURE_LABEL[r.status]}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] text-muted">
        Lift is chat percentile minus discovery percentile (percentage points). Discovery uses
        editor / trending / immersive / popular / recent / new ranks from the last insights scan
        {report.listed ? ` (${report.listed} of ${report.pool} currently listed)` : " (no bots in the scanned windows)"}.
        {q || filter !== "all" ? ` · ${rows.length} shown` : ` · ${report.pool} public bots`}.
      </p>
    </section>
  );
}
