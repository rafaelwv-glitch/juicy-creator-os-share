import { Link } from "@tanstack/react-router";
import {
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Clock,
  Flame,
  Loader2,
  Rocket,
  Timer,
  TrendingUp,
} from "lucide-react";
import { formatDelta, formatNum, formatPct, formatWhen } from "@/lib/juicychat/format";
import type { ClockItem, ClockJob, CreatorBriefing, SpikeKind } from "@/lib/juicychat/briefing-types";

const tooltipStyle = {
  background: "var(--color-surface)",
  border: "1px solid var(--color-border)",
  borderRadius: 10,
  fontSize: 12,
  color: "var(--color-fg)",
};

function formatAge(days: number | null | undefined) {
  if (days == null || Number.isNaN(days)) return "—";
  if (days < 1.5) return `${Math.max(1, Math.round(days * 24))}h`;
  if (days < 14) return `${days.toFixed(0)}d`;
  if (days < 60) return `${(days / 7).toFixed(0)}w`;
  if (days < 400) return `${(days / 30).toFixed(days >= 90 ? 0 : 1)}mo`;
  return `${(days / 365).toFixed(1)}y`;
}

function kindLabel(k: SpikeKind) {
  switch (k) {
    case "new-engine":
      return "New engine";
    case "old-comedy":
      return "Old comedy";
    case "flash":
      return "Flash";
    default:
      return "Steady";
  }
}

function kindClass(k: SpikeKind) {
  switch (k) {
    case "new-engine":
      return "bg-chart-3/15 text-chart-3";
    case "old-comedy":
      return "bg-accent/15 text-accent";
    case "flash":
      return "bg-warning/15 text-warning";
    default:
      return "bg-elevated text-muted";
  }
}

function fateLabel(s: ClockItem["status"]) {
  switch (s) {
    case "published":
      return "published";
    case "rejected":
      return "rejected";
    case "review":
      return "back to review";
    case "pending_release":
      return "still pending";
    case "under_review":
      return "under review";
    default:
      return "left queue";
  }
}

function BotRow({
  thumb,
  name,
  sub,
  right,
}: {
  thumb?: string;
  name: string;
  sub?: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 py-2">
      {thumb ? (
        <img src={thumb} alt="" className="size-9 shrink-0 rounded-lg object-cover" />
      ) : (
        <div className="size-9 shrink-0 rounded-lg bg-elevated" />
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">{name}</div>
        {sub ? <div className="truncate text-[11px] text-muted">{sub}</div> : null}
      </div>
      {right}
    </div>
  );
}

function HeatBar({ share }: { share: number }) {
  const pct = Math.max(0, Math.min(100, share * 100));
  return (
    <div className="h-1.5 w-24 overflow-hidden rounded-full bg-elevated">
      <div
        className="h-full rounded-full bg-gradient-to-r from-chart-1 to-accent"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function QuickSummary({
  briefing,
  jobs,
  loading,
}: {
  briefing: CreatorBriefing | null | undefined;
  jobs?: ClockJob[];
  loading?: boolean;
}) {
  if (loading && !briefing) {
    return (
      <div className="flex items-center justify-center py-20 text-sm text-muted">
        <Loader2 className="mr-2 size-4 animate-spin" />
        Loading briefing…
      </div>
    );
  }
  if (!briefing) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-surface/50 px-6 py-16 text-center">
        <Flame className="mx-auto size-8 text-primary" />
        <h2 className="font-display mt-3 text-xl font-bold">No briefing yet</h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted">
          Connect JuicyChat and refresh. The front page answers three questions from the warehouse:
          this week's heat, the audit-15 clock, and whether a spike is new or old.
        </p>
      </div>
    );
  }

  const { heat, clock, spikes } = briefing;
  const scheduled = (jobs?.length
    ? jobs
        .filter((j) => j.status === "scheduled" || j.status === "running")
        .map((j) => ({
          id: j.id,
          characterId: j.characterId,
          characterName: j.characterName,
          fireAtMs: j.fireAtMs,
          status: j.status,
        }))
    : clock.scheduled
  ).sort((a, b) => a.fireAtMs - b.fireAtMs);

  const waitingCount = clock.waiting.length;
  const inCount = clock.inbound.length;
  const outCount = clock.outbound.length;
  const clockCount = scheduled.length;

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted">
        Three questions. Deep ranks, yield, and warehouse live on the{" "}
        <Link to="/lounge" className="font-medium text-primary hover:underline">
          Lounge
        </Link>
        .
      </p>

      <section className="rounded-2xl border border-border bg-surface/90 p-4 sm:p-5">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div>
            <div className="text-[11px] font-medium uppercase tracking-wider text-faint">1 · This week</div>
            <h2 className="mt-0.5 flex items-center gap-2 text-lg font-semibold tracking-tight">
              <Flame className="size-4 text-accent" />
              What is printing this week?
            </h2>
          </div>
          <div className="text-right text-xs text-muted">
            <div className="font-semibold text-fg">{formatDelta(heat.chats)} chats</div>
            <div>
              {formatDelta(heat.likes)} likes · {formatDelta(heat.favorites)} favs
            </div>
          </div>
        </div>

        <div className="mb-4 h-28 w-full">
          {heat.daily.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={heat.daily}>
                <XAxis dataKey="date" tick={{ fill: "var(--color-faint)", fontSize: 10 }} />
                <YAxis tick={{ fill: "var(--color-faint)", fontSize: 10 }} width={36} />
                <Tooltip contentStyle={tooltipStyle} />
                <Bar dataKey="chats" fill="var(--color-chart-1)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted">
              Need 2+ scrape days for 7d heat.
            </div>
          )}
        </div>

        {!heat.printers.length ? (
          <p className="text-sm text-muted">No bot is printing this week yet.</p>
        ) : (
          <div className="divide-y divide-border/60">
            {heat.printers.map((p) => (
              <BotRow
                key={p.characterId}
                thumb={p.characterThumb}
                name={p.characterName}
                sub={`${formatAge(p.ageDays)} · DoD ${formatDelta(p.dodChats)} chats`}
                right={
                  <div className="flex items-center gap-2 text-right">
                    <HeatBar share={p.share} />
                    <div className="w-16">
                      <div className="text-sm font-semibold">{formatNum(p.chats7d)}</div>
                      <div className="text-[10px] text-faint">{formatPct(p.share, 0)}</div>
                    </div>
                  </div>
                }
              />
            ))}
          </div>
        )}
        {heat.topShare >= 0.35 && heat.printers[0] ? (
          <p className="mt-3 text-xs text-muted">
            <span className="font-medium text-fg">{heat.printers[0].characterName}</span> is{" "}
            {formatPct(heat.topShare, 0)} of the week's chats.
          </p>
        ) : null}
      </section>

      <section className="rounded-2xl border border-border bg-surface/90 p-4 sm:p-5">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div>
            <div className="text-[11px] font-medium uppercase tracking-wider text-faint">2 · Clock</div>
            <h2 className="mt-0.5 flex items-center gap-2 text-lg font-semibold tracking-tight">
              <Timer className="size-4 text-chart-4" />
              What is waiting on a clock?
            </h2>
          </div>
          <Link to="/publish" className="text-xs font-medium text-primary hover:underline">
            Release queue →
          </Link>
        </div>

        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(
            [
              ["Audit-15", waitingCount, "approved, not live"],
              ["In (7d)", inCount, "entered pending"],
              ["Out (7d)", outCount, "left pending"],
              ["Scheduled", clockCount, "fire time set"],
            ] as const
          ).map(([l, v, s]) => (
            <div key={l} className="rounded-xl border border-border/70 bg-bg/40 px-3 py-2.5">
              <div className="text-[10px] uppercase tracking-wide text-faint">{l}</div>
              <div className="font-display text-2xl font-bold">{v}</div>
              <div className="text-[11px] text-muted">{s}</div>
            </div>
          ))}
        </div>

        {clock.review.length ? (
          <p className="mb-3 text-xs text-muted">
            {clock.review.length} still under review (audit 10) — not on the 15-clock yet.
          </p>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-3">
          <div>
            <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
              <Clock className="size-3.5" /> Waiting
            </div>
            {!clock.waiting.length ? (
              <p className="text-sm text-muted">Nothing on audit-15.</p>
            ) : (
              clock.waiting.map((b) => (
                <BotRow
                  key={b.characterId}
                  thumb={b.characterThumb}
                  name={b.characterName}
                  sub={`waiting ${formatAge(b.waitDays)} · ${formatNum(b.chats)} chats`}
                />
              ))
            )}
          </div>
          <div>
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-chart-3">In</div>
            {!clock.inbound.length ? (
              <p className="text-sm text-muted">No new approvals this week.</p>
            ) : (
              clock.inbound.map((b) => (
                <BotRow
                  key={b.characterId}
                  thumb={b.characterThumb}
                  name={b.characterName}
                  sub={b.firstSeen ? `in ${formatWhen(b.firstSeen)}` : "entered pending"}
                />
              ))
            )}
          </div>
          <div>
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-accent">Out</div>
            {!clock.outbound.length ? (
              <p className="text-sm text-muted">Nobody left the queue this week.</p>
            ) : (
              clock.outbound.map((b) => (
                <BotRow
                  key={b.characterId}
                  thumb={b.characterThumb}
                  name={b.characterName}
                  sub={fateLabel(b.status)}
                />
              ))
            )}
          </div>
        </div>

        {scheduled.length ? (
          <div className="mt-4 rounded-xl border border-primary/25 bg-primary/5 px-3 py-2.5">
            <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-primary">
              <Rocket className="size-3.5" /> Fire times
            </div>
            {scheduled.map((j) => (
              <div key={j.id} className="flex items-center justify-between gap-2 py-1 text-sm">
                <span className="truncate font-medium">{j.characterName}</span>
                <span className="shrink-0 text-[11px] text-muted">
                  {j.fireAtMs ? formatWhen(j.fireAtMs) : j.status}
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </section>

      <section className="rounded-2xl border border-border bg-surface/90 p-4 sm:p-5">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div>
            <div className="text-[11px] font-medium uppercase tracking-wider text-faint">3 · Engine vs comedy</div>
            <h2 className="mt-0.5 flex items-center gap-2 text-lg font-semibold tracking-tight">
              <TrendingUp className="size-4 text-chart-3" />
              New engine or old comedy waking up?
            </h2>
          </div>
        </div>

        <div className="mb-4 rounded-xl border border-border/70 bg-bg/40 px-4 py-3">
          <div className="font-display text-xl font-bold tracking-tight">{spikes.headline}</div>
          <p className="mt-1 text-sm text-muted">{spikes.detail}</p>
          <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-muted">
            <span>
              New-engine share <span className="font-semibold text-chart-3">{formatPct(spikes.newEngineShare, 0)}</span>
            </span>
            <span>
              Old-comedy share <span className="font-semibold text-accent">{formatPct(spikes.oldComedyShare, 0)}</span>
            </span>
          </div>
        </div>

        {!spikes.rows.length ? (
          <p className="text-sm text-muted">No spike to diagnose. Age + DoD + 7d share need a week of history.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-xs">
              <thead className="text-muted">
                <tr className="border-b border-border">
                  <th className="py-1.5 pr-2 font-medium">Bot</th>
                  <th className="py-1.5 pr-2 font-medium">Age</th>
                  <th className="py-1.5 pr-2 font-medium">DoD</th>
                  <th className="py-1.5 pr-2 font-medium">7d chats</th>
                  <th className="py-1.5 pr-2 font-medium">7d share</th>
                  <th className="py-1.5 font-medium">Verdict</th>
                </tr>
              </thead>
              <tbody>
                {spikes.rows.map((r) => (
                  <tr key={r.characterId} className="border-b border-border/40">
                    <td className="max-w-[220px] truncate py-1.5 pr-2 font-medium">{r.characterName}</td>
                    <td className="py-1.5 pr-2">{formatAge(r.ageDays)}</td>
                    <td className="py-1.5 pr-2">{formatDelta(r.dodChats)}</td>
                    <td className="py-1.5 pr-2">{formatNum(r.chats7d)}</td>
                    <td className="py-1.5 pr-2">{formatPct(r.share7d, 0)}</td>
                    <td className="py-1.5">
                      <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${kindClass(r.kind)}`}>
                        {kindLabel(r.kind)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
