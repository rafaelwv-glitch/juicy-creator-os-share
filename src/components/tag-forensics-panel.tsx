import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AlertTriangle,
  Clock,
  Layers,
  Search,
  Sparkles,
  Tags,
  TrendingUp,
  Users,
  X,
} from "lucide-react";
import { formatDelta, formatNum, formatPct } from "@/lib/juicychat/format";
import {
  comboMatchesQuery,
  suggestTags,
  tagMatchesQuery,
  type TagCatalogEntry,
  type TagForensics,
  type TagGapRow,
  type TagSuggest,
  type TagTrafficRow,
} from "@/lib/juicychat/tag-forensics-view";

const tooltipStyle = {
  background: "var(--color-surface)",
  border: "1px solid var(--color-border)",
  borderRadius: 10,
  fontSize: 12,
  color: "var(--color-fg)",
};

type Tab = "traffic" | "when" | "combos" | "gaps" | "popular" | "market";

function Spark({ series }: { series: TagTrafficRow["series"] }) {
  const max = Math.max(1, ...series.map((p) => p.gain));
  return (
    <div className="flex h-6 items-end gap-px" aria-hidden>
      {series.map((p) => (
        <span
          key={p.date}
          className="w-1.5 rounded-sm bg-chart-4/80"
          style={{ height: `${Math.max(8, Math.round((p.gain / max) * 100))}%` }}
          title={`${p.date} · +${p.gain}`}
        />
      ))}
    </div>
  );
}

function liftClass(lift: number) {
  if (lift >= 1.15) return "text-success";
  if (lift < 0.85) return "text-danger";
  return "text-muted";
}

function badgeClass(b: string) {
  if (b === "over") return "border-danger/40 bg-danger/10 text-danger";
  if (b === "under") return "border-success/40 bg-success/10 text-success";
  if (b === "unused") return "border-warning/40 bg-warning/10 text-warning";
  if (b === "official") return "border-primary/30 bg-primary/10 text-primary";
  return "border-border bg-bg/60 text-muted";
}

function coverageLabel(c: TagCatalogEntry["coverage"]) {
  if (c === "overserved") return "overserved";
  if (c === "underserved") return "underserved";
  if (c === "unused") return "unused";
  return null;
}

function GapCard({
  row,
  onPick,
}: {
  row: TagGapRow;
  onPick: (row: TagGapRow) => void;
}) {
  const over = row.kind === "overserved";
  return (
    <button
      type="button"
      onClick={() => onPick(row)}
      className="w-full rounded-xl border border-border/70 bg-bg/40 p-3 text-left hover:border-primary/40"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
            over ? "bg-danger/15 text-danger" : "bg-success/15 text-success"
          }`}
        >
          {row.tag}
        </span>
        <span className={`text-xs ${over ? "text-danger" : "text-success"}`}>
          {row.subject === "combo" ? "combo" : "tag"} · {row.lift.toFixed(2)}×
        </span>
      </div>
      <p className="mt-2 text-[12px] text-muted">{row.why}</p>
      {row.names?.length ? (
        <p className="mt-1 truncate text-[11px] text-faint">{row.names.join(" · ")}</p>
      ) : null}
    </button>
  );
}

export function TagForensicsPanel({ forensic }: { forensic: TagForensics | null | undefined }) {
  const [tab, setTab] = useState<Tab>("traffic");
  const [picked, setPicked] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  const catalog = forensic?.catalog || [];
  const traffic = forensic?.traffic || [];
  const combos = forensic?.combos || [];
  const whenAll = forensic?.when || [];
  const popularity = forensic?.popularity || [];
  const q = query.trim();
  const searching = q.length > 0;

  const suggestions = useMemo(
    () => suggestTags(catalog, combos, query, 12),
    [catalog, combos, query],
  );

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const pickSuggest = (s: TagSuggest) => {
    if (s.kind === "combo" && s.pair) {
      setQuery(`${s.pair.a} × ${s.pair.b}`);
      setPicked(s.pair.a);
      setTab("combos");
    } else {
      setQuery(s.tag || s.label);
      setPicked(s.tag || s.label);
    }
    setOpen(false);
  };

  const pickGap = (row: TagGapRow) => {
    if (row.subject === "combo" && row.pair) {
      setQuery(`${row.pair.a} × ${row.pair.b}`);
      setPicked(row.pair.a);
      setTab("combos");
    } else {
      setQuery(row.tag);
      setPicked(row.tag);
      setTab("traffic");
    }
  };

  const trafficShown = searching
    ? traffic.filter((t) => tagMatchesQuery(t.tag, q))
    : traffic.slice(0, 16);
  const comboShown = searching
    ? combos.filter((c) => comboMatchesQuery(c.a, c.b, q))
    : combos.slice(0, 16);
  const whenShown = searching
    ? whenAll.filter((w) => tagMatchesQuery(w.tag, q))
    : whenAll.slice(0, 12);
  const popularShown = searching
    ? popularity.filter((t) => tagMatchesQuery(t.tag, q))
    : popularity.slice(0, 16);
  const marketShown = searching
    ? catalog.filter((t) => t.marketN > 0 || t.rivalBots > 0 || t.yours).filter((t) => tagMatchesQuery(t.tag, q))
    : catalog.filter((t) => t.marketN > 0 || t.rivalBots > 0 || t.yours).slice(0, 10);

  const catalogHit =
    (picked && catalog.find((c) => c.tag === picked)) ||
    (q && catalog.find((c) => tagKeyEq(c.tag, q))) ||
    null;
  const selected =
    traffic.find((t) => t.tag === picked) ||
    trafficShown[0] ||
    traffic.find((t) => catalogHit && t.tag === catalogHit.tag) ||
    traffic[0] ||
    null;
  const whenRow =
    whenAll.find((w) => w.tag === selected?.tag) ||
    whenAll.find((w) => catalogHit && w.tag === catalogHit.tag) ||
    null;

  const popRow =
    popularity.find((p) => p.tag === selected?.tag) ||
    popularity.find((p) => catalogHit && p.tag === catalogHit.tag) ||
    popularShown[0] ||
    null;

  const tabs: Array<{ id: Tab; label: string; icon: typeof Tags }> = [
    { id: "traffic", label: "Traffic", icon: TrendingUp },
    { id: "when", label: "When", icon: Clock },
    { id: "combos", label: "Combos", icon: Layers },
    { id: "gaps", label: "Gaps", icon: Sparkles },
    { id: "popular", label: "Popular", icon: Users },
    { id: "market", label: "Market", icon: Tags },
  ];

  const empty =
    !traffic.length && !combos.length && !catalog.length && !popularity.length;

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) setOpen(true);
    if (!suggestions.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const s = suggestions[active] || suggestions[0];
      if (s) pickSuggest(s);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <section className="min-w-0 max-w-full overflow-hidden rounded-2xl border border-border bg-surface/90 p-4 shadow-[0_0_0_1px_rgba(139,124,255,0.04)] sm:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          <Tags className="size-4 text-chart-4" />
          Tag forensics
        </h2>
        <p className="text-[11px] text-muted">
          {formatNum(forensic?.catalogSize || catalog.length)} tags
          {forensic?.officialCount ? ` · ${formatNum(forensic.officialCount)} official` : ""}
          {forensic?.feedDays ? ` · ${forensic.feedDays} New days` : ""}
          {forensic?.daysTracked ? ` · ${forensic.daysTracked} warehouse days` : ""}
          {forensic?.timingEvents ? ` · ${formatNum(forensic.timingEvents)} like/star events` : ""}
        </p>
      </div>

      <p className="mb-3 text-[12px] text-muted">
        Search the full catalog — yours, official, New-feed, and neighbour tags. Popularity is New
        volume over time, correlated with creators already in the warehouse.
      </p>

      <div ref={boxRef} className="relative mb-3">
        <Search className="pointer-events-none absolute left-2.5 top-2.5 size-3.5 text-faint" />
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setActive(0);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKey}
          placeholder="Search any tag or pair — Romance, NTR × Slow Burn…"
          className="w-full rounded-xl border border-border bg-bg/60 py-2 pl-8 pr-9 text-sm outline-none focus:border-primary/60"
          autoComplete="off"
          spellCheck={false}
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
        />
        {query ? (
          <button
            type="button"
            className="absolute right-2 top-2 rounded p-0.5 text-faint hover:text-fg"
            onClick={() => {
              setQuery("");
              setPicked(null);
              setOpen(false);
            }}
            aria-label="Clear search"
          >
            <X className="size-3.5" />
          </button>
        ) : null}
        {open && suggestions.length ? (
          <ul
            role="listbox"
            className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-xl border border-border bg-surface p-1 shadow-lg"
          >
            {suggestions.map((s, i) => (
              <li key={`${s.kind}-${s.label}`}>
                <button
                  type="button"
                  role="option"
                  aria-selected={i === active}
                  className={`flex w-full items-start justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-xs ${
                    i === active ? "bg-primary/15" : "hover:bg-bg/60"
                  }`}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pickSuggest(s)}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{s.label}</span>
                    <span className="mt-0.5 block text-[11px] text-muted">{s.sub}</span>
                  </span>
                  <span className="flex shrink-0 flex-wrap justify-end gap-1">
                    {s.badges.map((b) => (
                      <span
                        key={b}
                        className={`rounded-full border px-1.5 py-0.5 text-[10px] ${badgeClass(b)}`}
                      >
                        {b}
                      </span>
                    ))}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {!searching && (forensic?.underserved[0] || forensic?.overserved[0]) ? (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {(forensic?.underserved || []).slice(0, 3).map((g) => (
            <button
              key={`u-${g.tag}`}
              type="button"
              onClick={() => pickGap(g)}
              className="rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-[11px] text-success"
            >
              under · {g.tag}
            </button>
          ))}
          {(forensic?.overserved || []).slice(0, 2).map((g) => (
            <button
              key={`o-${g.tag}`}
              type="button"
              onClick={() => pickGap(g)}
              className="rounded-full border border-danger/30 bg-danger/10 px-2 py-0.5 text-[11px] text-danger"
            >
              over · {g.tag}
            </button>
          ))}
        </div>
      ) : null}

      <div className="mb-4 flex flex-wrap gap-1 rounded-xl border border-border bg-bg/40 p-1">
        {tabs.map((t) => {
          const Icon = t.icon;
          const on = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-lg px-3 text-xs font-semibold sm:flex-none ${
                on ? "bg-elevated text-fg" : "text-muted hover:text-fg"
              }`}
            >
              <Icon className="size-3.5" />
              {t.label}
            </button>
          );
        })}
      </div>

      {empty ? (
        <p className="text-sm text-muted">
          No public tags in this warehouse yet. Refresh the lounge so bot tags and daily chats can
          land. Official catalog appears after a New scrape.
        </p>
      ) : null}

      {catalogHit && searching && !trafficShown.length && tab === "traffic" ? (
        <UnusedCard entry={catalogHit} />
      ) : null}

      {tab === "traffic" && trafficShown.length ? (
        <div className="grid gap-4 lg:grid-cols-[1fr_minmax(0,18rem)]">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-xs">
              <thead className="text-muted">
                <tr className="border-b border-border">
                  <th className="py-2 pr-2 font-medium">Tag</th>
                  <th className="py-2 pr-2 font-medium">7d chats</th>
                  <th className="py-2 pr-2 font-medium">30d</th>
                  <th className="py-2 pr-2 font-medium">Lift</th>
                  <th className="py-2 pr-2 font-medium">Peak</th>
                  <th className="py-2 font-medium">Flow</th>
                </tr>
              </thead>
              <tbody>
                {trafficShown.map((t) => (
                  <tr
                    key={t.tag}
                    className={`cursor-pointer border-b border-border/40 ${
                      selected?.tag === t.tag ? "bg-primary/10" : ""
                    }`}
                    onClick={() => setPicked(t.tag)}
                  >
                    <td className="max-w-[140px] truncate py-2 pr-2 font-medium">
                      {t.tag}
                      {coverageDot(catalog, t.tag)}
                    </td>
                    <td className="py-2 pr-2">{formatDelta(t.gain7)}</td>
                    <td className="py-2 pr-2 text-muted">{formatDelta(t.gain30)}</td>
                    <td className={`py-2 pr-2 ${liftClass(t.lift)}`}>{t.lift.toFixed(2)}×</td>
                    <td className="py-2 pr-2 text-muted">
                      {t.peakWeekday || "—"}
                      {t.peakHour != null ? ` ${String(t.peakHour).padStart(2, "0")}:00` : ""}
                    </td>
                    <td className="py-2">
                      <Spark series={t.series} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {searching ? (
              <p className="mt-2 text-[11px] text-faint">
                {trafficShown.length} match{trafficShown.length === 1 ? "" : "es"} of {traffic.length}{" "}
                warehouse tags
              </p>
            ) : traffic.length > 16 ? (
              <p className="mt-2 text-[11px] text-faint">
                Showing top 16 of {traffic.length}. Search to reach the rest of the catalog.
              </p>
            ) : null}
          </div>
          {selected ? (
            <div className="rounded-xl border border-border/70 bg-bg/40 p-3">
              <p className="text-[10px] uppercase tracking-wide text-faint">Selected</p>
              <p className="mt-1 text-sm font-semibold">{selected.tag}</p>
              <p className="mt-1 text-[12px] text-muted">
                {selected.bots} bot{selected.bots === 1 ? "" : "s"} · {formatNum(selected.chats)} chats
                stock · {selected.chatsPerDay.toFixed(1)} new chats / day
              </p>
              {catalogHit && catalogHit.tag === selected.tag ? (
                <p className="mt-1 text-[11px] text-muted">
                  {catalogHit.official ? "Official · " : ""}
                  {catalogHit.marketN ? `${catalogHit.marketN} new cards · ` : ""}
                  {catalogHit.rivalBots ? `${catalogHit.rivalBots} neighbour bots · ` : ""}
                  {coverageLabel(catalogHit.coverage) || "balanced"}
                </p>
              ) : null}
              <div className="mt-3 h-32">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={selected.series} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke="var(--color-border)" strokeOpacity={0.35} vertical={false} />
                    <XAxis dataKey="weekday" tick={{ fill: "var(--color-muted)", fontSize: 10 }} />
                    <YAxis tick={{ fill: "var(--color-muted)", fontSize: 10 }} width={28} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Bar dataKey="gain" fill="var(--color-chart-4)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {tab === "when" ? (
        <div className="space-y-3">
          {!whenShown.length ? (
            <p className="text-sm text-muted">
              {searching
                ? "No timing for that tag yet."
                : "Need at least two warehouse days (and ideally a like/star pull) before a tag shows a successful slot."}
            </p>
          ) : (
            whenShown.map((w) => (
              <div key={w.tag} className="rounded-xl border border-border/70 bg-bg/40 p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <button
                      type="button"
                      className="rounded-full bg-primary/15 px-2.5 py-0.5 text-xs font-semibold text-primary"
                      onClick={() => {
                        setQuery(w.tag);
                        setPicked(w.tag);
                      }}
                    >
                      {w.tag}
                    </button>
                    <p className="mt-2 text-sm font-semibold text-fg">{w.successWhen}</p>
                    <p className="mt-0.5 text-[11px] text-muted">{w.evidence}</p>
                  </div>
                  <span className={`text-xs ${liftClass(w.lift)}`}>{w.lift.toFixed(2)}× lift</span>
                </div>
                {w.weekdays.length ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {w.weekdays.map((d) => (
                      <span
                        key={d.day}
                        className="rounded-full border border-border bg-bg px-2 py-0.5 text-[11px] text-muted"
                      >
                        {d.day} {formatPct(d.share, 0)}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            ))
          )}
        </div>
      ) : null}

      {tab === "combos" ? (
        comboShown.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-xs">
              <thead className="text-muted">
                <tr className="border-b border-border">
                  <th className="py-2 pr-2 font-medium">Pair</th>
                  <th className="py-2 pr-2 font-medium">Bots</th>
                  <th className="py-2 pr-2 font-medium">Chats</th>
                  <th className="py-2 pr-2 font-medium">Lift vs solos</th>
                  <th className="py-2 font-medium">On</th>
                </tr>
              </thead>
              <tbody>
                {comboShown.map((c) => (
                  <tr key={`${c.a}||${c.b}`} className="border-b border-border/40">
                    <td className="py-2 pr-2 font-medium">
                      <button
                        type="button"
                        className="text-left hover:text-primary"
                        onClick={() => {
                          setQuery(`${c.a} × ${c.b}`);
                          setPicked(c.a);
                        }}
                      >
                        {c.a}
                        <span className="text-faint"> × </span>
                        {c.b}
                      </button>
                    </td>
                    <td className="py-2 pr-2 text-muted">{c.bots}</td>
                    <td className="py-2 pr-2">{formatNum(c.chats)}</td>
                    <td className={`py-2 pr-2 ${liftClass(c.lift)}`}>{c.lift.toFixed(2)}×</td>
                    <td className="max-w-[180px] truncate py-2 text-muted">{c.names.join(" · ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-[11px] text-faint">
              Lift is chats-per-bot for the pair versus the average of each tag on its own. Above 1×
              means the pair outperforms running those tags separately.
              {searching
                ? ` · ${comboShown.length} match${comboShown.length === 1 ? "" : "es"} of ${combos.length}.`
                : combos.length > 16
                  ? ` · Showing top 16 of ${combos.length}.`
                  : ""}
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted">
            {searching
              ? "No observed pair for that search. Check Gaps for inferred combinations you don't run yet."
              : "No co-occurring tags yet — bots need at least two tags."}
          </p>
        )
      ) : null}

      {tab === "gaps" ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-danger">
              <AlertTriangle className="size-3.5" />
              Overserved
            </h3>
            {forensic?.overserved?.length ? (
              <div className="space-y-2">
                {forensic.overserved.map((g) => (
                  <GapCard key={`o-${g.subject}-${g.tag}`} row={g} onPick={pickGap} />
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted">No piled-up tags — mix isn't clustered on weak lanes.</p>
            )}
          </div>
          <div>
            <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-success">
              <Sparkles className="size-3.5" />
              Underserved
            </h3>
            {forensic?.underserved?.length ? (
              <div className="space-y-2">
                {forensic.underserved.map((g) => (
                  <GapCard key={`u-${g.subject}-${g.tag}`} row={g} onPick={pickGap} />
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted">
                Need warehouse lift, a New scrape (official catalog), or neighbour tags before gaps
                show.
              </p>
            )}
          </div>
        </div>
      ) : null}

      {tab === "popular" ? (
        popularShown.length ? (
          <div className="grid gap-4 lg:grid-cols-[1fr_minmax(0,20rem)]">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-left text-xs">
                <thead className="text-muted">
                  <tr className="border-b border-border">
                    <th className="py-2 pr-2 font-medium">Tag</th>
                    <th className="py-2 pr-2 font-medium">7d New</th>
                    <th className="py-2 pr-2 font-medium">Δ vs prior 7d</th>
                    <th className="py-2 pr-2 font-medium">Tracked share</th>
                    <th className="py-2 font-medium">Creators</th>
                  </tr>
                </thead>
                <tbody>
                  {popularShown.map((t) => (
                    <tr
                      key={t.tag}
                      className={`cursor-pointer border-b border-border/40 ${
                        popRow?.tag === t.tag ? "bg-primary/10" : ""
                      }`}
                      onClick={() => setPicked(t.tag)}
                    >
                      <td className="max-w-[140px] truncate py-2 pr-2 font-medium">{t.tag}</td>
                      <td className="py-2 pr-2">{formatNum(t.cards7)}</td>
                      <td className={`py-2 pr-2 ${t.delta > 0 ? "text-success" : t.delta < 0 ? "text-danger" : "text-muted"}`}>
                        {formatDelta(t.delta)}
                      </td>
                      <td className="py-2 pr-2 text-muted">{formatPct(t.knownShare, 0)}</td>
                      <td className="py-2 text-muted">{t.trackedCreators} tracked</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-[11px] text-faint">
                New-feed cards per Madrid day. Tracked share is you + stalked neighbours on that
                tag. Other names come from the New warehouse catalog.
              </p>
            </div>
            {popRow ? (
              <div className="rounded-xl border border-border/70 bg-bg/40 p-3">
                <p className="text-[10px] uppercase tracking-wide text-faint">Selected</p>
                <p className="mt-1 text-sm font-semibold">{popRow.tag}</p>
                <p className="mt-1 text-[12px] text-muted">
                  {formatNum(popRow.cards7)} new cards / 7d · {formatPct(popRow.knownShare, 0)} from
                  tracked creators
                </p>
                <div className="mt-3 h-32">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={popRow.series} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                      <CartesianGrid stroke="var(--color-border)" strokeOpacity={0.35} vertical={false} />
                      <XAxis dataKey="weekday" tick={{ fill: "var(--color-muted)", fontSize: 10 }} />
                      <YAxis tick={{ fill: "var(--color-muted)", fontSize: 10 }} width={28} />
                      <Tooltip contentStyle={tooltipStyle} />
                      <Line type="monotone" dataKey="cards" name="New cards" stroke="var(--color-chart-4)" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="yourGain" name="Your chats" stroke="var(--color-chart-2)" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <ul className="mt-3 max-h-56 space-y-1 overflow-y-auto">
                  {popRow.creators.map((c) => (
                    <li key={`${c.from}-${c.userId}`} className="flex justify-between gap-2 text-xs">
                      <span className="min-w-0 truncate">
                        <span
                          className={`mr-1 rounded-full px-1.5 py-0.5 text-[10px] ${
                            c.from === "you"
                              ? "bg-primary/15 text-primary"
                              : c.from === "rival"
                                ? "bg-accent/15 text-accent"
                                : "bg-bg text-muted"
                          }`}
                        >
                          {c.from === "you" ? "you" : c.from === "rival" ? "rival" : "new"}
                        </span>
                        {c.userName}
                      </span>
                      <span className="shrink-0 text-muted">
                        {c.bots} · {formatNum(c.chats)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-muted">
            {searching
              ? "No New-feed volume for that tag yet."
              : "Refresh New so daily tag counts land in the warehouse. Then popularity can be tracked against you and stalked creators."}
          </p>
        )
      ) : null}

      {tab === "market" ? (
        marketShown.length ? (
          <div className="space-y-3">
            <p className="text-[12px] text-muted">
              Pond volume vs your roster and neighbours.
              {searching ? ` · ${marketShown.length} match${marketShown.length === 1 ? "" : "es"}.` : ""}
            </p>
            {marketShown.map((t) => {
              const pop = popularity.find((p) => p.tag === t.tag);
              return (
                <div key={t.tag} className="rounded-xl border border-border/70 bg-bg/40 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <button
                      type="button"
                      className="rounded-full bg-primary/15 px-2.5 py-0.5 text-xs font-semibold text-primary"
                      onClick={() => {
                        setQuery(t.tag);
                        setPicked(t.tag);
                        setTab("popular");
                      }}
                    >
                      {t.tag}
                    </button>
                    <span className="text-[11px] text-muted">
                      your {t.bots} bots · {formatNum(t.chats)} chats
                      {t.marketN ? ` · ${t.marketN} new cards` : ""}
                      {t.rivalBots ? ` · ${t.rivalBots} neighbour bots` : ""}
                    </span>
                  </div>
                  {pop?.creators.length ? (
                    <div className="mt-2 space-y-1">
                      {pop.creators.slice(0, 4).map((x) => (
                        <div key={`${x.from}-${x.userId}`} className="flex justify-between gap-2 text-xs text-muted">
                          <span className="truncate">
                            {x.userName}
                            <span className="ml-1 text-[10px] text-faint">{x.from}</span>
                          </span>
                          <span className="shrink-0">{formatNum(x.chats)}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-2 text-[11px] text-faint">No warehouse creators on this tag yet.</p>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-muted">
            {searching ? "No market row for that tag." : "No public tags on this lounge snapshot."}
          </p>
        )
      ) : null}

      {whenRow && tab === "traffic" && selected ? (
        <p className="mt-3 text-[12px] text-muted">
          {selected.tag} works <span className="text-fg">{whenRow.successWhen}</span>
          {whenRow.evidence ? ` · ${whenRow.evidence}` : ""}
        </p>
      ) : null}
    </section>
  );
}

function tagKeyEq(a: string, b: string) {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function coverageDot(catalog: TagCatalogEntry[], tag: string) {
  const c = catalog.find((x) => x.tag === tag);
  if (!c) return null;
  if (c.coverage === "overserved") {
    return <span className="ml-1 text-[10px] text-danger">over</span>;
  }
  if (c.coverage === "underserved") {
    return <span className="ml-1 text-[10px] text-success">under</span>;
  }
  return null;
}

function UnusedCard({ entry }: { entry: TagCatalogEntry }) {
  return (
    <div className="mb-4 rounded-xl border border-warning/30 bg-warning/5 p-3">
      <p className="text-sm font-semibold">{entry.tag}</p>
      <p className="mt-1 text-[12px] text-muted">
        Not on your roster
        {entry.official ? " · official catalog" : ""}
        {entry.marketN ? ` · ${entry.marketN} new-feed cards` : ""}
        {entry.rivalBots ? ` · ${entry.rivalBots} neighbour bots` : ""}
      </p>
      <p className="mt-1 text-[11px] text-faint">
        {entry.sources.join(" · ") || "catalog"} · search still finds every available tag, even
        unused ones.
      </p>
    </div>
  );
}
