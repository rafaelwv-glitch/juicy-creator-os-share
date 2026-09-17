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
import { Clock, Gauge, Image, Search, Timer } from "lucide-react";
import type { JuicyBot, GrowthAnalysis } from "@/lib/juicychat/types";
import type { BotEnrichment } from "@/lib/juicychat/deep-signals";
import {
  DEFAULT_HOURS,
  HOURS_OPTIONS,
  LIFECYCLE_LABEL,
  analyzeProduction,
  type HoursInvested,
  type LifecycleStatus,
  type ProductionRow,
} from "@/lib/juicychat/production";
import { formatDelta, formatNum, formatRate } from "@/lib/juicychat/format";

const tooltipStyle = {
  background: "var(--color-surface)",
  border: "1px solid var(--color-border)",
  borderRadius: 10,
  fontSize: 12,
  color: "var(--color-fg)",
};

type SortKey =
  | "chatsPerHour"
  | "favoritesPerHour"
  | "likesPerHour"
  | "chatsPerDay"
  | "acceleration"
  | "chats"
  | "score10"
  | "images"
  | "ageDays";

function lifeTone(s: LifecycleStatus) {
  if (s === "evergreen" || s === "rising" || s === "accelerating") {
    return "border-success/30 bg-success/10 text-success";
  }
  if (s === "launch" || s === "newborn") return "border-warning/30 bg-warning/10 text-warning";
  if (s === "cooling" || s === "quiet") return "border-danger/30 bg-danger/10 text-danger";
  if (s === "draft" || s === "unlisted") return "border-border bg-bg/40 text-faint";
  return "border-primary/25 bg-primary/10 text-primary";
}

function accelLabel(n: number | null) {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${(n * 100).toFixed(0)}%`;
}

function shortName(name: string, n = 28) {
  const s = name.replace(/\s+/g, " ").trim();
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function rowValue(r: ProductionRow, key: SortKey): number {
  if (key === "images") return r.images.weight;
  const v = r[key];
  return typeof v === "number" && Number.isFinite(v) ? v : -Infinity;
}

export function ProductionYieldPanel({
  bots,
  growth,
  enrichment,
}: {
  bots: JuicyBot[];
  growth?: GrowthAnalysis | null;
  enrichment?: BotEnrichment[] | null;
}) {
  const [hours, setHours] = useState<HoursInvested>(DEFAULT_HOURS);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<SortKey>("chatsPerHour");
  const [dir, setDir] = useState<"desc" | "asc">("desc");

  const report = useMemo(
    () => analyzeProduction({ bots, growth, enrichment, hours }),
    [bots, growth, enrichment, hours],
  );

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = s
      ? report.rows.filter(
          (r) =>
            r.characterName.toLowerCase().includes(s) ||
            LIFECYCLE_LABEL[r.lifecycle].toLowerCase().includes(s),
        )
      : report.rows;
    const mul = dir === "desc" ? -1 : 1;
    return [...list].sort((a, b) => mul * (rowValue(a, sort) - rowValue(b, sort)));
  }, [report.rows, q, sort, dir]);

  const clickSort = (key: SortKey) => {
    if (sort === key) setDir((d) => (d === "desc" ? "asc" : "desc"));
    else {
      setSort(key);
      setDir("desc");
    }
  };

  const lifeOrder: LifecycleStatus[] = [
    "launch",
    "rising",
    "accelerating",
    "evergreen",
    "steady",
    "cooling",
    "quiet",
    "newborn",
    "unlisted",
    "draft",
  ];
  const lifeBits = lifeOrder
    .map((k) => [k, report.lifecycle[k]] as const)
    .filter(([, n]) => n > 0);

  const chart = rows.slice(0, 8).map((r) => ({
    name: shortName(r.characterName, 16),
    chatsPerHour: Number(r.chatsPerHour.toFixed(1)),
  }));

  const Th = ({ k, children }: { k: SortKey; children: string }) => (
    <th className="py-2 pr-2 font-medium">
      <button type="button" onClick={() => clickSort(k)} className="hover:text-fg">
        {children}
        {sort === k ? (dir === "desc" ? " ↓" : " ↑") : ""}
      </button>
    </th>
  );

  if (!bots.length) return null;

  return (
    <section className="min-w-0 max-w-full overflow-hidden rounded-2xl border border-border bg-surface/90 p-4 shadow-[0_0_0_1px_rgba(139,124,255,0.04)] sm:p-5">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
            <Timer className="size-4 text-primary" />
            Production yield
          </h2>
          <p className="mt-1 max-w-xl text-xs text-muted">
            Each bot is {hours} hours of work. Lifetime chats, likes and stars divided by that cost,
            then current chats/day, recent acceleration, JuicyChat score, image spend, and where it
            sits in its life.
          </p>
        </div>
        <div className="flex rounded-lg border border-border bg-bg/40 p-0.5 text-[11px]">
          {HOURS_OPTIONS.map((h) => (
            <button
              key={h}
              type="button"
              onClick={() => setHours(h)}
              className={`rounded-md px-2.5 py-1 ${hours === h ? "bg-elevated text-fg" : "text-muted"}`}
            >
              {h}h
            </button>
          ))}
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {(
          [
            ["Hours in", formatRate(report.hoursInvested, 0), `${report.botCount} bots × ${hours}h`],
            ["Chats / hour", formatRate(report.chatsPerHour), `median ${formatRate(report.medianChatsPerHour)}`],
            ["Favs / hour", formatRate(report.favoritesPerHour), "lifetime stars"],
            ["Likes / hour", formatRate(report.likesPerHour), "lifetime likes"],
          ] as const
        ).map(([l, v, sub]) => (
          <div key={l} className="rounded-xl border border-border/70 bg-bg/40 px-2.5 py-2">
            <div className="text-[10px] uppercase tracking-wide text-faint">{l}</div>
            <div className="text-lg font-semibold">{v}</div>
            <div className="text-[11px] text-muted">{sub}</div>
          </div>
        ))}
      </div>

      {lifeBits.length ? (
        <div className="mb-4 flex flex-wrap gap-1.5">
          {lifeBits.map(([k, n]) => (
            <span
              key={k}
              className={`rounded-full border px-2 py-0.5 text-[11px] ${lifeTone(k)}`}
            >
              {LIFECYCLE_LABEL[k]} · {n}
            </span>
          ))}
        </div>
      ) : null}

      {chart.length > 2 ? (
        <div className="mb-4 h-40">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chart} margin={{ left: 0, right: 8 }}>
              <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="name" tick={{ fill: "var(--color-faint)", fontSize: 9 }} interval={0} />
              <YAxis tick={{ fill: "var(--color-faint)", fontSize: 10 }} width={36} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v) => formatRate(Number(v))} />
              <Bar dataKey="chatsPerHour" radius={[4, 4, 0, 0]}>
                {chart.map((_, i) => (
                  <Cell key={i} fill="var(--color-chart-1)" fillOpacity={0.55 + (i % 4) * 0.12} />
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
          placeholder="Search bots or lifecycle"
          className="w-full rounded-lg border border-border bg-bg px-8 py-2 text-sm outline-none focus:border-primary"
        />
      </div>

      <div className="max-h-[28rem] overflow-auto">
        <table className="w-full min-w-[760px] text-left text-xs">
          <thead className="sticky top-0 bg-surface text-muted">
            <tr className="border-b border-border">
              <th className="py-2 pr-2 font-medium">Bot</th>
              <Th k="chats">Chats</Th>
              <Th k="chatsPerHour">Chats/h</Th>
              <Th k="favoritesPerHour">Favs/h</Th>
              <Th k="likesPerHour">Likes/h</Th>
              <Th k="chatsPerDay">Chats/d</Th>
              <Th k="acceleration">Accel</Th>
              <Th k="score10">Score</Th>
              <Th k="images">Images</Th>
              <th className="py-2 font-medium">Life</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.characterId} className="border-b border-border/40">
                <td className="max-w-[180px] truncate py-1.5 pr-2 font-medium" title={r.characterName}>
                  {r.characterName}
                  {r.ageDays != null ? (
                    <span className="ml-1 text-[10px] font-normal text-faint">{r.ageDays.toFixed(0)}d</span>
                  ) : null}
                </td>
                <td className="py-1.5 pr-2">{formatNum(r.chats)}</td>
                <td className="py-1.5 pr-2 font-semibold">{formatRate(r.chatsPerHour)}</td>
                <td className="py-1.5 pr-2">{formatRate(r.favoritesPerHour)}</td>
                <td className="py-1.5 pr-2">{formatRate(r.likesPerHour)}</td>
                <td className="py-1.5 pr-2">
                  {r.recentChatsPerDay != null ? formatRate(r.recentChatsPerDay) : "—"}
                  {r.dChats != null ? (
                    <span className="ml-1 text-[10px] text-muted">{formatDelta(r.dChats)}</span>
                  ) : null}
                </td>
                <td
                  className={`py-1.5 pr-2 ${
                    r.acceleration == null
                      ? "text-muted"
                      : r.acceleration > 0.08
                        ? "text-success"
                        : r.acceleration < -0.15
                          ? "text-danger"
                          : "text-muted"
                  }`}
                >
                  {accelLabel(r.acceleration)}
                </td>
                <td className="py-1.5 pr-2">{r.scoreLabel}</td>
                <td className="max-w-[110px] truncate py-1.5 pr-2 text-muted" title={r.images.label}>
                  {r.images.label}
                </td>
                <td className="py-1.5">
                  <span className={`rounded-full border px-1.5 py-0.5 text-[10px] ${lifeTone(r.lifecycle)}`}>
                    {LIFECYCLE_LABEL[r.lifecycle]}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 flex items-center gap-3 text-[11px] text-muted">
        <Clock className="size-3" />
        Cost is time only ({hours}h / bot) — not gems.
        <Gauge className="size-3" />
        Accel = last 7 days vs lifetime chats/day.
        <Image className="size-3" />
        Images = gen pics + gallery + memories + figure
        {q ? ` · ${rows.length} shown` : ` · ${report.botCount} bots`}.
      </p>
    </section>
  );
}
