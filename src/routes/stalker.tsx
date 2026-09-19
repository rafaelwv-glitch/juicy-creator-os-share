import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import {
  ArrowLeft,
  ArrowLeftRight,
  Crosshair,
  Loader2,
  Pin,
  Plus,
  RefreshCw,
  Trash2,
  Users,
} from "lucide-react";
import {
  addRivalCreator,
  compareTrackedCreators,
  listRivals,
  loadCachedSnapshot,
  pinRivalCreator,
  refreshAllRivals,
  refreshRivalCreator,
  removeRivalCreator,
} from "@/lib/juicychat/actions";
import { DesktopNavLinks, MobileNav } from "@/components/mobile-nav";
import {
  DuelHeader,
  MrtDuel,
  MrtPanels,
  YouMrtCard,
  cadenceLabel,
} from "@/components/rival-mrt-view";
import { formatDelta, formatNum, formatWhen } from "@/lib/juicychat/format";
import type {
  PairCompareResult,
  RivalCompareResult,
  RivalEntry,
  RivalMrt,
  RivalsFile,
  TrackedCreatorRef,
} from "@/lib/juicychat/rivals";
import { browserCacheReady, rememberBrowserCache } from "@/lib/juicychat/browser-sync";

export const Route = createFileRoute("/stalker")({ component: StalkerPage });

const PAIR_LS = "juicy-mrt-pair";

type RivalFn = {
  file: RivalsFile;
  compare: RivalCompareResult;
  tracked?: TrackedCreatorRef[];
  entry?: RivalEntry;
};

function readSavedPair(): { leftId: string | null; rightId: string | null } {
  try {
    const raw = sessionStorage.getItem(PAIR_LS);
    if (!raw) return { leftId: null, rightId: null };
    const p = JSON.parse(raw) as { leftId?: string; rightId?: string };
    return { leftId: p.leftId || null, rightId: p.rightId || null };
  } catch {
    return { leftId: null, rightId: null };
  }
}

function writeSavedPair(leftId: string | null, rightId: string | null) {
  try {
    sessionStorage.setItem(PAIR_LS, JSON.stringify({ leftId, rightId }));
  } catch {
    /* */
  }
}

function defaultPair(tracked: TrackedCreatorRef[], saved?: { leftId: string | null; rightId: string | null }) {
  const ids = tracked.map((t) => t.userId);
  const savedLeft = saved?.leftId && ids.includes(saved.leftId) ? saved.leftId : null;
  const savedRight = saved?.rightId && ids.includes(saved.rightId) ? saved.rightId : null;
  const leftId = savedLeft || ids[0] || null;
  const rightId =
    savedRight && savedRight !== leftId
      ? savedRight
      : ids.find((id) => id !== leftId) || leftId;
  return { leftId, rightId };
}

function StalkerPage() {
  const [file, setFile] = useState<RivalsFile | null>(null);
  const [compare, setCompare] = useState<RivalCompareResult | null>(null);
  const [link, setLink] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [ok, setOk] = useState<boolean | null>(null);
  const [youBots, setYouBots] = useState(0);
  const [leftId, setLeftId] = useState<string | null>(null);
  const [rightId, setRightId] = useState<string | null>(null);
  const [tracked, setTracked] = useState<TrackedCreatorRef[]>([]);
  const [pair, setPair] = useState<PairCompareResult | null>(null);
  const [pairBusy, setPairBusy] = useState(false);
  const [deepAll, setDeepAll] = useState(false);

  const applyRoster = useCallback((res: RivalFn) => {
    setFile(res.file);
    setCompare(res.compare);
    const list = res.tracked?.length
      ? res.tracked
      : res.compare.rows.map((r) => ({
          userId: r.userId,
          userName: r.userName,
          isYou: r.isYou,
          source: r.source,
          rank30d: r.rank30d,
          hasSnapshot: true,
          hasMrt: Boolean(r.isYou ? res.compare.youMrt : res.file.rivals.find((x) => x.userId === r.userId)?.mrt),
        }));
    setTracked(list);
    const next = defaultPair(list, { leftId, rightId: rightId ?? null });
    if (!leftId && next.leftId) setLeftId(next.leftId);
    if (!rightId && next.rightId) setRightId(next.rightId);
  }, [leftId, rightId]);

  const loadPair = useCallback(async (left: string | null, right: string | null) => {
    if (!left || !right) {
      setPair(null);
      return;
    }
    setPairBusy(true);
    try {
      const res = (await compareTrackedCreators({ data: { leftId: left, rightId: right } })) as {
        pair: PairCompareResult | null;
        tracked?: TrackedCreatorRef[];
      };
      setPair(res.pair);
      if (res.tracked?.length) setTracked(res.tracked);
      writeSavedPair(left, right);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
      setOk(false);
    } finally {
      setPairBusy(false);
    }
  }, []);

  const reload = useCallback(async () => {
    await browserCacheReady();
    const res = (await listRivals()) as RivalFn;
    const list = res.tracked?.length
      ? res.tracked
      : res.compare.rows.map((r) => ({
          userId: r.userId,
          userName: r.userName,
          isYou: r.isYou,
          source: r.source,
          rank30d: r.rank30d,
          hasSnapshot: true,
          hasMrt: Boolean(r.isYou ? res.compare.youMrt : res.file.rivals.find((x) => x.userId === r.userId)?.mrt),
        }));
    setFile(res.file);
    setCompare(res.compare);
    setTracked(list);
    const saved = readSavedPair();
    const next = defaultPair(list, saved);
    setLeftId(next.leftId);
    setRightId(next.rightId);
    try {
      const cached = await loadCachedSnapshot();
      setYouBots(cached?.snapshot?.bots?.length ?? 0);
    } catch {
      /* */
    }
  }, []);

  const pickRight = (userId: string) => {
    setRightId(userId);
    if (!leftId) setLeftId(userId);
  };

  const pickLeft = (userId: string) => {
    setLeftId(userId);
    if (!rightId) {
      const other = tracked.find((t) => t.userId !== userId)?.userId;
      if (other) setRightId(other);
    }
  };

  const swapPair = () => {
    if (!leftId && !rightId) return;
    const nextLeft = rightId;
    const nextRight = leftId;
    setLeftId(nextLeft);
    setRightId(nextRight);
  };

  useEffect(() => {
    void reload().catch((e) => {
      setMsg(e instanceof Error ? e.message : String(e));
      setOk(false);
    });
  }, [reload]);

  useEffect(() => {
    if (!leftId || !rightId) return;
    void loadPair(leftId, rightId);
  }, [leftId, rightId, loadPair]);

  const onAdd = async () => {
    if (!link.trim()) {
      setMsg("Paste a lounge link or user id");
      setOk(false);
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const res = (await addRivalCreator({
        data: { linkOrId: link.trim(), label: label.trim() || undefined },
      })) as RivalFn & { entry: RivalEntry };
      applyRoster(res);
      setRightId(res.entry.userId);
      setLink("");
      setLabel("");
      setMsg(`Pinned @${res.entry.userName || res.entry.userId}`);
      setOk(true);
      void rememberBrowserCache();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
      setOk(false);
    } finally {
      setBusy(false);
    }
  };

  const onRefreshAll = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = (await refreshAllRivals({ data: { enrich: deepAll } })) as RivalFn;
      applyRoster(res);
      const mrtDays = res.file.rivals.reduce((s, r) => s + (r.mrtLog?.length || 0), 0);
      setMsg(
        `Refreshed ${res.file.rivals.length} creators · ${mrtDays} MRT days kept` +
          (deepAll ? " · deep scrape on" : "") +
          (res.file.alumni?.length ? ` · ${res.file.alumni.length} alumni archived` : ""),
      );
      setOk(true);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
      setOk(false);
    } finally {
      setBusy(false);
    }
  };

  const onRefreshOne = async (userId: string) => {
    setBusy(true);
    try {
      const res = (await refreshRivalCreator({ data: { userId } })) as RivalFn & { entry: RivalEntry };
      applyRoster(res);
      setRightId(userId);
      setMsg(`MRT updated @${res.entry.userName || userId}`);
      setOk(true);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
      setOk(false);
    } finally {
      setBusy(false);
    }
  };

  const onPin = async (userId: string) => {
    setBusy(true);
    try {
      const res = (await pinRivalCreator({ data: { userId } })) as RivalFn;
      applyRoster(res);
      setMsg("Pinned — stays even if they leave the 30d window");
      setOk(true);
      void rememberBrowserCache();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
      setOk(false);
    } finally {
      setBusy(false);
    }
  };

  const onRemove = async (userId: string) => {
    if (!confirm("Stop tracking this creator? Auto-neighbors you drop will not come back until you add them.")) return;
    setBusy(true);
    try {
      const res = (await removeRivalCreator({ data: { userId } })) as RivalFn;
      applyRoster(res);
      if (rightId === userId) setRightId(res.compare.rows.find((r) => r.userId !== leftId)?.userId ?? leftId);
      if (leftId === userId) setLeftId(res.compare.rows[0]?.userId ?? null);
      setMsg("Removed");
      setOk(true);
      void rememberBrowserCache();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
      setOk(false);
    } finally {
      setBusy(false);
    }
  };

  const rivals = file?.rivals ?? [];
  const manuals = rivals.filter((r) => r.source !== "neighbor").length;
  const neighbors = compare?.neighbors;
  const rightEntry = rivals.find((r) => r.userId === rightId) || null;
  const strip = useMemo(() => {
    const above = neighbors?.above || [];
    const below = neighbors?.below || [];
    const you = neighbors?.you;
    return [
      ...above.map((h) => ({ ...h, kind: "above" as const })),
      ...(you ? [{ ...you, kind: "you" as const }] : []),
      ...below.map((h) => ({ ...h, kind: "below" as const })),
    ];
  }, [neighbors]);

  return (
    <div className="min-h-[calc(100dvh-var(--grok-banner-h,0px))] bg-bg pb-24 text-fg md:pb-10">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -left-20 top-10 h-64 w-64 rounded-full bg-primary/20 blur-3xl" />
        <div className="absolute bottom-20 right-0 h-72 w-72 rounded-full bg-accent/10 blur-3xl" />
      </div>

      <div className="relative mx-auto max-w-6xl px-4 pt-6 sm:px-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-muted hover:text-fg"
          >
            <ArrowLeft className="size-3.5" /> Home
          </Link>
          <DesktopNavLinks />
        </div>

        <header className="mb-6">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface/80 px-2.5 py-0.5 text-[11px] font-medium text-muted">
            <Crosshair className="size-3 text-primary" />
            Rival radar
          </div>
          <h1 className="font-display mt-2 text-3xl font-bold tracking-tight">
            30-day neighbours & <span className="text-muted">MRT</span>
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            Auto-tracks 3 above and 3 below you on 30-day ALL. Pinned creators stay. Compare any two
            tracked creators — overlap and ratios use the left side as baseline, not only your lounge.
            {youBots ? ` Your lounge: ${youBots} bots cached.` : " Refresh Lounge to include your row in the picker."}
          </p>
        </header>

        <section className="mb-5 rounded-2xl border border-border bg-surface/90 p-4 sm:p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">Trending · ALL neighbourhood</h2>
            <span className="text-[11px] text-muted">
              {neighbors?.you?.rank != null ? `You #${neighbors.you.rank}` : "Need a 30d ranklist"}
              {file?.neighborSyncedAt ? ` · synced ${formatWhen(file.neighborSyncedAt)}` : ""}
            </span>
          </div>
          {strip.length ? (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {strip.map((h) => (
                <button
                  key={`${h.kind}-${h.userId}`}
                  type="button"
                  onClick={() => pickRight(h.userId)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    pickLeft(h.userId);
                  }}
                  className={`min-w-[132px] rounded-xl border px-3 py-2 text-left ${
                    rightId === h.userId
                      ? "border-primary bg-elevated"
                      : leftId === h.userId
                        ? "border-primary/50 bg-primary/10"
                        : h.kind === "you"
                          ? "border-primary/40 bg-primary/10 hover:border-primary/60"
                          : "border-border bg-bg/50 hover:border-border-strong"
                  }`}
                >
                  <div className="text-[10px] uppercase tracking-wide text-faint">
                    {h.kind === "you" ? "You" : h.kind === "above" ? "Above" : "Below"} · #{h.rank}
                  </div>
                  <div className="truncate text-sm font-semibold">{h.userName}</div>
                  {"chatCount" in h && h.chatCount != null ? (
                    <div className="text-[11px] text-muted">{formatNum(h.chatCount)} chats</div>
                  ) : null}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted">
              30-day ALL ranklist is empty — run Refresh all on Lounge so neighbours can lock.
            </p>
          )}
        </section>

        <section className="mb-5 rounded-2xl border border-primary/30 bg-surface/90 p-4 sm:p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">Compare any two tracked</h2>
            <span className="text-[11px] text-muted">
              Left is the baseline. Click a chip or row to set the right side.
              {pairBusy ? " · updating…" : ""}
            </span>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="min-w-[180px] flex-1 text-[11px] text-muted">
              Left
              <select
                value={leftId || ""}
                onChange={(e) => pickLeft(e.target.value)}
                className="mt-1 h-11 w-full rounded-xl border border-border bg-bg px-3 text-sm text-fg outline-none ring-primary/40 focus:ring-2"
              >
                <option value="">Select creator</option>
                {tracked.map((t) => (
                  <option key={`l-${t.userId}`} value={t.userId}>
                    {t.isYou ? "You · " : t.source === "alumni" ? "Alumni · " : t.source === "neighbor" ? "~ " : ""}
                    {t.userName}
                    {t.rank30d != null ? ` · #${t.rank30d}` : ""}
                    {t.hasSnapshot ? "" : " · no snapshot"}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={swapPair}
              disabled={!leftId || !rightId || leftId === rightId}
              className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-bg text-primary disabled:opacity-40"
              title="Swap sides"
            >
              <ArrowLeftRight className="size-4" />
            </button>
            <label className="min-w-[180px] flex-1 text-[11px] text-muted">
              Right
              <select
                value={rightId || ""}
                onChange={(e) => pickRight(e.target.value)}
                className="mt-1 h-11 w-full rounded-xl border border-border bg-bg px-3 text-sm text-fg outline-none ring-primary/40 focus:ring-2"
              >
                <option value="">Select creator</option>
                {tracked.map((t) => (
                  <option key={`r-${t.userId}`} value={t.userId}>
                    {t.isYou ? "You · " : t.source === "alumni" ? "Alumni · " : t.source === "neighbor" ? "~ " : ""}
                    {t.userName}
                    {t.rank30d != null ? ` · #${t.rank30d}` : ""}
                    {t.hasSnapshot ? "" : " · no snapshot"}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </section>

        <section className="mb-5 rounded-2xl border border-border bg-surface/90 p-4 sm:p-5">
          <h2 className="mb-3 text-sm font-semibold">Pin a creator</h2>
          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <div className="space-y-2">
              <input
                value={link}
                onChange={(e) => setLink(e.target.value)}
                placeholder="https://www.juicychat.ai/userdetailspace/2045… or raw user id"
                className="h-11 w-full rounded-xl border border-border bg-bg px-3 text-sm outline-none ring-primary/40 focus:ring-2"
                disabled={busy}
              />
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Optional nickname"
                className="h-10 w-full rounded-xl border border-border bg-bg px-3 text-sm outline-none ring-primary/40 focus:ring-2"
                disabled={busy}
              />
            </div>
            <div className="flex flex-col gap-2 sm:w-44">
              <button
                type="button"
                onClick={() => void onAdd()}
                disabled={busy}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-fg disabled:opacity-55"
              >
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                Pin
              </button>
              <button
                type="button"
                onClick={() => void onRefreshAll()}
                disabled={busy}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-border bg-bg px-3 text-xs font-semibold disabled:opacity-55"
              >
                <RefreshCw className="size-3.5" />
                Refresh radar
              </button>
              <label className="flex cursor-pointer items-start gap-2 text-[11px] leading-snug text-muted">
                <input
                  type="checkbox"
                  className="mt-0.5 size-3.5 accent-primary"
                  checked={deepAll}
                  onChange={(e) => setDeepAll(e.target.checked)}
                  disabled={busy}
                />
                Deep scrape all (comments + card length on each rival’s top 8 — slower)
              </label>
            </div>
          </div>
          {msg ? (
            <p className={`mt-3 text-xs ${ok ? "text-success" : "text-danger"}`}>{msg}</p>
          ) : (
            <p className="mt-3 text-[11px] text-muted">
              {manuals} pinned · {rivals.filter((r) => r.source === "neighbor").length} auto · max {12}{" "}
              pinned. Public lounges only. MRT is archived daily in the warehouse
              {file?.alumni?.length ? ` · ${file.alumni.length} dropped neighbours kept` : ""}
              {rivals.some((r) => r.mrtLog?.length)
                ? ` · ${rivals.reduce((s, r) => s + (r.mrtLog?.length || 0), 0)} MRT days`
                : ""}
              .
            </p>
          )}
        </section>

        <section className="mb-5 rounded-2xl border border-border bg-surface/90 p-4 sm:p-5">
          <div className="mb-3 flex items-center gap-2">
            <Users className="size-4 text-primary" />
            <h2 className="text-sm font-semibold">Radar</h2>
            <span className="text-xs text-muted">
              sorted by 30d rank · {compare?.timezone || "lounge zone"} · click sets right · right-click sets left
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-xs">
              <thead className="text-muted">
                <tr className="border-b border-border">
                  <th className="py-2 pr-2 font-medium">30d</th>
                  <th className="py-2 pr-2 font-medium">Creator</th>
                  <th className="py-2 pr-2 font-medium">Bots</th>
                  <th className="py-2 pr-2 font-medium">Chats</th>
                  <th className="py-2 pr-2 font-medium">Followers</th>
                  <th className="py-2 pr-2 font-medium">Δ day</th>
                  <th className="py-2 pr-2 font-medium">Δ 7d</th>
                  <th className="py-2 pr-2 font-medium">Launches 30d</th>
                  <th className="py-2 pr-2 font-medium">Overlap</th>
                  <th className="py-2 font-medium">Updated</th>
                </tr>
              </thead>
              <tbody>
                {(compare?.rows || []).map((r) => (
                  <tr
                    key={r.userId}
                    onClick={() => pickRight(r.userId)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      pickLeft(r.userId);
                    }}
                    className={`cursor-pointer border-b border-border/60 hover:bg-elevated/40 ${
                      r.isYou ? "bg-primary/10" : ""
                    } ${rightId === r.userId ? "bg-elevated/70" : leftId === r.userId ? "bg-primary/5" : ""}`}
                  >
                    <td className="py-2 pr-2 font-semibold text-muted">
                      {r.rank30d != null ? `#${r.rank30d}` : "—"}
                    </td>
                    <td className="py-2 pr-2 font-medium">
                      {r.isYou ? "You · " : ""}
                      {r.userName}
                      {!r.isYou ? (
                        <span
                          className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                            r.source === "neighbor"
                              ? "bg-accent/15 text-accent"
                              : "bg-primary/15 text-primary"
                          }`}
                        >
                          {r.source === "neighbor" ? "auto" : "pinned"}
                        </span>
                      ) : (
                        <span className="ml-1.5 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                          MRT
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-2">{formatNum(r.totals.bots)}</td>
                    <td className="py-2 pr-2 font-semibold">{formatNum(r.totals.chats)}</td>
                    <td className="py-2 pr-2">{formatNum(r.totals.followers)}</td>
                    <td
                      className={`py-2 pr-2 ${
                        (r.dayOverDay?.chats ?? 0) > 0
                          ? "text-success"
                          : (r.dayOverDay?.chats ?? 0) < 0
                            ? "text-danger"
                            : "text-muted"
                      }`}
                    >
                      {formatDelta(r.dayOverDay?.chats)}
                    </td>
                    <td className="py-2 pr-2">{formatDelta(r.last7Days?.chats)}</td>
                    <td className="py-2 pr-2">
                      {r.launches30 != null ? r.launches30 : "—"}
                      {r.cadence && r.cadence !== "unknown" ? (
                        <span className="ml-1 text-[10px] text-faint">{cadenceLabel(r.cadence)}</span>
                      ) : null}
                    </td>
                    <td className="py-2 pr-2">
                      {r.overlapTags?.length
                        ? r.overlapTags.slice(0, 2).join(" · ")
                        : r.overlapN != null
                          ? r.overlapN
                          : "—"}
                    </td>
                    <td className="py-2 text-[10px] text-muted">
                      {r.lastScrapedAt ? formatWhen(r.lastScrapedAt) : "board only"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!compare?.rows?.length ? (
              <p className="py-6 text-center text-sm text-muted">
                No comparison yet — refresh your lounge so the 30d window can fill.
              </p>
            ) : null}
          </div>
        </section>

        {leftId && rightId && leftId !== rightId && pair?.leftMrt && pair?.rightMrt ? (
          <section className="mb-5 rounded-2xl border border-primary/30 bg-surface/90 p-4 sm:p-5">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <DuelHeader
                youName={pair.leftName}
                themName={pair.rightName}
                youRank={pair.leftMrt.rank30d}
                themRank={pair.rightMrt.rank30d}
                youCadence={pair.leftMrt.launch.cadence}
                themCadence={pair.rightMrt.launch.cadence}
              />
              <div className="flex flex-wrap gap-2">
                {rightEntry ? (
                  <>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void onRefreshOne(rightEntry.userId)}
                      className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-fg"
                    >
                      {busy ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
                      Deep scrape right
                    </button>
                    {rightEntry.source === "neighbor" ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void onPin(rightEntry.userId)}
                        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium"
                      >
                        <Pin className="size-3.5" /> Pin
                      </button>
                    ) : null}
                  </>
                ) : null}
              </div>
            </div>
            {pairBusy ? (
              <p className="text-sm text-muted">Recomputing overlap vs @{pair.leftName}…</p>
            ) : (
              <MrtDuel
                you={pair.leftMrt}
                them={pair.rightMrt}
                youName={pair.leftName}
                themName={pair.rightName}
              />
            )}
          </section>
        ) : pair?.same && pair.leftMrt ? (
          pair.leftIsYou ? (
            <YouMrtCard mrt={pair.leftMrt} userName={pair.leftName} />
          ) : (
            <section className="mb-5 rounded-2xl border border-primary/30 bg-surface/90 p-4 sm:p-5">
              <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-faint">Complete MRT</div>
                  <h2 className="font-display text-2xl font-bold">@{pair.leftName}</h2>
                  <p className="mt-1 max-w-xl text-sm text-muted">
                    Solo dossier. Pick a different creator on the right for 1v1.
                  </p>
                </div>
              </div>
              <MrtPanels mrt={pair.leftMrt} />
            </section>
          )
        ) : rightEntry ? (
          <RivalDossier
            entry={rightEntry}
            versusMrt={pair?.leftMrt ?? null}
            versusName={pair?.leftName}
            pairRight={pair?.rightMrt ?? null}
            busy={busy || pairBusy}
            onRefresh={() => void onRefreshOne(rightEntry.userId)}
            onPin={() => void onPin(rightEntry.userId)}
            onRemove={() => void onRemove(rightEntry.userId)}
          />
        ) : leftId && !rightId ? (
          <section className="mb-5 rounded-2xl border border-dashed border-border bg-surface/90 p-4 sm:p-5">
            <p className="text-sm text-muted">Pick a second tracked creator to compare.</p>
          </section>
        ) : null}

        <section className="mb-8 rounded-2xl border border-border bg-surface/90 p-4 sm:p-5">
          <h2 className="mb-3 text-sm font-semibold">Tracked list</h2>
          <div className="space-y-2">
            {rivals.map((r: RivalEntry) => (
              <div
                key={r.userId}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-bg/50 px-3 py-2.5"
              >
                <button
                  type="button"
                  className="min-w-0 text-left"
                  onClick={() => pickRight(r.userId)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    pickLeft(r.userId);
                  }}
                >
                  <div className="truncate text-sm font-semibold">
                    @{r.userName || r.userId}
                    {r.label ? (
                      <span className="ml-1 text-xs font-normal text-muted">({r.label})</span>
                    ) : null}
                    <span
                      className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                        r.source === "neighbor" ? "bg-accent/15 text-accent" : "bg-primary/15 text-primary"
                      }`}
                    >
                      {r.source === "neighbor" ? "auto" : "pinned"}
                    </span>
                  </div>
                  <div className="text-[11px] text-muted">
                    {r.neighborRank != null ? `#${r.neighborRank} · ` : ""}
                    id {r.userId}
                    {r.history?.length ? ` · ${r.history.length}d` : ""}
                    {r.mrtLog?.length ? ` · ${r.mrtLog.length} MRT` : ""}
                    {r.mrt?.launch.cadence ? ` · ${cadenceLabel(r.mrt.launch.cadence)}` : ""}
                    {r.warnings?.[0] ? ` · ${r.warnings[0]}` : ""}
                  </div>
                </button>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void onRefreshOne(r.userId)}
                    className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium"
                  >
                    <RefreshCw className="size-3.5" /> MRT
                  </button>
                  {r.source === "neighbor" ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void onPin(r.userId)}
                      className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium"
                    >
                      <Pin className="size-3.5" /> Pin
                    </button>
                  ) : null}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void onRemove(r.userId)}
                    className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-danger/30 px-3 text-xs font-medium text-danger"
                  >
                    <Trash2 className="size-3.5" /> Drop
                  </button>
                </div>
              </div>
            ))}
            {!rivals.length ? (
              <p className="text-sm text-muted">No rivals yet. Neighbours appear after a 30d ranklist exists.</p>
            ) : null}
          </div>
        </section>
      </div>
      <MobileNav />
    </div>
  );
}

function RivalDossier({
  entry,
  versusMrt,
  versusName,
  pairRight,
  busy,
  onRefresh,
  onPin,
  onRemove,
}: {
  entry: RivalEntry;
  versusMrt: RivalMrt | null;
  versusName?: string | null;
  pairRight: RivalMrt | null;
  busy: boolean;
  onRefresh: () => void;
  onPin: () => void;
  onRemove: () => void;
}) {
  const m = pairRight ?? entry.mrt ?? null;
  const actions = (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={onRefresh}
        className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-fg"
      >
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
        Deep scrape
      </button>
      {entry.source === "neighbor" ? (
        <button
          type="button"
          disabled={busy}
          onClick={onPin}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium"
        >
          <Pin className="size-3.5" /> Pin
        </button>
      ) : null}
      <button
        type="button"
        disabled={busy}
        onClick={onRemove}
        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-danger/30 px-3 text-xs font-medium text-danger"
      >
        <Trash2 className="size-3.5" /> Drop
      </button>
    </div>
  );

  if (versusMrt && m) {
    return (
      <section className="mb-5 rounded-2xl border border-primary/30 bg-surface/90 p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <DuelHeader
            youName={versusName || versusMrt.userName}
            themName={entry.label || entry.userName}
            youRank={versusMrt.rank30d}
            themRank={m.rank30d}
            youCadence={versusMrt.launch.cadence}
            themCadence={m.launch.cadence}
          />
          {actions}
        </div>
        <MrtDuel
          you={versusMrt}
          them={m}
          youName={versusName || versusMrt.userName}
          themName={entry.label || entry.userName}
        />
      </section>
    );
  }

  return (
    <section className="mb-5 rounded-2xl border border-primary/30 bg-surface/90 p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-faint">Complete MRT</div>
          <h2 className="font-display text-2xl font-bold">
            @{entry.userName || entry.userId}
            {m?.rank30d != null ? (
              <span className="ml-2 text-base font-semibold text-muted">#{m.rank30d} · 30d ALL</span>
            ) : null}
          </h2>
          <p className="mt-1 max-w-xl text-sm text-muted">
            {m?.profile.bio || "Public lounge dossier — profile, traffic, launches, overlapping topics."}
            {entry.mrtLog?.length ? ` · ${entry.mrtLog.length} MRT days archived.` : ""}
            {!versusMrt ? " Pick a left-side creator to unlock 1v1." : ""}
          </p>
        </div>
        {actions}
      </div>
      {m ? (
        <MrtPanels mrt={m} />
      ) : (
        <p className="text-sm text-muted">No dossier yet — Deep scrape pulls their public space and builds the MRT.</p>
      )}
    </section>
  );
}
