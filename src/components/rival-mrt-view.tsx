import { Link } from "@tanstack/react-router";
import { ArrowLeftRight, LayoutDashboard } from "lucide-react";
import { formatDelta, formatNum, formatPct } from "@/lib/juicychat/format";
import type { RivalMrt } from "@/lib/juicychat/rival-mrt";

export function formatAge(days: number | null | undefined) {
  if (days == null || Number.isNaN(days)) return "—";
  if (days < 2) return `${Math.round(days * 24)}h`;
  if (days < 14) return `${days.toFixed(0)}d`;
  if (days < 60) return `${(days / 7).toFixed(0)}w`;
  return `${(days / 30).toFixed(1)}mo`;
}

export function cadenceLabel(c: RivalMrt["launch"]["cadence"] | null | undefined) {
  if (c === "burst") return "Burst";
  if (c === "steady") return "Steady";
  if (c === "sparse") return "Sparse";
  return "—";
}

function CadenceBars({ launch }: { launch: RivalMrt["launch"] }) {
  const maxDow = Math.max(1, ...launch.byDow.map((d) => d.n));
  const maxHour = Math.max(1, ...launch.byHour.map((d) => d.n));
  return (
    <>
      <div className="mb-2 flex items-end gap-1">
        {launch.byDow.map((d) => (
          <div key={d.day} className="flex flex-1 flex-col items-center gap-1">
            <div
              className="w-full rounded-sm bg-primary/70"
              style={{ height: `${8 + (d.n / maxDow) * 36}px` }}
            />
            <span className="text-[9px] text-faint">{d.label}</span>
          </div>
        ))}
      </div>
      <div className="flex h-10 items-end gap-px">
        {launch.byHour.map((h) => (
          <div
            key={h.hour}
            className="flex-1 rounded-sm bg-accent/70"
            style={{ height: `${4 + (h.n / maxHour) * 32}px` }}
            title={`${h.hour}:00 · ${h.n}`}
          />
        ))}
      </div>
    </>
  );
}

function TopicTable({
  mrt,
  isYou,
}: {
  mrt: RivalMrt;
  isYou?: boolean;
}) {
  if (isYou) {
    const rows = mrt.topics.overlap.length
      ? mrt.topics.overlap
      : mrt.topics.rivalOnly.map((t) => ({
          tag: t.tag,
          yourBots: t.bots,
          yourChats: t.chats,
          rivalBots: t.bots,
          rivalChats: t.chats,
        }));
    return (
      <div className="rounded-xl border border-border/70 bg-bg/30 p-3">
        <h3 className="mb-1 text-sm font-semibold">Your tags</h3>
        <p className="mb-2 text-[12px] text-muted">Public tags on your lounge, ranked by chats.</p>
        {rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-muted">
                <tr className="border-b border-border/60">
                  <th className="py-1 pr-2 font-medium">Tag</th>
                  <th className="py-1 pr-2 font-medium">Bots</th>
                  <th className="py-1 font-medium">Chats</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 10).map((t) => (
                  <tr key={t.tag} className="border-b border-border/30">
                    <td className="py-1 pr-2 font-medium">{t.tag}</td>
                    <td className="py-1 pr-2">{t.yourBots || t.rivalBots}</td>
                    <td className="py-1">{formatNum(t.yourChats || t.rivalChats)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted">No public tags on the cached lounge.</p>
        )}
        {mrt.topics.inferred.length ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {mrt.topics.inferred.slice(0, 10).map((t) => (
              <span
                key={t.topic}
                className="rounded-full border border-border bg-bg px-2 py-0.5 text-[10px]"
              >
                {t.topic}
                {t.yourBots ? ` · ${t.yourBots}` : ""}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border/70 bg-bg/30 p-3">
      <h3 className="mb-1 text-sm font-semibold">Topics vs your portfolio</h3>
      <p className="mb-2 text-[12px] text-muted">Shared tags they print on. Highest-value overlap first.</p>
      {mrt.topics.overlap.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-muted">
              <tr className="border-b border-border/60">
                <th className="py-1 pr-2 font-medium">Tag</th>
                <th className="py-1 pr-2 font-medium">Them</th>
                <th className="py-1 font-medium">You</th>
              </tr>
            </thead>
            <tbody>
              {mrt.topics.overlap.slice(0, 8).map((t) => (
                <tr key={t.tag} className="border-b border-border/30">
                  <td className="py-1 pr-2 font-medium">{t.tag}</td>
                  <td className="py-1 pr-2">
                    {t.rivalBots} · {formatNum(t.rivalChats)}
                  </td>
                  <td className="py-1">
                    {t.yourBots} · {formatNum(t.yourChats)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-muted">No shared tags in the public lists.</p>
      )}
      {mrt.topics.inferred.length ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {mrt.topics.inferred.slice(0, 8).map((t) => (
            <span key={t.topic} className="rounded-full border border-border bg-bg px-2 py-0.5 text-[10px]">
              {t.topic}
              {t.rivalBots && t.yourBots ? " · both" : t.rivalBots ? " · them" : " · you"}
            </span>
          ))}
        </div>
      ) : null}
      {mrt.topics.rivalOnly.length ? (
        <p className="mt-2 text-[11px] text-muted">
          They also print: {mrt.topics.rivalOnly.slice(0, 6).map((t) => t.tag).join(" · ")}
        </p>
      ) : null}
    </div>
  );
}

function TrafficTable({ mrt }: { mrt: RivalMrt }) {
  return (
    <div className="rounded-xl border border-border/70 bg-bg/30 p-3">
      <h3 className="mb-2 text-sm font-semibold">Bot traffic</h3>
      <p className="mb-2 text-[12px] text-muted">
        Top-3 share {formatPct(mrt.traffic.top3Share, 0)} · median {formatNum(mrt.traffic.medianChats)} chats
        · engagement {mrt.traffic.engagement != null ? mrt.traffic.engagement.toFixed(2) : "—"} likes+favs /
        chat
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-xs">
          <thead className="text-muted">
            <tr className="border-b border-border/60">
              <th className="py-1 pr-2 font-medium">Bot</th>
              <th className="py-1 pr-2 font-medium">Chats</th>
              <th className="py-1 pr-2 font-medium">Age</th>
              <th className="py-1 pr-2 font-medium">Score</th>
              <th className="py-1 pr-2 font-medium">Feeds</th>
              <th className="py-1 font-medium">Tags</th>
            </tr>
          </thead>
          <tbody>
            {mrt.traffic.topBots.map((b) => (
              <tr key={b.characterId} className="border-b border-border/30">
                <td className="max-w-[220px] truncate py-1.5 pr-2 font-medium">{b.characterName}</td>
                <td className="py-1.5 pr-2">{formatNum(b.chats)}</td>
                <td className="py-1.5 pr-2">{formatAge(b.ageDays)}</td>
                <td className="py-1.5 pr-2">{b.score10 != null ? b.score10.toFixed(1) : "—"}</td>
                <td className="py-1.5 pr-2 text-muted">{b.feeds.join(" · ") || "—"}</td>
                <td className="max-w-[220px] truncate py-1.5 text-muted">{b.tags.join(" · ") || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DiscoveryCards({ mrt, isYou }: { mrt: RivalMrt; isYou?: boolean }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="rounded-xl border border-border/70 bg-bg/30 p-3 text-xs">
        <h3 className="mb-1 text-sm font-semibold">Discovery</h3>
        <p className="text-muted">
          Editor {mrt.discovery.onEditor} · Trending {mrt.discovery.onTrending} · Immersive{" "}
          {mrt.discovery.onImmersive ?? 0} · Popular {mrt.discovery.onPopular} · Recent{" "}
          {mrt.discovery.onRecent} · New {mrt.discovery.onNew}
        </p>
        {mrt.discovery.bots.length ? (
          <ul className="mt-2 space-y-1">
            {mrt.discovery.bots.slice(0, 6).map((b) => (
              <li key={b.characterId} className="flex justify-between gap-2">
                <span className="truncate">{b.characterName}</span>
                <span className="shrink-0 text-muted">
                  {b.feeds.map((f) => (b.ranks[f] != null ? `${f}#${b.ranks[f]}` : f)).join(" ")}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-muted">No hits in the last scanned discovery pages.</p>
        )}
      </div>
      <div className="rounded-xl border border-border/70 bg-bg/30 p-3 text-xs">
        <h3 className="mb-1 text-sm font-semibold">Character 30d ranks + comments</h3>
        {mrt.characterRanks30d.length ? (
          <ul className="space-y-1">
            {mrt.characterRanks30d.slice(0, 6).map((b) => (
              <li key={b.characterId} className="flex justify-between gap-2">
                <span className="truncate">
                  #{b.rank} {b.characterName}
                </span>
                <span className="text-muted">{formatNum(b.chats)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted">
            {isYou
              ? "None of your bots in the scanned 30d character board."
              : "None of their bots in the scanned 30d character board."}
          </p>
        )}
        {mrt.enrichment.length ? (
          <p className="mt-2 text-muted">
            Detail on {mrt.enrichment.length} bots
            {mrt.enrichment.some((e) => e.commentCount)
              ? ` · comments ${mrt.enrichment.map((e) => e.commentCount || 0).reduce((s, n) => s + n, 0)}`
              : ""}
            {mrt.enrichment.some((e) => e.definitionLen)
              ? ` · card ${Math.round(
                  mrt.enrichment.reduce((s, e) => s + (e.definitionLen || 0), 0) /
                    Math.max(1, mrt.enrichment.filter((e) => e.definitionLen).length),
                )} chars avg`
              : ""}
            {mrt.enrichment.some((e) => e.memoryCount)
              ? ` · memory ${mrt.enrichment.reduce((s, e) => s + (e.memoryCount || 0), 0)}`
              : ""}
          </p>
        ) : (
          <p className="mt-2 text-muted">
            {isYou
              ? "Bot-level comments and card length live in Forensics."
              : "Deep scrape fills comments and card length on their top bots."}
          </p>
        )}
        {mrt.rankAllTime != null ? (
          <p className="mt-1 text-muted">All-time ALL #{mrt.rankAllTime}</p>
        ) : null}
      </div>
    </div>
  );
}

/** Same dossier body used for You and for a rival. */
export function MrtPanels({ mrt, isYou }: { mrt: RivalMrt; isYou?: boolean }) {
  const kpi = isYou
    ? [
        ["Chats", formatNum(mrt.profile.chats), cadenceLabel(mrt.launch.cadence)],
        [
          "Likes",
          formatNum(mrt.profile.likes),
          mrt.traffic.engagement != null ? `${mrt.traffic.engagement.toFixed(2)} eng` : "",
        ],
        [
          "Followers",
          formatNum(mrt.profile.followers),
          mrt.profile.following != null ? `${formatNum(mrt.profile.following)} following` : "",
        ],
        [
          "Public bots",
          formatNum(mrt.profile.publicBots),
          mrt.traffic.chatsPerBot != null ? `${formatNum(mrt.traffic.chatsPerBot)} /bot` : "",
        ],
        ["Δ day chats", formatDelta(mrt.vsYou.dodChats), "vs last scrape"],
        ["Δ 7d chats", formatDelta(mrt.vsYou.d7Chats), "week"],
      ]
    : [
        [
          "Chats",
          formatNum(mrt.profile.chats),
          mrt.vsYou.chatRatio != null ? `${mrt.vsYou.chatRatio.toFixed(2)}× you` : "",
        ],
        [
          "Likes",
          formatNum(mrt.profile.likes),
          mrt.vsYou.likeRatio != null ? `${mrt.vsYou.likeRatio.toFixed(2)}× you` : "",
        ],
        [
          "Followers",
          formatNum(mrt.profile.followers),
          mrt.vsYou.followerRatio != null ? `${mrt.vsYou.followerRatio.toFixed(2)}× you` : "",
        ],
        [
          "Public bots",
          formatNum(mrt.profile.publicBots),
          mrt.vsYou.botRatio != null ? `${mrt.vsYou.botRatio.toFixed(2)}× you` : "",
        ],
        ["Δ day chats", formatDelta(mrt.vsYou.dodChats), "vs last scrape"],
        ["Δ 7d chats", formatDelta(mrt.vsYou.d7Chats), "week"],
      ];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
        {kpi.map(([l, v, s]) => (
          <div key={l} className="rounded-xl border border-border/70 bg-bg/40 px-3 py-2">
            <div className="text-[10px] uppercase tracking-wide text-faint">{l}</div>
            <div className="text-lg font-semibold">{v}</div>
            <div className="text-[11px] text-muted">{s}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-border/70 bg-bg/30 p-3">
          <h3 className="mb-1 text-sm font-semibold">Launch cadence</h3>
          <p className="mb-2 text-[12px] text-muted">
            {cadenceLabel(mrt.launch.cadence)} · {mrt.launch.last7} in 7d · {mrt.launch.last30} in 30d ·{" "}
            {mrt.launch.last90} in 90d
            {mrt.launch.meanGapDays != null ? ` · mean gap ${mrt.launch.meanGapDays.toFixed(1)}d` : ""}
            {mrt.launch.bestSlot ? ` · cluster ${mrt.launch.bestSlot} Madrid` : ""}
            {mrt.launch.newestAgeDays != null ? ` · newest ${formatAge(mrt.launch.newestAgeDays)}` : ""}
          </p>
          <CadenceBars launch={mrt.launch} />
          {mrt.launch.recent.length ? (
            <ul className="mt-3 space-y-1 text-xs">
              {mrt.launch.recent.slice(0, 6).map((b) => (
                <li key={b.characterId} className="flex justify-between gap-2">
                  <span className="truncate">{b.characterName}</span>
                  <span className="shrink-0 text-muted">
                    {formatAge(b.ageDays)} · {formatNum(b.chats)}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <TopicTable mrt={mrt} isYou={isYou} />
      </div>

      <TrafficTable mrt={mrt} />
      <DiscoveryCards mrt={mrt} isYou={isYou} />
    </div>
  );
}

export function YouMrtCard({
  mrt,
  userName,
}: {
  mrt: RivalMrt;
  userName?: string | null;
}) {
  return (
    <section className="mb-5 rounded-2xl border border-primary/30 bg-surface/90 p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-faint">Complete MRT · You</div>
          <h2 className="font-display text-2xl font-bold">
            You · @{userName || mrt.userName}
            {mrt.rank30d != null ? (
              <span className="ml-2 text-base font-semibold text-muted">#{mrt.rank30d} · 30d ALL</span>
            ) : null}
          </h2>
          <p className="mt-1 max-w-xl text-sm text-muted">
            {mrt.profile.bio ||
              "Same dossier layout as a rival — built from your lounge warehouse, not a rival scrape."}
          </p>
        </div>
        <Link
          to="/lounge"
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium"
        >
          <LayoutDashboard className="size-3.5" />
          Lounge
        </Link>
      </div>
      <MrtPanels mrt={mrt} isYou />
    </section>
  );
}

function ratio(a: number | null | undefined, b: number | null | undefined): string {
  if (a == null || b == null || !Number.isFinite(a) || !Number.isFinite(b) || b <= 0) return "—";
  return `${(a / b).toFixed(2)}×`;
}

function leadOf(
  you: number | null | undefined,
  them: number | null | undefined,
  invert = false,
): "you" | "them" | "tie" | null {
  if (you == null || them == null || Number.isNaN(you) || Number.isNaN(them)) return null;
  if (you === them) return "tie";
  const youWins = invert ? you < them : you > them;
  return youWins ? "you" : "them";
}

function leadClass(lead: "you" | "them" | "tie" | null) {
  if (lead === "you") return "text-success";
  if (lead === "them") return "text-danger";
  return "text-muted";
}

function MiniBots({ mrt, empty }: { mrt: RivalMrt; empty: string }) {
  if (!mrt.traffic.topBots.length) return <p className="text-sm text-muted">{empty}</p>;
  return (
    <ul className="space-y-1.5 text-xs">
      {mrt.traffic.topBots.slice(0, 8).map((b) => (
        <li key={b.characterId} className="flex justify-between gap-2">
          <span className="truncate font-medium">{b.characterName}</span>
          <span className="shrink-0 text-muted">
            {formatNum(b.chats)} · {formatAge(b.ageDays)}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function MrtDuel({
  you,
  them,
  youName,
  themName,
}: {
  you: RivalMrt;
  them: RivalMrt;
  youName?: string | null;
  themName?: string | null;
}) {
  const yName = youName || you.userName || "You";
  const tName = themName || them.userName || "Them";

  const rows: Array<{
    label: string;
    you: string;
    them: string;
    delta: string;
    lead: "you" | "them" | "tie" | null;
  }> = [
    {
      label: "30d rank",
      you: you.rank30d != null ? `#${you.rank30d}` : "—",
      them: them.rank30d != null ? `#${them.rank30d}` : "—",
      delta:
        you.rank30d != null && them.rank30d != null
          ? you.rank30d === them.rank30d
            ? "tied"
            : you.rank30d < them.rank30d
              ? `${them.rank30d - you.rank30d} ahead`
              : `${you.rank30d - them.rank30d} behind`
          : "—",
      lead: leadOf(you.rank30d, them.rank30d, true),
    },
    {
      label: "All-time",
      you: you.rankAllTime != null ? `#${you.rankAllTime}` : "—",
      them: them.rankAllTime != null ? `#${them.rankAllTime}` : "—",
      delta:
        you.rankAllTime != null && them.rankAllTime != null
          ? you.rankAllTime === them.rankAllTime
            ? "tied"
            : you.rankAllTime < them.rankAllTime
              ? `${them.rankAllTime - you.rankAllTime} ahead`
              : `${you.rankAllTime - them.rankAllTime} behind`
          : "—",
      lead: leadOf(you.rankAllTime, them.rankAllTime, true),
    },
    {
      label: "Chats",
      you: formatNum(you.profile.chats),
      them: formatNum(them.profile.chats),
      delta: ratio(them.profile.chats, you.profile.chats),
      lead: leadOf(you.profile.chats, them.profile.chats),
    },
    {
      label: "Likes",
      you: formatNum(you.profile.likes),
      them: formatNum(them.profile.likes),
      delta: ratio(them.profile.likes, you.profile.likes),
      lead: leadOf(you.profile.likes, them.profile.likes),
    },
    {
      label: "Followers",
      you: formatNum(you.profile.followers),
      them: formatNum(them.profile.followers),
      delta: ratio(them.profile.followers, you.profile.followers),
      lead: leadOf(you.profile.followers, them.profile.followers),
    },
    {
      label: "Public bots",
      you: formatNum(you.profile.publicBots),
      them: formatNum(them.profile.publicBots),
      delta: ratio(them.profile.publicBots, you.profile.publicBots),
      lead: leadOf(you.profile.publicBots, them.profile.publicBots),
    },
    {
      label: "Δ day chats",
      you: formatDelta(you.vsYou.dodChats),
      them: formatDelta(them.vsYou.dodChats),
      delta: formatDelta((you.vsYou.dodChats ?? 0) - (them.vsYou.dodChats ?? 0)),
      lead: leadOf(you.vsYou.dodChats, them.vsYou.dodChats),
    },
    {
      label: "Δ 7d chats",
      you: formatDelta(you.vsYou.d7Chats),
      them: formatDelta(them.vsYou.d7Chats),
      delta: formatDelta((you.vsYou.d7Chats ?? 0) - (them.vsYou.d7Chats ?? 0)),
      lead: leadOf(you.vsYou.d7Chats, them.vsYou.d7Chats),
    },
    {
      label: "Launches 30d",
      you: String(you.launch.last30),
      them: String(them.launch.last30),
      delta: formatDelta(you.launch.last30 - them.launch.last30),
      lead: leadOf(you.launch.last30, them.launch.last30),
    },
    {
      label: "Launches 7d",
      you: String(you.launch.last7),
      them: String(them.launch.last7),
      delta: formatDelta(you.launch.last7 - them.launch.last7),
      lead: leadOf(you.launch.last7, them.launch.last7),
    },
    {
      label: "Mean gap",
      you: you.launch.meanGapDays != null ? `${you.launch.meanGapDays.toFixed(1)}d` : "—",
      them: them.launch.meanGapDays != null ? `${them.launch.meanGapDays.toFixed(1)}d` : "—",
      delta:
        you.launch.meanGapDays != null && them.launch.meanGapDays != null
          ? `${(you.launch.meanGapDays - them.launch.meanGapDays).toFixed(1)}d`
          : "—",
      lead: leadOf(you.launch.meanGapDays, them.launch.meanGapDays, true),
    },
    {
      label: "Cadence",
      you: cadenceLabel(you.launch.cadence),
      them: cadenceLabel(them.launch.cadence),
      delta: you.launch.cadence === them.launch.cadence ? "same" : "—",
      lead: null,
    },
    {
      label: "Best slot",
      you: you.launch.bestSlot || "—",
      them: them.launch.bestSlot || "—",
      delta: "Madrid",
      lead: null,
    },
    {
      label: "Top-3 share",
      you: formatPct(you.traffic.top3Share, 0),
      them: formatPct(them.traffic.top3Share, 0),
      delta:
        you.traffic.top3Share != null && them.traffic.top3Share != null
          ? `${((you.traffic.top3Share - them.traffic.top3Share) * 100 >= 0 ? "+" : "")}${((you.traffic.top3Share - them.traffic.top3Share) * 100).toFixed(0)}pp`
          : "—",
      lead: leadOf(you.traffic.top3Share, them.traffic.top3Share, true),
    },
    {
      label: "Median chats",
      you: formatNum(you.traffic.medianChats),
      them: formatNum(them.traffic.medianChats),
      delta: ratio(them.traffic.medianChats, you.traffic.medianChats),
      lead: leadOf(you.traffic.medianChats, them.traffic.medianChats),
    },
    {
      label: "Chats / bot",
      you: formatNum(you.traffic.chatsPerBot),
      them: formatNum(them.traffic.chatsPerBot),
      delta: ratio(them.traffic.chatsPerBot, you.traffic.chatsPerBot),
      lead: leadOf(you.traffic.chatsPerBot, them.traffic.chatsPerBot),
    },
    {
      label: "Engagement",
      you: you.traffic.engagement != null ? you.traffic.engagement.toFixed(2) : "—",
      them: them.traffic.engagement != null ? them.traffic.engagement.toFixed(2) : "—",
      delta: ratio(them.traffic.engagement, you.traffic.engagement),
      lead: leadOf(you.traffic.engagement, them.traffic.engagement),
    },
    {
      label: "Editor hits",
      you: String(you.discovery.onEditor),
      them: String(them.discovery.onEditor),
      delta: formatDelta(you.discovery.onEditor - them.discovery.onEditor),
      lead: leadOf(you.discovery.onEditor, them.discovery.onEditor),
    },
    {
      label: "Trending hits",
      you: String(you.discovery.onTrending),
      them: String(them.discovery.onTrending),
      delta: formatDelta(you.discovery.onTrending - them.discovery.onTrending),
      lead: leadOf(you.discovery.onTrending, them.discovery.onTrending),
    },
    {
      label: "Immersive hits",
      you: String(you.discovery.onImmersive ?? 0),
      them: String(them.discovery.onImmersive ?? 0),
      delta: formatDelta((you.discovery.onImmersive ?? 0) - (them.discovery.onImmersive ?? 0)),
      lead: leadOf(you.discovery.onImmersive ?? 0, them.discovery.onImmersive ?? 0),
    },
  ];

  const overlap = them.topics.overlap;

  return (
    <div className="space-y-5">
      <div className="overflow-x-auto rounded-xl border border-border/70 bg-bg/30">
        <table className="w-full min-w-[520px] text-left text-xs">
          <thead className="text-muted">
            <tr className="border-b border-border/60">
              <th className="px-3 py-2 font-medium">KPI</th>
              <th className="px-3 py-2 font-medium">You · @{yName}</th>
              <th className="px-3 py-2 font-medium">@{tName}</th>
              <th className="px-3 py-2 font-medium">Δ / vs you</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} className="border-b border-border/30">
                <td className="px-3 py-1.5 text-muted">{r.label}</td>
                <td className="px-3 py-1.5 font-semibold">{r.you}</td>
                <td className="px-3 py-1.5 font-semibold">{r.them}</td>
                <td className={`px-3 py-1.5 ${leadClass(r.lead)}`}>{r.delta}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="px-3 py-2 text-[10px] text-faint">
          Green = you lead. Rank / mean gap / top-3 share invert (lower is better). Ratios are them ÷ you.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-border/70 bg-bg/30 p-3">
          <h3 className="mb-1 text-sm font-semibold">You · cadence</h3>
          <p className="mb-2 text-[12px] text-muted">
            {cadenceLabel(you.launch.cadence)} · {you.launch.last30} in 30d
            {you.launch.bestSlot ? ` · ${you.launch.bestSlot}` : ""}
          </p>
          <CadenceBars launch={you.launch} />
        </div>
        <div className="rounded-xl border border-border/70 bg-bg/30 p-3">
          <h3 className="mb-1 text-sm font-semibold">@{tName} · cadence</h3>
          <p className="mb-2 text-[12px] text-muted">
            {cadenceLabel(them.launch.cadence)} · {them.launch.last30} in 30d
            {them.launch.bestSlot ? ` · ${them.launch.bestSlot}` : ""}
          </p>
          <CadenceBars launch={them.launch} />
        </div>
      </div>

      <div className="rounded-xl border border-border/70 bg-bg/30 p-3">
        <h3 className="mb-1 text-sm font-semibold">Topic overlap</h3>
        <p className="mb-2 text-[12px] text-muted">Tags you both print. Highest combined chats first.</p>
        {overlap.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-muted">
                <tr className="border-b border-border/60">
                  <th className="py-1 pr-2 font-medium">Tag</th>
                  <th className="py-1 pr-2 font-medium">You</th>
                  <th className="py-1 font-medium">Them</th>
                </tr>
              </thead>
              <tbody>
                {overlap.slice(0, 10).map((t) => (
                  <tr key={t.tag} className="border-b border-border/30">
                    <td className="py-1 pr-2 font-medium">{t.tag}</td>
                    <td className="py-1 pr-2">
                      {t.yourBots} · {formatNum(t.yourChats)}
                    </td>
                    <td className="py-1">
                      {t.rivalBots} · {formatNum(t.rivalChats)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted">No shared public tags.</p>
        )}
        <div className="mt-3 grid gap-2 sm:grid-cols-2 text-[11px] text-muted">
          <p>
            You only:{" "}
            {them.topics.yourOnly.length
              ? them.topics.yourOnly.slice(0, 6).map((t) => t.tag).join(" · ")
              : "—"}
          </p>
          <p>
            Them only:{" "}
            {them.topics.rivalOnly.length
              ? them.topics.rivalOnly.slice(0, 6).map((t) => t.tag).join(" · ")
              : "—"}
          </p>
        </div>
        {them.topics.inferred.length ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {them.topics.inferred.slice(0, 8).map((t) => (
              <span key={t.topic} className="rounded-full border border-border bg-bg px-2 py-0.5 text-[10px]">
                {t.topic}
                {t.rivalBots && t.yourBots ? " · both" : t.rivalBots ? " · them" : " · you"}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-border/70 bg-bg/30 p-3">
          <h3 className="mb-2 text-sm font-semibold">Your top bots</h3>
          <MiniBots mrt={you} empty="No bots in the warehouse snapshot." />
        </div>
        <div className="rounded-xl border border-border/70 bg-bg/30 p-3">
          <h3 className="mb-2 text-sm font-semibold">@{tName} · top bots</h3>
          <MiniBots mrt={them} empty="Deep scrape their space to fill traffic." />
        </div>
      </div>
    </div>
  );
}

export function DuelHeader({
  youName,
  themName,
  youRank,
  themRank,
  youCadence,
  themCadence,
}: {
  youName?: string | null;
  themName?: string | null;
  youRank?: number | null;
  themRank?: number | null;
  youCadence?: RivalMrt["launch"]["cadence"] | null;
  themCadence?: RivalMrt["launch"]["cadence"] | null;
}) {
  return (
    <div>
      <div className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-faint">
        <ArrowLeftRight className="size-3" />
        1v1
      </div>
      <h2 className="font-display text-2xl font-bold">
        You · @{youName || "you"}
        <span className="mx-2 text-muted">vs</span>@{themName || "rival"}
      </h2>
      <p className="mt-1 text-sm text-muted">
        {youRank != null ? `#${youRank}` : "—"} {cadenceLabel(youCadence).toLowerCase()}
        <span className="mx-2 text-faint">·</span>
        {themRank != null ? `#${themRank}` : "—"} {cadenceLabel(themCadence).toLowerCase()}
        <span className="ml-2 text-faint">Same MRT signals, side by side.</span>
      </p>
    </div>
  );
}
