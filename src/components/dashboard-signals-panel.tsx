import { Link } from "@tanstack/react-router";
import {
  Coins,
  Droplets,
  Gauge,
  LayoutGrid,
  Radar,
  Sparkles,
  Star,
} from "lucide-react";
import type { ReactNode } from "react";
import type { DashboardSignals } from "@/lib/juicychat/dashboard-signals";
import { formatNum, formatWhen } from "@/lib/juicychat/format";

function Section({
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

function Hint({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted">{children}</p>;
}

function rate(n: number | null | undefined) {
  if (n == null || Number.isNaN(n)) return "—";
  const v = Number(n);
  if (Math.abs(v) >= 100) return `${Math.round(v)}/h`;
  if (Math.abs(v) >= 10) return `${v.toFixed(1)}/h`;
  return `${v.toFixed(2)}/h`;
}

export function DashboardSignalsPanel({
  signals,
}: {
  signals?: DashboardSignals | null;
}) {
  if (!signals) return null;
  const { pond, rivalVelocity, ownMix, coin, variety, eventWatch } = signals;
  const leftover = coin.leftover || [];
  const newOfficial = eventWatch.tags.filter((t) => t.kind === "new-official");
  const ahead = eventWatch.tags.filter((t) => t.kind === "not-in-catalog");

  return (
    <div className="min-w-0 max-w-full space-y-5">
      <div className="grid min-w-0 gap-5 lg:grid-cols-12">
        <Section
          title="Pond · 72h first-pub"
          icon={<Droplets className="size-4 text-chart-4" />}
          className="lg:col-span-7"
          action={
            <span className="text-[11px] text-muted">
              {pond.cards ? `${pond.cards} cards` : "empty"}
            </span>
          }
        >
          {pond.hint ? (
            <Hint>
              {pond.hint}{" "}
              <Link to="/new-feed" className="font-medium text-primary hover:underline">
                Open New →
              </Link>
            </Hint>
          ) : null}
          {pond.tagRows.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] text-left text-xs">
                <thead className="text-muted">
                  <tr className="border-b border-border">
                    <th className="py-1.5 pr-2 font-medium">Tag</th>
                    <th className="py-1.5 pr-2 font-medium">n</th>
                    <th className="py-1.5 pr-2 font-medium">median</th>
                    <th className="py-1.5 pr-2 font-medium">p90</th>
                    <th className="py-1.5 font-medium">chats</th>
                  </tr>
                </thead>
                <tbody>
                  {pond.tagRows.map((r) => (
                    <tr key={r.tag} className="border-b border-border/40">
                      <td className="max-w-[180px] truncate py-1.5 pr-2 font-medium">{r.tag}</td>
                      <td className="py-1.5 pr-2">{r.n}</td>
                      <td className="py-1.5 pr-2">{formatNum(r.median)}</td>
                      <td className="py-1.5 pr-2">{formatNum(r.p90)}</td>
                      <td className="py-1.5">{formatNum(r.chats)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            {pond.clones.map((c) => (
              <div
                key={c.id}
                className={`min-w-[140px] flex-1 rounded-xl border px-3 py-2 ${
                  c.n > 0 ? "border-accent/40 bg-accent/10" : "border-border/70 bg-bg/40"
                }`}
              >
                <div className="text-[10px] uppercase tracking-wide text-faint">{c.label}</div>
                <div className="text-lg font-semibold">{c.n}</div>
                {c.titles.length ? (
                  <div className="mt-0.5 truncate text-[11px] text-muted" title={c.titles.join(" · ")}>
                    {c.titles.slice(0, 2).join(" · ")}
                  </div>
                ) : (
                  <div className="text-[11px] text-faint">no clones</div>
                )}
              </div>
            ))}
          </div>
        </Section>

        <Section
          title="Event watch"
          icon={<Radar className="size-4 text-warning" />}
          className="lg:col-span-5"
          action={
            <span className="text-[11px] text-muted">
              {eventWatch.officialCount
                ? `${eventWatch.officialCount} official`
                : "no catalog"}
            </span>
          }
        >
          {!eventWatch.officialCount ? (
            <Hint>
              Refresh New once to snapshot the official tag catalog. Event watch compares other
              people's New cards against that list.
            </Hint>
          ) : !eventWatch.tags.length ? (
            <Hint>
              Catalog from {eventWatch.officialAt ? formatWhen(eventWatch.officialAt) : "the last New pull"}.
              No new official tags or uncatalogued tags on other people's New cards this snapshot.
            </Hint>
          ) : (
            <div className="space-y-3">
              {newOfficial.length ? (
                <div>
                  <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-warning">
                    New official · already on New cards
                  </div>
                  <div className="space-y-1.5">
                    {newOfficial.map((t) => (
                      <div key={`n-${t.tag}`} className="rounded-lg border border-warning/30 bg-warning/10 px-2.5 py-1.5">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-xs font-semibold">{t.tag}</span>
                          <span className="text-[11px] text-muted">
                            {t.cards} cards · {t.creators} creators
                          </span>
                        </div>
                        {t.sample.length ? (
                          <div className="truncate text-[11px] text-faint">{t.sample.join(" · ")}</div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              {ahead.length ? (
                <div>
                  <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-chart-4">
                    On New, not in catalog
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {ahead.slice(0, 14).map((t) => (
                      <span
                        key={`a-${t.tag}`}
                        className="rounded-full border border-border bg-bg/50 px-2 py-0.5 text-[11px]"
                        title={t.sample.join(" · ")}
                      >
                        {t.tag} · {t.cards}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </Section>
      </div>

      <div className="grid min-w-0 gap-5 lg:grid-cols-2">
        <Section
          title="Rival 48h velocity"
          icon={<Gauge className="size-4 text-primary" />}
          action={<span className="text-[11px] text-muted">not lifetime</span>}
        >
          {!rivalVelocity.length ? (
            <Hint>Track neighbours on Stalker, then refresh the lounge so 48h deltas can land.</Hint>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-left text-xs">
                <thead className="text-muted">
                  <tr className="border-b border-border">
                    <th className="py-1.5 pr-2 font-medium">Creator</th>
                    <th className="py-1.5 pr-2 font-medium">48h chats</th>
                    <th className="py-1.5 pr-2 font-medium">likes</th>
                    <th className="py-1.5 pr-2 font-medium">follows</th>
                    <th className="py-1.5 pr-2 font-medium">launches</th>
                    <th className="py-1.5 font-medium">chats/h</th>
                  </tr>
                </thead>
                <tbody>
                  {rivalVelocity.slice(0, 12).map((r) => (
                    <tr
                      key={r.userId || r.userName}
                      className={`border-b border-border/40 ${r.isYou ? "bg-primary/10" : ""}`}
                    >
                      <td className="max-w-[160px] truncate py-1.5 pr-2">
                        <span className="font-medium">{r.isYou ? "You" : r.userName}</span>
                        <span className="ml-1.5 text-[10px] text-faint">
                          life {formatNum(r.lifetimeChats)}
                        </span>
                      </td>
                      <td className="py-1.5 pr-2 font-semibold">
                        {r.chats48h == null ? "—" : formatNum(r.chats48h)}
                      </td>
                      <td className="py-1.5 pr-2">{r.likes48h == null ? "—" : formatNum(r.likes48h)}</td>
                      <td className="py-1.5 pr-2">
                        {r.followers48h == null ? "—" : formatNum(r.followers48h)}
                      </td>
                      <td className="py-1.5 pr-2">{r.launches48h || "—"}</td>
                      <td className="py-1.5">{rate(r.chatsPerHour)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        <Section
          title="Own mix · last 14 ships"
          icon={<LayoutGrid className="size-4 text-chart-3" />}
          action={
            <span className="text-[11px] text-muted">
              {ownMix.ships.length ? `${ownMix.ships.length} ships` : "no publishes"}
            </span>
          }
        >
          {!ownMix.ships.length ? (
            <Hint>Need first-publish dates on your lounge snapshot to draw the mix heatmap.</Hint>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-left text-[11px]">
                <thead className="text-muted">
                  <tr className="border-b border-border">
                    <th className="py-1.5 pr-2 font-medium">Bot</th>
                    {ownMix.filters.map((f) => (
                      <th key={f} className="px-0.5 py-1.5 text-center font-medium">
                        <span className="inline-block max-w-[52px] truncate align-bottom" title={f}>
                          {f}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ownMix.ships.map((s) => (
                    <tr key={s.characterId} className="border-b border-border/40">
                      <td className="max-w-[140px] truncate py-1 pr-2 font-medium" title={s.characterName}>
                        {s.characterName}
                      </td>
                      {ownMix.filters.map((f) => (
                        <td key={f} className="px-0.5 py-1 text-center">
                          <span
                            className={`inline-block size-2.5 rounded-sm ${
                              s.hits[f] ? "bg-primary" : "bg-border/70"
                            }`}
                            title={`${f}${s.hits[f] ? " · yes" : ""}`}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      </div>

      <div className="grid min-w-0 gap-5 lg:grid-cols-2">
        <Section
          title="Coin field"
          icon={<Coins className="size-4 text-chart-5" />}
          action={
            leftover.length ? (
              <span className="text-[11px] text-accent">{leftover.length} leftover</span>
            ) : (
              <span className="text-[11px] text-muted">mapped + leftover</span>
            )
          }
        >
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {(
              [
                ["Coin", coin.coin, coin.vipMaxCoin != null ? `/ ${formatNum(coin.vipMaxCoin)}` : ""],
                ["Coin total", coin.coinTotal, "lifetime"],
                ["VIP coin", coin.vipCoin, ""],
                ["Daily", coin.dailyCoin, coin.dailyMaxCoin != null ? `/ ${formatNum(coin.dailyMaxCoin)}` : ""],
              ] as const
            ).map(([label, value, sub]) => (
              <div key={label} className="rounded-xl border border-border/70 bg-bg/40 px-3 py-2">
                <div className="text-[10px] uppercase tracking-wide text-faint">{label}</div>
                <div className="text-lg font-semibold">{formatNum(value)}</div>
                {sub ? <div className="text-[11px] text-muted">{sub}</div> : null}
              </div>
            ))}
          </div>
          {leftover.length ? (
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {leftover.map((row) => (
                <div
                  key={row.key}
                  className="rounded-xl border border-accent/40 bg-accent/10 px-3 py-2"
                >
                  <div className="text-[10px] uppercase tracking-wide text-accent">{row.key}</div>
                  <div className="text-lg font-semibold">
                    {/^-?\d+(\.\d+)?$/.test(row.value) ? formatNum(Number(row.value)) : row.value}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-[11px] text-faint">
              Unmapped VIP / coin keys (Second Best and friends) land here on the next lounge refresh.
            </p>
          )}
        </Section>

        <Section
          title="Variety-health"
          icon={<Star className="size-4 text-chart-2" />}
          action={
            <span className="text-[11px] text-muted">
              {variety.weekStars} stars · 7d
            </span>
          }
        >
          <div className="mb-3 flex flex-wrap items-end gap-4">
            <div>
              <div className="text-[10px] uppercase tracking-wide text-faint">Regulars · 3+ lanes</div>
              <div className="font-display text-3xl font-bold">{variety.regulars}</div>
            </div>
            {variety.laneMix.length ? (
              <div className="flex flex-wrap gap-1.5">
                {variety.laneMix.map((l) => (
                  <span
                    key={l.lane}
                    className="rounded-full border border-border bg-bg/50 px-2 py-0.5 text-[11px] text-muted"
                  >
                    {l.lane} · {l.n}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
          {!variety.people.length ? (
            <Hint>
              Nobody starred three different lanes this week. Stars from the last 7 days × bot tags
              fill this — pull notifications if it looks thin.
            </Hint>
          ) : (
            <div className="space-y-1.5">
              {variety.people.map((p) => (
                <div
                  key={p.senderId}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-bg/40 px-2.5 py-1.5"
                >
                  <span className="truncate text-xs font-medium">{p.senderName}</span>
                  <span className="flex flex-wrap items-center gap-1">
                    {p.lanes.map((l) => (
                      <span
                        key={l}
                        className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] text-primary"
                      >
                        {l}
                      </span>
                    ))}
                    <span className="text-[11px] text-faint">{p.stars}★</span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </Section>
      </div>

      <p className="flex items-center gap-1.5 text-[11px] text-faint">
        <Sparkles className="size-3" />
        Derived from warehouse files on read — New-feed, rivals, notifications, economy. No extra scrape.
      </p>
    </div>
  );
}
