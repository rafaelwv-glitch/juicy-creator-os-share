import { useEffect, useMemo, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
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
  Clock,
  Fingerprint,
  Heart,
  Loader2,
  RefreshCw,
  Search,
  Sparkles,
  Star,
  Tags,
  TrendingUp,
  Users,
} from "lucide-react";
import {
  ingestForensicsNow,
  loadForensicReport,
  loadForensicsIndex,
} from "@/lib/juicychat/actions";
import { DesktopNavLinks, MobileNav } from "@/components/mobile-nav";
import { TagForensicsPanel } from "@/components/tag-forensics-panel";
import { formatDelta, formatNum, formatWhen } from "@/lib/juicychat/format";
import type {
  ForensicIndex,
  ForensicReport,
  WhyFactor,
} from "@/lib/juicychat/forensics";
import { browserCacheReady } from "@/lib/juicychat/browser-sync";

export const Route = createFileRoute("/forensics")({ component: ForensicsPage });

const tooltipStyle = {
  background: "var(--color-surface)",
  border: "1px solid var(--color-border)",
  borderRadius: 10,
  fontSize: 12,
  color: "var(--color-fg)",
};

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function whyTone(kind: WhyFactor["kind"]) {
  if (kind === "tag" || kind === "topic") return "border-primary/30 bg-primary/10 text-primary";
  if (kind === "velocity" || kind === "evergreen") return "border-success/30 bg-success/10 text-success";
  if (kind === "discovery") return "border-accent/30 bg-accent/10 text-accent";
  if (kind === "timing" || kind === "publish-slot") return "border-warning/30 bg-warning/10 text-warning";
  if (kind === "audience") return "border-chart-2/30 bg-chart-2/10 text-chart-2";
  return "border-border bg-bg/50 text-muted";
}

function ForensicsPage() {
  const [index, setIndex] = useState<ForensicIndex | null>(null);
  const [report, setReport] = useState<ForensicReport | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<"tags" | "topics" | "audience">("tags");
  const [page, setPage] = useState<"tags" | "bots">("tags");

  const load = async () => {
    setLoading(true);
    setErr(null);
    try {
      await browserCacheReady();
      const ix = (await loadForensicsIndex()) as ForensicIndex;
      setIndex(ix);
      const pick = selected && ix.bots.some((b) => b.characterId === selected) ? selected : ix.bots[0]?.characterId;
      if (pick) {
        setSelected(pick);
        const r = (await loadForensicReport({ data: { characterId: pick } })) as ForensicReport | null;
        setReport(r);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openBot = async (id: string) => {
    setSelected(id);
    try {
      const r = (await loadForensicReport({ data: { characterId: id } })) as ForensicReport | null;
      setReport(r);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const rebuild = async () => {
    setBusy(true);
    setErr(null);
    try {
      const ix = (await ingestForensicsNow()) as ForensicIndex;
      setIndex(ix);
      const pick = selected || ix.bots[0]?.characterId;
      if (pick) {
        const r = (await loadForensicReport({ data: { characterId: pick } })) as ForensicReport | null;
        setReport(r);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const bots = useMemo(() => {
    const list = index?.bots || [];
    const s = q.trim().toLowerCase();
    if (!s) return list;
    return list.filter(
      (b) =>
        b.characterName.toLowerCase().includes(s) ||
        b.tags.some((t) => t.toLowerCase().includes(s)) ||
        b.topics.some((t) => t.toLowerCase().includes(s)),
    );
  }, [index, q]);

  const hourData = (report?.hourHist || []).map((n, h) => ({ h: `${String(h).padStart(2, "0")}`, n }));
  const dayData = (report?.byDay || []).map((n, i) => ({ d: DAY_LABELS[i], n }));

  return (
    <div className="min-h-[calc(100dvh-var(--grok-banner-h,0px))] bg-bg pb-28 text-fg md:pb-12">
      <div className="relative mx-auto max-w-6xl overflow-x-hidden px-4 pt-5 sm:px-6 sm:pt-8">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <Link to="/" className="text-xs font-medium text-muted hover:text-fg">
            ← Lounge
          </Link>
          <DesktopNavLinks />
        </div>

        <header className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="font-display flex items-center gap-2 text-3xl font-bold tracking-tight">
              <Fingerprint className="size-7 text-primary" />
              Forensics
            </h1>
            <p className="mt-1 max-w-xl text-sm text-muted">
              Tag popularity against warehouse creators, plus the bot archive: why a ship moved, who
              keeps coming back, and tags that still have room.
            </p>
            {index ? (
              <p className="mt-1 text-[11px] text-faint">
                {index.botCount} bots · {index.daysTracked} archive days · {index.followDays ?? 0} follow
                days · {index.creatorDays ?? 0} creator days · ingested {formatWhen(index.scrapedAt)}
                {index.audience?.uniquePeople
                  ? ` · ${formatNum(index.audience.uniquePeople)} known people · ${formatNum(index.audience.recurringPeople)} recurring`
                  : ""}
                {index.seenExtraKeys.length ? ` · extras ${index.seenExtraKeys.slice(0, 8).join(", ")}` : ""}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => void rebuild()}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-xl border border-primary/40 bg-primary/15 px-3 py-2 text-sm font-semibold text-primary disabled:opacity-50"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            Rebuild archive
          </button>
        </header>

        {err ? <p className="mb-4 text-sm text-danger">{err}</p> : null}

        <div className="mb-5 flex flex-wrap gap-1 rounded-xl border border-border bg-surface/80 p-1">
          {(
            [
              ["tags", "Tags"],
              ["bots", "Bots"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setPage(id)}
              className={`inline-flex min-h-11 flex-1 items-center justify-center rounded-lg px-4 text-sm font-semibold sm:flex-none ${
                page === id ? "bg-elevated text-fg" : "text-muted hover:text-fg"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex items-center gap-2 py-16 text-sm text-muted">
            <Loader2 className="size-4 animate-spin text-primary" />
            Loading archive…
          </div>
        ) : page === "tags" ? (
          <TagForensicsPanel forensic={index?.warehouse} />
        ) : (
          <>
            <div className="mb-5 grid gap-3 lg:grid-cols-2">
              <section className="rounded-2xl border border-border bg-surface/90 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="flex items-center gap-2 text-sm font-semibold">
                    {tab === "audience" ? (
                      <Users className="size-4 text-primary" />
                    ) : (
                      <Tags className="size-4 text-primary" />
                    )}
                    {tab === "tags" ? "Tag performance" : tab === "topics" ? "Topic performance" : "Recurring audience"}
                  </h2>
                  <div className="flex rounded-lg border border-border bg-bg/40 p-0.5 text-[11px]">
                    <button
                      type="button"
                      onClick={() => setTab("tags")}
                      className={`rounded-md px-2 py-1 ${tab === "tags" ? "bg-elevated text-fg" : "text-muted"}`}
                    >
                      Tags
                    </button>
                    <button
                      type="button"
                      onClick={() => setTab("topics")}
                      className={`rounded-md px-2 py-1 ${tab === "topics" ? "bg-elevated text-fg" : "text-muted"}`}
                    >
                      Topics
                    </button>
                    <button
                      type="button"
                      onClick={() => setTab("audience")}
                      className={`rounded-md px-2 py-1 ${tab === "audience" ? "bg-elevated text-fg" : "text-muted"}`}
                    >
                      Audience
                    </button>
                  </div>
                </div>
                {tab === "audience" ? (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {(
                        [
                          ["People", index?.audience?.uniquePeople],
                          ["Likers", index?.audience?.uniqueLikers],
                          ["Starrers", index?.audience?.uniqueStarrers],
                          ["Recurring", index?.audience?.recurringPeople],
                        ] as const
                      ).map(([l, v]) => (
                        <div key={l} className="rounded-xl border border-border/70 bg-bg/40 px-2.5 py-2">
                          <div className="text-[10px] uppercase tracking-wide text-faint">{l}</div>
                          <div className="text-lg font-semibold">{formatNum(v)}</div>
                        </div>
                      ))}
                    </div>
                    {index?.audience?.patterns?.length ? (
                      <ul className="space-y-1.5 text-xs text-muted">
                        {index.audience.patterns.map((p) => (
                          <li key={p.id} className="rounded-xl border border-border/60 bg-bg/30 px-3 py-2">
                            <div className="font-semibold text-fg">{p.label}</div>
                            <p className="mt-0.5 text-[11px] text-muted">{p.detail}</p>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-muted">
                        Rebuild the archive after a notification pull to see who liked and starred.
                      </p>
                    )}
                    {index?.audience?.crossovers?.length ? (
                      <div>
                        <div className="mb-1 text-[11px] uppercase tracking-wide text-faint">Shared crowds</div>
                        <ul className="space-y-1 text-xs">
                          {index.audience.crossovers.slice(0, 8).map((c) => (
                            <li key={`${c.aId}-${c.bId}`} className="flex justify-between gap-3">
                              <span className="min-w-0 truncate text-muted">
                                {c.aName} × {c.bName}
                              </span>
                              <span className="shrink-0 font-medium">{c.shared} people</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {index?.audience?.topFans?.length ? (
                      <div>
                        <div className="mb-1 text-[11px] uppercase tracking-wide text-faint">Top returning people</div>
                        <ul className="max-h-48 space-y-1 overflow-y-auto text-xs">
                          {index.audience.topFans.slice(0, 16).map((p) => (
                            <li key={p.senderId} className="flex items-center justify-between gap-3">
                              <span className="min-w-0 truncate font-medium">{p.senderName || p.senderId}</span>
                              <span className="shrink-0 text-muted">
                                {p.likes} like · {p.favorites} star · {p.bots} bots
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="max-h-64 overflow-y-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="text-muted">
                        <tr className="border-b border-border">
                          <th className="py-1.5 pr-2 font-medium">{tab === "tags" ? "Tag" : "Topic"}</th>
                          <th className="py-1.5 pr-2 font-medium">Bots</th>
                          <th className="py-1.5 pr-2 font-medium">Chats</th>
                          <th className="py-1.5 pr-2 font-medium">Δ</th>
                          <th className="py-1.5 font-medium">Lift</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(tab === "tags" ? index?.tagBoard : index?.topicBoard)?.slice(0, 18).map((row) => {
                          const label = "tag" in row ? row.tag : row.topic;
                          return (
                            <tr key={label} className="border-b border-border/40">
                              <td className="max-w-[140px] truncate py-1.5 pr-2 font-medium">{label}</td>
                              <td className="py-1.5 pr-2 text-muted">{row.bots}</td>
                              <td className="py-1.5 pr-2">{formatNum(row.chats)}</td>
                              <td className="py-1.5 pr-2">{formatDelta(row.dChats)}</td>
                              <td className={`py-1.5 ${row.lift >= 1.1 ? "text-success" : row.lift < 0.9 ? "text-danger" : "text-muted"}`}>
                                {row.lift.toFixed(2)}×
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                {tab === "tags" && index?.warehouse?.when?.length ? (
                  <div className="mt-3 border-t border-border/60 pt-3">
                    <p className="mb-2 text-[10px] uppercase tracking-wide text-faint">
                      Warehouse · when tags work
                    </p>
                    <ul className="space-y-1.5 text-xs">
                      {index.warehouse.when.slice(0, 6).map((w) => (
                        <li key={w.tag} className="flex justify-between gap-3">
                          <span className="min-w-0 truncate font-medium">{w.tag}</span>
                          <span className="shrink-0 text-muted">{w.successWhen}</span>
                        </li>
                      ))}
                    </ul>
                    {index.warehouse.combos[0] ? (
                      <p className="mt-2 text-[11px] text-muted">
                        Strongest pair: {index.warehouse.combos[0].a} × {index.warehouse.combos[0].b}{" "}
                        ({index.warehouse.combos[0].lift.toFixed(2)}× vs solos)
                      </p>
                    ) : null}
                    {index.warehouse.underserved?.[0] ? (
                      <p className="mt-1 text-[11px] text-success">
                        Underserved: {index.warehouse.underserved[0].tag}
                      </p>
                    ) : null}
                    {index.warehouse.overserved?.[0] ? (
                      <p className="mt-1 text-[11px] text-danger">
                        Overserved: {index.warehouse.overserved[0].tag}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </section>

              <section className="rounded-2xl border border-border bg-surface/90 p-4">
                <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                  <Sparkles className="size-4 text-accent" />
                  What we keep
                </h2>
                <ul className="space-y-2 text-sm text-muted">
                  <li>Daily chats / likes / favorites / scores / visibility — never trimmed from this archive.</li>
                  <li>Tags + inferred topics (name brackets + tag map) with identity revisions when they change.</li>
                  <li>Discovery ranks, comment samples, character-board ranks.</li>
                  <li>Who liked and who starred — unique people, first/last seen, never trimmed.</li>
                  <li>Recurring audience: the same accounts across bots, like-then-star, shared crowds.</li>
                  <li>Notification counts by day and hour — the live feed only lasts ~30 days; the archive does not.</li>
                  <li>Unknown API fields land in <span className="text-fg">extras</span> so we can backfill later.</li>
                </ul>
                {index?.sources ? (
                  <div className="mt-3 flex flex-wrap gap-1.5 text-[10px] text-faint">
                    {Object.entries(index.sources).map(([k, v]) => (
                      <span key={k} className="rounded-full border border-border px-2 py-0.5">
                        {k} {v ? formatWhen(v) : "—"}
                      </span>
                    ))}
                  </div>
                ) : null}
              </section>
            </div>

            <div className="grid gap-5 lg:grid-cols-[minmax(0,280px)_1fr]">
              <aside className="rounded-2xl border border-border bg-surface/90 p-3">
                <div className="relative mb-2">
                  <Search className="pointer-events-none absolute left-2.5 top-2.5 size-3.5 text-faint" />
                  <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Search bots, tags, topics"
                    className="w-full rounded-lg border border-border bg-bg px-8 py-2 text-sm outline-none focus:border-primary"
                  />
                </div>
                <div className="max-h-[70vh] space-y-1 overflow-y-auto">
                  {bots.map((b) => (
                    <button
                      key={b.characterId}
                      type="button"
                      onClick={() => void openBot(b.characterId)}
                      className={`w-full rounded-xl px-2.5 py-2 text-left text-xs ${
                        selected === b.characterId ? "bg-primary/15 ring-1 ring-primary/40" : "hover:bg-bg/60"
                      }`}
                    >
                      <div className="truncate font-semibold">{b.characterName}</div>
                      <div className="mt-0.5 flex justify-between text-[11px] text-muted">
                        <span>{formatNum(b.chats)} chats</span>
                        <span className={b.dChats > 0 ? "text-success" : b.dChats < 0 ? "text-danger" : ""}>
                          {formatDelta(b.dChats)}
                        </span>
                      </div>
                      <div className="mt-1 truncate text-[10px] text-faint">
                        {b.returningFans
                          ? `${b.returningFans} returning · `
                          : b.uniquePeople
                            ? `${b.uniquePeople} people · `
                            : ""}
                        {b.topics.slice(0, 2).join(" · ") || b.tags.slice(0, 2).join(" · ") || "—"}
                      </div>
                    </button>
                  ))}
                </div>
              </aside>

              <div className="min-w-0 space-y-4">
                {report ? (
                  <>
                    <section className="rounded-2xl border border-border bg-surface/90 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <h2 className="font-display text-xl font-bold">{report.summary.characterName}</h2>
                          <p className="mt-1 text-sm text-muted">
                            {formatNum(report.summary.chats)} chats · {formatNum(report.summary.likes)} likes ·{" "}
                            {report.summary.ageDays != null ? `${report.summary.ageDays.toFixed(0)}d old` : "age —"} ·{" "}
                            {report.summary.chatsPerDay.toFixed(1)} chats/day
                          </p>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {report.identity.topics.map((t) => (
                              <span key={t} className="rounded-full bg-accent/15 px-2 py-0.5 text-[11px] text-accent">
                                {t}
                              </span>
                            ))}
                            {report.identity.tags.slice(0, 8).map((t) => (
                              <span key={t} className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] text-primary">
                                {t}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                      {report.identity.introduction ? (
                        <p className="mt-3 line-clamp-4 text-sm text-muted">{report.identity.introduction}</p>
                      ) : null}
                    </section>

                    {report.commenters?.length ? (
                      <section className="rounded-2xl border border-border bg-surface/90 p-4">
                        <h3 className="mb-2 text-sm font-semibold">Archived commenters</h3>
                        <ul className="space-y-1 text-xs text-muted">
                          {report.commenters.slice(0, 12).map((c) => (
                            <li key={c.messageId} className="flex justify-between gap-3">
                              <span className="truncate">{c.senderName || "Someone"}</span>
                              <span className="text-faint">{formatWhen(new Date(c.ts).toISOString())}</span>
                            </li>
                          ))}
                        </ul>
                      </section>
                    ) : null}

                    {report.audience?.uniquePeople ? (
                      <section className="rounded-2xl border border-border bg-surface/90 p-4">
                        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                          <Users className="size-4 text-primary" />
                          Who liked / starred
                        </h3>
                        <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                          {(
                            [
                              ["People", report.audience.uniquePeople],
                              ["Likers", report.audience.uniqueLikers],
                              ["Stars", report.audience.uniqueStarrers],
                              ["Returned", report.audience.likeThenStar || report.audience.returning],
                            ] as const
                          ).map(([l, v]) => (
                            <div key={l} className="rounded-xl border border-border/70 bg-bg/40 px-2.5 py-2">
                              <div className="text-[10px] uppercase tracking-wide text-faint">{l}</div>
                              <div className="font-semibold">{formatNum(v)}</div>
                            </div>
                          ))}
                        </div>
                        {report.audience.alsoOn?.length ? (
                          <p className="mb-3 text-[12px] text-muted">
                            Shared crowd with{" "}
                            {report.audience.alsoOn.slice(0, 3).map((a, i) => (
                              <span key={a.characterId}>
                                {i ? " · " : ""}
                                <button
                                  type="button"
                                  className="font-medium text-primary hover:underline"
                                  onClick={() => void openBot(a.characterId)}
                                >
                                  {a.characterName}
                                </button>
                                <span className="text-faint"> ({a.shared})</span>
                              </span>
                            ))}
                          </p>
                        ) : null}
                        <div className="grid gap-4 sm:grid-cols-2">
                          <div>
                            <div className="mb-1.5 flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-faint">
                              <Heart className="size-3 text-chart-2" /> Likes
                            </div>
                            <ul className="max-h-52 space-y-1 overflow-y-auto text-xs">
                              {report.audience.likers.slice(0, 16).map((p) => (
                                <li key={`l-${p.senderId}`} className="flex justify-between gap-3">
                                  <span className="min-w-0 truncate">{p.senderName || p.senderId}</span>
                                  <span className="shrink-0 text-muted">
                                    {p.likes}×{p.favorites ? ` · ${p.favorites}★` : ""}
                                  </span>
                                </li>
                              ))}
                              {!report.audience.likers.length ? (
                                <li className="text-muted">No named likers in the archive yet.</li>
                              ) : null}
                            </ul>
                          </div>
                          <div>
                            <div className="mb-1.5 flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-faint">
                              <Star className="size-3 text-accent" /> Stars
                            </div>
                            <ul className="max-h-52 space-y-1 overflow-y-auto text-xs">
                              {report.audience.starrers.slice(0, 16).map((p) => (
                                <li key={`s-${p.senderId}`} className="flex justify-between gap-3">
                                  <span className="min-w-0 truncate">{p.senderName || p.senderId}</span>
                                  <span className="shrink-0 text-muted">
                                    {p.favorites}★{p.likes ? ` · ${p.likes} like` : ""}
                                  </span>
                                </li>
                              ))}
                              {!report.audience.starrers.length ? (
                                <li className="text-muted">No named starrers in the archive yet.</li>
                              ) : null}
                            </ul>
                          </div>
                        </div>
                      </section>
                    ) : null}

                    <section className="rounded-2xl border border-border bg-surface/90 p-4">
                      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                        <TrendingUp className="size-4 text-success" />
                        Why it performed
                      </h3>
                      {report.why.length ? (
                        <ul className="space-y-2">
                          {report.why.map((w, i) => (
                            <li
                              key={`${w.kind}-${w.label}-${i}`}
                              className={`rounded-xl border px-3 py-2 ${whyTone(w.kind)}`}
                            >
                              <div className="flex items-center justify-between gap-2 text-sm font-semibold">
                                <span>{w.label}</span>
                                {w.lift != null ? <span className="text-[11px]">{w.lift.toFixed(2)}×</span> : null}
                              </div>
                              <p className="mt-0.5 text-[12px] opacity-80">{w.detail}</p>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-sm text-muted">Need another scrape day to rank reasons.</p>
                      )}
                    </section>

                    <section className="rounded-2xl border border-border bg-surface/90 p-4">
                      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                        <Clock className="size-4 text-warning" />
                        When it performed
                      </h3>
                      <ul className="mb-4 space-y-1.5 text-sm">
                        {report.when.map((w, i) => (
                          <li key={`${w.kind}-${i}`} className="flex justify-between gap-3">
                            <span className="text-muted">{w.label}</span>
                            {w.value != null && w.kind !== "best-hour" && w.kind !== "best-day" ? (
                              <span className="font-medium">{formatDelta(w.value)}</span>
                            ) : (
                              <span className="text-[11px] text-faint">
                                {w.at.startsWith("hour:") || w.at.startsWith("dow:") ? "" : formatWhen(w.at)}
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                      {report.timeline.length > 1 ? (
                        <div className="h-40">
                          <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={report.timeline}>
                              <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" vertical={false} />
                              <XAxis dataKey="date" tick={{ fill: "var(--color-faint)", fontSize: 10 }} />
                              <YAxis tick={{ fill: "var(--color-faint)", fontSize: 10 }} width={40} />
                              <Tooltip contentStyle={tooltipStyle} />
                              <Line type="monotone" dataKey="chats" stroke="var(--color-chart-1)" strokeWidth={2} dot={false} />
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                      ) : null}
                      <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        <div className="h-36">
                          <div className="mb-1 text-[11px] uppercase tracking-wide text-faint">Hour heatmap (Madrid)</div>
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={hourData}>
                              <XAxis dataKey="h" tick={{ fill: "var(--color-faint)", fontSize: 9 }} interval={3} />
                              <YAxis hide />
                              <Tooltip contentStyle={tooltipStyle} />
                              <Bar dataKey="n" fill="var(--color-chart-5)" radius={[3, 3, 0, 0]} />
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                        <div className="h-36">
                          <div className="mb-1 text-[11px] uppercase tracking-wide text-faint">Weekday events</div>
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={dayData}>
                              <XAxis dataKey="d" tick={{ fill: "var(--color-faint)", fontSize: 10 }} />
                              <YAxis hide />
                              <Tooltip contentStyle={tooltipStyle} />
                              <Bar dataKey="n" fill="var(--color-chart-2)" radius={[3, 3, 0, 0]} />
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                    </section>
                  </>
                ) : (
                  <p className="text-sm text-muted">Select a bot.</p>
                )}
              </div>
            </div>
          </>
        )}
      </div>
      <MobileNav />
    </div>
  );
}
