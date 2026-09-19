import { useEffect, useMemo, useState } from "react";
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
import { GitCompare, Search, X } from "lucide-react";
import { formatDelta, formatNum, formatWhen } from "@/lib/juicychat/format";
import { dayKeyInZone, getDisplayTimezone } from "@/lib/juicychat/timezone";
import type { BotCatalogItem, BotGrowthRow, GrowthAnalysis, JuicyBot } from "@/lib/juicychat/types";

const LS_KEY = "juicy-bot-compare-ids";
const MAX_SELECTED = 8;
const COLORS = [
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
  "var(--color-chart-5)",
  "#c084fc",
  "#fb7185",
  "#34d399",
];

const tooltipStyle = {
  background: "var(--color-surface)",
  border: "1px solid var(--color-border)",
  borderRadius: 10,
  fontSize: 12,
  color: "var(--color-fg)",
};

type Metric = "chats" | "likes" | "favorites" | "interactions";

function loadSaved(): string[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String).slice(0, MAX_SELECTED) : [];
  } catch {
    return [];
  }
}

function saveIds(ids: string[]) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(ids));
  } catch {
    /* */
  }
}

function shortName(name: string, n = 22) {
  const s = name.replace(/\s+/g, " ").trim();
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

/** YYYY-MM-DD in the lounge timezone from gmtFirstPublish / gmtCreate. */
function publishedDay(v: string | number | null | undefined): string | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  const ms = n < 1e12 ? Math.round(n * 1000) : Math.round(n);
  try {
    return dayKeyInZone(new Date(ms), getDisplayTimezone());
  } catch {
    return null;
  }
}

function prettyDay(iso: string) {
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

export function BotPerformancePanel({
  growth,
  bots,
}: {
  growth: GrowthAnalysis;
  bots: JuicyBot[];
}) {
  const catalog: BotCatalogItem[] = useMemo(() => {
    if (growth.botCatalog?.length) return growth.botCatalog;
    return [...bots]
      .map((b) => ({
        characterId: b.characterId,
        characterName: b.characterName,
        characterThumb: b.characterThumb || b.characterPhoto,
        chats: b.chatCount ?? 0,
        likes: b.likeCount ?? 0,
        favorites: b.favoriteCount ?? 0,
        interactions: (b.chatCount ?? 0) + (b.likeCount ?? 0) + (b.favoriteCount ?? 0),
      }))
      .sort((a, b) => b.chats - a.chats);
  }, [growth.botCatalog, bots]);

  const byId = useMemo(() => {
    const m = new Map<string, BotCatalogItem>();
    for (const b of catalog) m.set(b.characterId, b);
    return m;
  }, [catalog]);

  const growthById = useMemo(() => {
    const m = new Map<string, BotGrowthRow>();
    for (const r of growth.botGrowth || []) m.set(r.characterId, r);
    return m;
  }, [growth.botGrowth]);

  const publishById = useMemo(() => {
    const m = new Map<string, string>();
    for (const b of bots) {
      const d = publishedDay(b.gmtFirstPublish) || publishedDay(b.gmtCreate);
      if (d) m.set(b.characterId, d);
    }
    return m;
  }, [bots]);

  const [query, setQuery] = useState("");
  const [metric, setMetric] = useState<Metric>("chats");
  const [deltaMode, setDeltaMode] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);

  useEffect(() => {
    const saved = loadSaved().filter((id) => byId.has(id) || catalog.some((c) => c.characterId === id));
    if (saved.length) {
      setSelected(saved);
      return;
    }
    setSelected(catalog.slice(0, 3).map((b) => b.characterId));
  }, [catalog, byId]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = prev.includes(id)
        ? prev.filter((x) => x !== id)
        : prev.length >= MAX_SELECTED
          ? prev
          : [...prev, id];
      saveIds(next);
      return next;
    });
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? catalog.filter((b) => b.characterName.toLowerCase().includes(q) || b.characterId.includes(q))
      : catalog;
    return list.slice(0, 80);
  }, [catalog, query]);

  const picks = selected.map((id) => byId.get(id)).filter((b): b is BotCatalogItem => Boolean(b));

  const timeline = growth.botTimeline || [];

  const cropStart = useMemo(() => {
    if (!selected.length) return null;
    let min: string | null = null;
    for (const id of selected) {
      const pub = publishById.get(id);
      if (pub && (!min || pub < min)) min = pub;
    }
    if (!min) {
      for (const day of timeline) {
        if (selected.some((id) => day.bots[id])) {
          min = day.date;
          break;
        }
      }
    }
    return min;
  }, [selected, publishById, timeline]);

  const cropped = useMemo(() => {
    if (!timeline.length) return timeline;
    let startIdx = 0;
    if (cropStart) {
      const from = timeline.findIndex((d) => d.date >= cropStart);
      if (from > 0) startIdx = from;
    }
    let slice = timeline.slice(startIdx);
    const firstPresent = slice.findIndex((d) => selected.some((id) => Boolean(d.bots[id])));
    if (firstPresent > 0) slice = slice.slice(firstPresent);
    return slice;
  }, [timeline, cropStart, selected]);

  const croppedFromWarehouse = Boolean(
    cropStart && timeline.length && cropped.length < timeline.length,
  );

  const chartData = useMemo(() => {
    if (cropped.length >= 2) {
      return cropped.map((day, i) => {
        const row: Record<string, string | number | null> = { date: day.date.slice(5) };
        for (const id of selected) {
          const start = publishById.get(id);
          if (start && day.date < start) {
            row[id] = null;
            continue;
          }
          const cur = day.bots[id];
          const val = cur?.[metric] ?? 0;
          if (deltaMode) {
            const prevDay = i > 0 ? cropped[i - 1] : undefined;
            const prevStart = start && prevDay && prevDay.date < start;
            const prev = prevDay && !prevStart ? prevDay.bots[id]?.[metric] ?? val : val;
            row[id] = val - prev;
          } else {
            row[id] = val;
          }
        }
        return row;
      });
    }
    return [
      Object.fromEntries([
        ["date", "now"],
        ...selected.map((id) => [id, byId.get(id)?.[metric] ?? 0]),
      ]) as Record<string, string | number | null>,
    ];
  }, [cropped, selected, metric, deltaMode, byId, publishById]);

  const canTrend = cropped.length >= 2;

  return (
    <section className="min-w-0 max-w-full overflow-hidden rounded-2xl border border-border bg-surface/90 p-4 shadow-[0_0_0_1px_rgba(139,124,255,0.04)] sm:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          <GitCompare className="size-4 text-primary" />
          Bot performance
        </h2>
        <span className="text-[11px] text-muted">
          {picks.length} selected · {catalog.length} bots
          {growth.latestScrapedAt ? ` · ${formatWhen(growth.latestScrapedAt)}` : ""}
        </span>
      </div>
      <p className="mb-3 text-[11px] text-muted">
        Pick any bots to compare chats, likes, favorites, and interactions over time. Daily pulls
        add a new point; select one bot for a close-up or several for a head-to-head. The chart
        starts at the earliest publish date among the selected bots.
      </p>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.4fr)]">
        <div className="min-w-0">
          <div className="relative mb-2">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 size-3.5 text-faint" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search bots"
              className="w-full rounded-xl border border-border bg-bg/60 py-2 pl-8 pr-3 text-sm outline-none focus:border-primary/60"
            />
          </div>
          <div className="mb-2 flex flex-wrap gap-1.5">
            <button
              type="button"
              className="rounded-full border border-border bg-bg px-2 py-0.5 text-[11px] text-muted hover:text-fg"
              onClick={() => {
                const ids = catalog.slice(0, 5).map((b) => b.characterId);
                setSelected(ids);
                saveIds(ids);
              }}
            >
              Top 5 chats
            </button>
            <button
              type="button"
              className="rounded-full border border-border bg-bg px-2 py-0.5 text-[11px] text-muted hover:text-fg"
              onClick={() => {
                setSelected([]);
                saveIds([]);
              }}
            >
              Clear
            </button>
          </div>
          {picks.length ? (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {picks.map((b, i) => (
                <button
                  key={b.characterId}
                  type="button"
                  onClick={() => toggle(b.characterId)}
                  className="inline-flex max-w-full items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[11px]"
                  style={{ boxShadow: `inset 0 -2px 0 ${COLORS[i % COLORS.length]}` }}
                >
                  <span className="truncate">{shortName(b.characterName, 28)}</span>
                  <X className="size-3 shrink-0 text-muted" />
                </button>
              ))}
            </div>
          ) : null}
          <div className="max-h-64 overflow-y-auto rounded-xl border border-border/70 bg-bg/40">
            {filtered.map((b) => {
              const on = selected.includes(b.characterId);
              return (
                <button
                  key={b.characterId}
                  type="button"
                  onClick={() => toggle(b.characterId)}
                  className={`flex w-full items-center justify-between gap-2 border-b border-border/40 px-2.5 py-1.5 text-left text-xs last:border-0 ${
                    on ? "bg-primary/15" : "hover:bg-elevated/60"
                  }`}
                >
                  <span className="min-w-0 truncate font-medium">{b.characterName}</span>
                  <span className="shrink-0 text-muted">{formatNum(b.chats)} chats</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap gap-1.5">
            {(["chats", "likes", "favorites", "interactions"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMetric(m)}
                className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium capitalize ${
                  metric === m && !deltaMode
                    ? "bg-primary text-primary-fg"
                    : "border border-border bg-bg text-muted"
                }`}
              >
                {m}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setDeltaMode((v) => !v)}
              className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
                deltaMode ? "bg-accent text-primary-fg" : "border border-border bg-bg text-muted"
              }`}
            >
              Daily Δ
            </button>
          </div>

          {!picks.length ? (
            <div className="flex h-56 items-center justify-center rounded-xl border border-dashed border-border text-sm text-muted">
              Select one or more bots to compare.
            </div>
          ) : (
            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                {canTrend && (deltaMode || cropped.length >= 2) ? (
                  <LineChart data={chartData}>
                    <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" vertical={false} />
                    <XAxis
                      dataKey="date"
                      tick={{ fill: "var(--color-faint)", fontSize: 10 }}
                      interval={cropped.length <= 14 ? 0 : "preserveStartEnd"}
                    />
                    <YAxis tick={{ fill: "var(--color-faint)", fontSize: 10 }} width={40} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Legend
                      wrapperStyle={{ fontSize: 11 }}
                      formatter={(value) => shortName(byId.get(String(value))?.characterName || String(value), 18)}
                    />
                    {selected.map((id, i) => (
                      <Line
                        key={id}
                        type="monotone"
                        dataKey={id}
                        name={id}
                        stroke={COLORS[i % COLORS.length]}
                        strokeWidth={2}
                        connectNulls={false}
                        dot={cropped.length < 10}
                      />
                    ))}
                  </LineChart>
                ) : (
                  <BarChart
                    data={picks.map((b) => ({
                      name: shortName(b.characterName, 14),
                      value: b[metric],
                    }))}
                  >
                    <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="name" tick={{ fill: "var(--color-faint)", fontSize: 10 }} interval={0} />
                    <YAxis tick={{ fill: "var(--color-faint)", fontSize: 10 }} width={40} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Bar dataKey="value" fill="var(--color-chart-1)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                )}
              </ResponsiveContainer>
            </div>
          )}
          {croppedFromWarehouse && cropped[0]?.date ? (
            <p className="mt-1 text-[11px] text-muted">
              Axis from {prettyDay(cropped[0].date)}
              {cropped[cropped.length - 1]?.date ? ` → ${prettyDay(cropped[cropped.length - 1]!.date)}` : ""}{" "}
              · earliest publish among selected
              {timeline.length - cropped.length > 0
                ? ` · hid ${timeline.length - cropped.length} empty warehouse days`
                : ""}
            </p>
          ) : !canTrend ? (
            <p className="mt-1 text-[11px] text-muted">
              Need two daily pulls for a trend line. Current totals are compared above — tomorrow’s
              scrape adds the second point.
            </p>
          ) : null}
        </div>
      </div>

      {picks.length ? (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[520px] text-left text-xs">
            <thead className="text-muted">
              <tr className="border-b border-border">
                <th className="py-2 pr-2 font-medium">Bot</th>
                <th className="py-2 pr-2 font-medium">Chats</th>
                <th className="py-2 pr-2 font-medium">Likes</th>
                <th className="py-2 pr-2 font-medium">Favs</th>
                <th className="py-2 pr-2 font-medium">Δ day chats</th>
                <th className="py-2 font-medium">Δ 7d chats</th>
              </tr>
            </thead>
            <tbody>
              {picks.map((b, i) => {
                const g = growthById.get(b.characterId);
                return (
                  <tr key={b.characterId} className="border-b border-border/40">
                    <td className="max-w-[220px] truncate py-2 pr-2 font-medium">
                      <span
                        className="mr-1.5 inline-block size-2 rounded-full"
                        style={{ background: COLORS[i % COLORS.length] }}
                      />
                      {b.characterName}
                    </td>
                    <td className="py-2 pr-2 font-semibold">{formatNum(b.chats)}</td>
                    <td className="py-2 pr-2">{formatNum(b.likes)}</td>
                    <td className="py-2 pr-2">{formatNum(b.favorites)}</td>
                    <td className="py-2 pr-2">{formatDelta(g?.dayOverDay?.chats)}</td>
                    <td className="py-2">{formatDelta(g?.last7Days?.chats)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {picks.length === 1 ? (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(
            [
              ["Chats", picks[0].chats, growthById.get(picks[0].characterId)?.dayOverDay?.chats],
              ["Likes", picks[0].likes, growthById.get(picks[0].characterId)?.dayOverDay?.likes],
              ["Favorites", picks[0].favorites, growthById.get(picks[0].characterId)?.dayOverDay?.favorites],
              [
                "Interactions",
                picks[0].interactions,
                growthById.get(picks[0].characterId)?.dayOverDay?.interactions,
              ],
            ] as const
          ).map(([l, v, d]) => (
            <div key={l} className="rounded-xl border border-border/70 bg-bg/40 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wide text-faint">{l}</div>
              <div className="text-lg font-semibold">{formatNum(v)}</div>
              <div className="text-[11px] text-muted">{formatDelta(d)} vs prior day</div>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
