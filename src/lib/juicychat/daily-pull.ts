import { getSql } from "@/lib/db";
import { buildCreatorDashboard } from "./dashboard";
import { scrapeFollowers } from "./followers";
import { loadSession, saveSession } from "./session";
import { fireDuePublishJobs } from "./cloud-publish";
import {
  DEFAULT_TIMES,
  dueJobs,
  formatPullTime,
  loadPullSchedule,
  markJobsFired,
  mergeJobPulls,
  nextScheduledPulls,
  scheduleSummary,
  type PullSources,
} from "./pull-schedule";
import { listLoungeUserIdsWithSession, pushUserKv, withUserStore } from "./user-kv";
import { currentLoungeUserId, dataPath, ensureDataDir } from "./paths";
import { JuicyClient } from "./client";
import { scrapeLounge } from "./scrape";
import { recordAndAnalyze } from "./history";
import { scrapeNotifications } from "./notifications";
import { repairLoungeFiles } from "./repair";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { LoungeSnapshot } from "./types";

export type CronKind = "pull" | "publish" | "manual";

/** Homepage New-feed analytics lives on /new-feed and is never a cron source. */

export type CronLogRow = {
  id: number;
  kind: string;
  startedAt: string;
  finishedAt: string | null;
  ok: boolean | null;
  message: string | null;
};

const TZ = "Europe/Madrid";
export const PULL_TIMES = DEFAULT_TIMES.map((t) => ({
  hour: t.hour,
  minute: t.minute,
  label: formatPullTime(t),
}));

export function nextMadridPulls(now = Date.now(), count = 2): string[] {
  return nextScheduledPulls(loadPullSchedule(), now, count);
}

export async function logCronStart(kind: CronKind): Promise<number> {
  try {
    const sql = await getSql();
    const rows = await sql.query<{ id: number }>(
      `insert into lounge_cron_log (kind) values ($1) returning id`,
      [kind],
    );
    return Number(rows[0]?.id || 0);
  } catch {
    return 0;
  }
}

export async function logCronEnd(
  id: number,
  ok: boolean,
  message: string,
  details?: unknown,
) {
  if (!id) return;
  try {
    const sql = await getSql();
    await sql.query(
      `update lounge_cron_log
       set finished_at = now(), ok = $2, message = $3, details = $4::jsonb
       where id = $1`,
      [id, ok, message.slice(0, 2000), JSON.stringify(details ?? null)],
    );
  } catch {
    /* */
  }
}

export async function latestCron(kind?: CronKind): Promise<CronLogRow | null> {
  try {
    const sql = await getSql();
    const rows = await sql.query<{
      id: number;
      kind: string;
      started_at: string | Date;
      finished_at: string | Date | null;
      ok: boolean | null;
      message: string | null;
    }>(
      kind
        ? `select id, kind, started_at, finished_at, ok, message
           from lounge_cron_log where kind = $1
           order by started_at desc limit 1`
        : `select id, kind, started_at, finished_at, ok, message
           from lounge_cron_log order by started_at desc limit 1`,
      kind ? [kind] : [],
    );
    const r = rows[0];
    if (!r) return null;
    return {
      id: Number(r.id),
      kind: r.kind,
      startedAt: new Date(r.started_at).toISOString(),
      finishedAt: r.finished_at ? new Date(r.finished_at).toISOString() : null,
      ok: r.ok,
      message: r.message,
    };
  } catch {
    return null;
  }
}

export async function getCloudStatus() {
  const [last, lastPull] = await Promise.all([latestCron(), latestCron("pull")]);
  const session = loadSession();
  const schedule = loadPullSchedule();
  const summary = scheduleSummary(schedule);
  return {
    timezone: TZ,
    pullTimes: summary.pullTimes,
    nextPulls: summary.nextPulls,
    schedule,
    depth: summary.depth,
    sourceKeys: summary.sourceKeys,
    last,
    lastPull,
    hasSession: Boolean(session?.cookie),
    userName: session?.userName || null,
    userId: session?.userId || null,
  };
}

function persistSnapshot(snapshot: LoungeSnapshot) {
  try {
    ensureDataDir();
    writeFileSync(dataPath("last-snapshot.json"), JSON.stringify(snapshot), "utf8");
  } catch {
    /* */
  }
}

async function checkpoint() {
  const uid = currentLoungeUserId();
  if (uid) {
    try {
      await pushUserKv(uid);
    } catch (e) {
      console.warn("[lounge] checkpoint failed", e);
    }
  }
}

async function resolveJuicyUserId(): Promise<string> {
  const session = loadSession();
  let userId = session?.userId || "";
  if (session?.cookie) {
    try {
      const client = JuicyClient.fromSession(session);
      const me = await client.get<Record<string, unknown> | null>("/yume/api/user/v1/getUserInfo");
      const liveId = (me.data as { userId?: string } | null)?.userId;
      if (liveId) {
        userId = String(liveId);
        saveSession({
          ...session,
          cookie: client.cookie.length > 8 ? client.cookie : session.cookie,
          userId,
          userName: String((me.data as { userName?: string } | null)?.userName || session.userName || ""),
          userNo: (me.data as { userNo?: string } | null)?.userNo || session.userNo,
        });
      }
    } catch {
      /* keep stored */
    }
  }
  if (!userId) {
    try {
      const p = dataPath("last-snapshot.json");
      if (existsSync(p)) {
        const snap = JSON.parse(readFileSync(p, "utf8")) as LoungeSnapshot;
        userId = snap.userId || snap.profile?.userId || "";
      }
    } catch {
      /* */
    }
  }
  return userId;
}

export type DailyPullOpts = {
  complete?: boolean;
  sources?: Partial<PullSources>;
};

export async function runDailyPull(
  kind: CronKind = "pull",
  opts?: DailyPullOpts,
): Promise<{
  ok: boolean;
  message: string;
  details: Record<string, unknown>;
}> {
  const logId = await logCronStart(kind);
  const session = loadSession();
  const started = Date.now();
  const complete = opts?.complete ?? kind === "manual";
  const budgetMs = process.env.VERCEL ? (complete ? 285_000 : 240_000) : 10 * 60_000;
  const timeLeft = () => budgetMs - (Date.now() - started);
  // Complete (Lounge Refresh all) only bails when almost out of time.
  const need = (ms: number) => (complete ? timeLeft() > 8_000 : timeLeft() > ms);
  const want = (key: keyof PullSources) => opts?.sources?.[key] !== false;
  const sources: Record<string, { ok: boolean; detail?: unknown; error?: string }> = {};
  const details: Record<string, unknown> = {
    hasSession: Boolean(session?.cookie),
    userId: session?.userId || null,
    mode: complete ? "complete" : "light",
    sources,
  };
  try {
    repairLoungeFiles();

    const due = await fireDuePublishJobs();
    details.publishFired = due.fired;
    details.publishResults = due.results;

    if (!session?.cookie && !session?.userId) {
      const message =
        "No JuicyChat session stored — pair the Android companion or connect JuicyChat on the dashboard.";
      await logCronEnd(logId, false, message, details);
      return { ok: false, message, details };
    }

    const userId = await resolveJuicyUserId();
    details.userId = userId || session?.userId || null;
    if (!userId) {
      const message = "JuicyChat is connected but has no user id — reconnect the source.";
      await logCronEnd(logId, false, message, details);
      return { ok: false, message, details };
    }

    // Core data sources — always hit JuicyChat live, persist immediately.
    if (!want("lounge")) {
      sources.lounge = { ok: false, error: "skipped — off" };
    } else {
      try {
        const snapshot = await scrapeLounge({ userId, forceAuth: true });
        persistSnapshot(snapshot);
        recordAndAnalyze(snapshot);
        sources.lounge = {
          ok: true,
          detail: { bots: snapshot.bots.length, followers: snapshot.totals.followers, scrapedAt: snapshot.scrapedAt },
        };
        details.bots = snapshot.bots.length;
        details.scrapedAt = snapshot.scrapedAt;
        await checkpoint();
      } catch (e) {
        sources.lounge = { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    }

    if (!want("followers")) {
      sources.followers = { ok: false, error: "skipped — off" };
    } else {
      try {
        const followers = await scrapeFollowers({ userId });
        sources.followers = {
          ok: true,
          detail: { count: followers.count, source: followers.source },
        };
        details.followers = followers.count;
        await checkpoint();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        sources.followers = { ok: false, error: msg };
        details.followersError = msg;
      }
    }

    if (!want("notifications")) {
      sources.notifications = { ok: false, error: "skipped — off" };
    } else if (need(20_000)) {
      try {
        const n = await scrapeNotifications({ lookbackDays: 30, maxPages: complete ? 40 : 15 });
        sources.notifications = {
          ok: true,
          detail: { events: n.store.events.length, added: n.added, pages: n.pages },
        };
        details.notifications = n.store.events.length;
        await checkpoint();
      } catch (e) {
        sources.notifications = { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    } else {
      sources.notifications = { ok: false, error: "skipped — time budget" };
    }

    if (!want("insights")) {
      sources.insights = { ok: false, error: "skipped — off" };
    } else if (need(25_000)) {
      try {
        const { scrapeCreatorInsights } = await import("./insights");
        const insights = await scrapeCreatorInsights(
          complete ? undefined : { followerPages: 3, walletPages: 2, discoveryPages: 8 },
        );
        sources.insights = {
          ok: true,
          detail: {
            followers: insights.followerCount,
            discoveryOwn: insights.discovery?.matrix?.length ?? 0,
            pagesByFeed: insights.discovery?.pagesByFeed ?? null,
          },
        };
        await checkpoint();
      } catch (e) {
        sources.insights = { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    } else {
      sources.insights = { ok: false, error: "skipped — time budget" };
    }

    // Deep boards are expensive; ranklist is 4 cheap calls and must always persist.
    // Light mode still requests pageSize 200/100 on page 1 (pageNo>1 is a no-op).
    // Complete mode also enriches bots, comments, monthly new, character ranks.
    let deepOverride: import("./deep-signals").DeepSignals | null = null;
    if (!want("deep")) {
      sources.deep = { ok: false, error: "skipped — off" };
    } else if (need(12_000)) {
      try {
        const { scrapeDeepSignals } = await import("./deep-signals");
        const { loadSession: ls } = await import("./session");
        const { saveRanklistCache, saveTagCache } = await import("./dashboard");
        const snap = (() => {
          try {
            return JSON.parse(readFileSync(dataPath("last-snapshot.json"), "utf8")) as LoungeSnapshot;
          } catch {
            return null;
          }
        })();
        if (snap?.bots?.length) {
          const client = JuicyClient.fromSession(ls());
          deepOverride = await scrapeDeepSignals(client, {
            bots: snap.bots,
            youUserId: userId,
            youName: snap.profile?.userName || session?.userName || null,
            light: !complete,
          });
          if (deepOverride.leaderboards?.length) {
            saveRanklistCache(deepOverride.leaderboards, deepOverride.scrapedAt);
          }
          if (deepOverride.tagCompetition?.length) {
            saveTagCache(deepOverride.tagCompetition);
          }
          sources.deep = {
            ok: true,
            detail: {
              warnings: deepOverride.warnings?.length || 0,
              boards: deepOverride.leaderboards.map((b) => ({
                id: b.id,
                rank: b.yourRank,
                score: b.yourScore,
                scanned: b.scanned,
              })),
              tags: deepOverride.tagCompetition?.length || 0,
              comments: deepOverride.commentPulse?.length || 0,
              enrichment: deepOverride.botEnrichment?.length || 0,
              characterRanks: deepOverride.characterRanks?.length || 0,
            },
          };
          await checkpoint();
        } else {
          sources.deep = { ok: false, error: "no bots yet" };
        }
      } catch (e) {
        sources.deep = { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    } else {
      sources.deep = { ok: false, error: "skipped — time budget" };
    }

    // Persist ranks/tags/comments before rival enrich so a timeout still keeps them.
    if (complete && deepOverride) {
      try {
        const dashEarly = await buildCreatorDashboard({
          userId,
          full: true,
          refreshLounge: false,
          refreshDeep: false,
          refreshInsights: false,
          refreshTiming: false,
          deepOverride,
        });
        details.warnings = dashEarly.warnings;
        await checkpoint();
      } catch {
        /* final assemble still runs */
      }
    }

    if (!want("rivals")) {
      sources.rivals = { ok: false, error: "skipped — off" };
    } else if (need(15_000)) {
      try {
        const { refreshAllRivals, syncNeighborRoster } = await import("./rivals");
        try {
          syncNeighborRoster({ youUserId: userId });
        } catch {
          /* */
        }
        const file = await refreshAllRivals({ enrich: complete });
        sources.rivals = { ok: true, detail: { n: file.rivals.length, enrich: complete } };
        details.rivals = file.rivals.length;
        await checkpoint();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        sources.rivals = { ok: false, error: msg };
        details.rivalsError = msg;
      }
    } else {
      sources.rivals = { ok: false, error: "skipped — time budget" };
    }

    const dash = await buildCreatorDashboard({
      userId,
      full: complete,
      refreshLounge: false,
      refreshDeep: false,
      refreshInsights: false,
      refreshTiming: false,
      deepOverride,
    });
    details.warnings = dash.warnings;
    details.scrapedAt = dash.scrapedAt;
    details.bots = dash.snapshot?.bots?.length ?? details.bots;
    details.followers = dash.snapshot?.totals?.followers ?? details.followers;
    details.mode = complete ? "complete" : "light";
    await checkpoint();

    const okSources = Object.entries(sources).filter(([, v]) => v.ok).map(([k]) => k);
    const failSources = Object.entries(sources).filter(([, v]) => !v.ok && !String(v.error || "").startsWith("skipped"));
    const ok = okSources.length > 0 || failSources.length === 0;
    const label = complete ? "Complete scrape" : "Light pull";
    const message = ok
      ? `${label} · ${okSources.join(", ")} · ${details.bots ?? 0} bots · ${Number(details.followers ?? 0).toLocaleString("en-US")} followers`
      : `Pull failed${failSources[0] ? ` (${failSources[0][0]}: ${failSources[0][1].error})` : ""}`;
    await logCronEnd(logId, ok, message, details);
    try {
      const { deliverGrokHook } = await import("./grok-hook");
      const hook = await deliverGrokHook();
      details.grokHook = {
        enabled: hook.enabled,
        lastOk: hook.lastOk ?? null,
        lastStatus: hook.lastStatus ?? null,
      };
    } catch (e) {
      details.grokHookError = e instanceof Error ? e.message : String(e);
    }
    return { ok, message, details };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await logCronEnd(logId, false, message, details);
    try {
      await checkpoint();
    } catch {
      /* */
    }
    return { ok: false, message, details };
  }
}

export async function runDailyPullAllAccounts(kind: CronKind = "pull"): Promise<{
  ok: boolean;
  message: string;
  details: Record<string, unknown>;
}> {
  const ids = await listLoungeUserIdsWithSession();
  if (!ids.length) {
    return {
      ok: false,
      message: "No lounge accounts with a JuicyChat session yet.",
      details: { accounts: 0 },
    };
  }
  const perUser: Array<{ userId: string; ok: boolean; message: string; skipped?: boolean }> = [];
  for (const userId of ids) {
    try {
      const res = await withUserStore(userId, async () => {
        if (kind !== "pull") return runDailyPull(kind);
        const sched = loadPullSchedule();
        if (!sched.enabled) {
          const pub = await fireDuePublishJobs();
          return {
            ok: true,
            message: "Scheduled scrapes paused · publishes checked",
            details: { skipped: true, reason: "disabled", publishFired: pub.fired },
          };
        }
        const due = dueJobs(sched);
        if (!due.length) {
          const pub = await fireDuePublishJobs();
          return {
            ok: true,
            message: "No scrape job due · publishes checked",
            details: {
              skipped: true,
              reason: "not-due",
              nextPulls: nextScheduledPulls(sched),
              publishFired: pub.fired,
            },
          };
        }
        markJobsFired(due.map((j) => j.id));
        const merged = mergeJobPulls(due);
        const res = await runDailyPull("pull", {
          complete: merged.complete,
          sources: merged.sources,
        });
        const names = due.map((j) => j.name).join(", ");
        return {
          ...res,
          message: `${res.message} · job${due.length > 1 ? "s" : ""} ${names}`,
          details: { ...res.details, jobs: due.map((j) => ({ id: j.id, name: j.name })) },
        };
      });
      perUser.push({
        userId,
        ok: res.ok,
        message: res.message,
        skipped: Boolean((res.details as { skipped?: boolean } | undefined)?.skipped),
      });
    } catch (e) {
      perUser.push({
        userId,
        ok: false,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }
  const pulled = perUser.filter((r) => r.ok && !r.skipped);
  const skipped = perUser.filter((r) => r.skipped);
  const failed = perUser.filter((r) => !r.ok);
  const ok = failed.length === 0;
  const message = pulled.length
    ? `Pulled ${pulled.length}/${perUser.length} accounts`
    : skipped.length === perUser.length
      ? `No pull due · ${skipped.length} account(s) · publishes checked`
      : `Pull failed ${failed.length}/${perUser.length} accounts`;
  return {
    ok,
    message,
    details: { accounts: perUser.length, perUser },
  };
}

export async function runDuePublishesOnly() {
  const logId = await logCronStart("publish");
  try {
    const ids = await listLoungeUserIdsWithSession();
    const allResults: unknown[] = [];
    let fired = 0;
    if (ids.length) {
      for (const userId of ids) {
        const due = await withUserStore(userId, () => fireDuePublishJobs());
        fired += due.fired;
        allResults.push({ userId, ...due });
      }
    }
    const message = fired ? `Published ${fired} scheduled bot(s)` : "No due publishes";
    await logCronEnd(logId, true, message, { results: allResults });
    return { ok: true, message, fired, results: allResults };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await logCronEnd(logId, false, message);
    return { ok: false, message, fired: 0, results: [] };
  }
}
