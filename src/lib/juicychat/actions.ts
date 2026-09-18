import { createServerFn } from "@tanstack/react-start";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { JuicyClient } from "./client";
import { durableMiddleware } from "./durable";
import { analyzeGrowth, recordAndAnalyze, seedHistoryFromSnapshot } from "./history";
import { analyzeTiming, scrapeNotifications } from "./notifications";
import { scrapeLounge } from "./scrape";
import { clearSession, loadSession, saveSession } from "./session";
import type { GrowthAnalysis, LoungeSnapshot } from "./types";
import { dataPath, ensureDataDir } from "./paths";

function persistSnapshot(snapshot: LoungeSnapshot) {
  try {
    ensureDataDir();
    writeFileSync(dataPath("last-snapshot.json"), JSON.stringify(snapshot), "utf8");
  } catch {
    // non-fatal
  }
}

async function afterLoungeLogin() {
  const { discardSampleWarehouse } = await import("./dashboard");
  discardSampleWarehouse();
}

function loadSnapshotFile(): LoungeSnapshot | null {
  try {
    const path = dataPath("last-snapshot.json");
    if (!existsSync(path)) return null;
    const snap = JSON.parse(readFileSync(path, "utf8")) as LoungeSnapshot;
    return { ...snap, source: snap.source || ("cache" as const) };
  } catch {
    return null;
  }
}

export const getScrapeStatus = createServerFn({ method: "GET" })
  .middleware([durableMiddleware])
  .handler(async () => {
  const session = loadSession();
  let authenticated = Boolean(session?.cookie);
  let user: { userId?: string; userName?: string; userNo?: string } | null = session
    ? { userId: session.userId, userName: session.userName, userNo: session.userNo }
    : null;
  if (session?.cookie) {
    try {
      const client = JuicyClient.fromSession(session);
      const live = await Promise.race([
        client.get<Record<string, unknown> | null>("/yume/api/user/v1/getUserInfo"),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 2500)),
      ]);
      if (live?.data && (live.data as { userId?: string }).userId) {
        authenticated = true;
        user = live.data as { userId?: string; userName?: string; userNo?: string };
        if (client.cookie !== session.cookie && client.cookie.length > 8) {
          saveSession({
            ...session,
            cookie: client.cookie,
            userId: user.userId,
            userName: user.userName,
            userNo: user.userNo,
          });
        }
      }
      // Live ping failed / timed out: keep the stored voucher. Do not treat as logout.
    } catch {
      // ignore network blips — cached session still counts
    }
  }
  return {
    authenticated,
    user,
    email: session?.email ?? "",
    userNo: session?.userNo ?? "",
    loungeUserId: session?.userId ?? "",
    hasSessionFile: Boolean(session?.cookie),
    hasSession: Boolean(session?.cookie),
    loggedInAt: session?.loggedInAt ?? null,
    source: session?.source ?? null,
  };
});

export const refreshLounge = createServerFn({ method: "POST" })
  .validator((input: { userId?: string } | undefined) => input ?? {})
  .middleware([durableMiddleware])
  .handler(async ({ data }) => {
    const session = loadSession();
    const userId = data.userId || session?.userId || "";
    if (!userId) {
      throw new Error("No lounge user id — log in first or pass userId.");
    }
    const snapshot = await scrapeLounge({
      userId,
      forceAuth: true,
    });
    persistSnapshot(snapshot);
    const growth = recordAndAnalyze(snapshot);
    return { snapshot, growth };
  });

export const loadCachedSnapshot = createServerFn({ method: "GET" })
  .middleware([durableMiddleware])
  .handler(async () => {
  const snap = loadSnapshotFile();
  if (!snap) return { snapshot: null as LoungeSnapshot | null, growth: analyzeGrowth() };
  seedHistoryFromSnapshot(snap);
  return { snapshot: snap, growth: analyzeGrowth() };
});

export const getGrowthAnalysis = createServerFn({ method: "GET" })
  .middleware([durableMiddleware])
  .handler(async () => {
  return analyzeGrowth() as GrowthAnalysis;
});

export const getTimingAnalysis = createServerFn({ method: "GET" })
  .middleware([durableMiddleware])
  .handler(async () => {
  return analyzeTiming();
});

export const refreshNotifications = createServerFn({ method: "POST" })
  .validator(
    (input: { lookbackDays?: number; maxPages?: number } | undefined) => input ?? {},
  )
  .middleware([durableMiddleware])
  .handler(async ({ data }) => {
    const lookbackDays =
      typeof data.lookbackDays === "number" && data.lookbackDays > 0
        ? Math.min(Math.floor(data.lookbackDays), 365)
        : 30;
    const maxPages =
      typeof data.maxPages === "number" && data.maxPages > 0
        ? Math.min(Math.floor(data.maxPages), 500)
        : 150;
    const scrape = await scrapeNotifications({ lookbackDays, maxPages });
    const analysis = analyzeTiming(scrape.store);
    return {
      analysis,
      added: scrape.added,
      pages: scrape.pages,
      apiTotal: scrape.apiTotal,
      stoppedReason: scrape.stoppedReason,
      eventCount: scrape.store.events.length,
      lastScrapedAt: scrape.store.lastScrapedAt,
    };
  });

export const requestMagicLink = createServerFn({ method: "POST" })
  .validator((input: { email: string; cfToken?: string }) => input)
  .middleware([durableMiddleware])
  .handler(async ({ data }) => {
    const client = new JuicyClient();
    return client.requestMagicLinkEmail(data.email || "", data.cfToken);
  });

export const loginWithPassword = createServerFn({ method: "POST" })
  .validator((input: { userNo: string; password: string; email?: string }) => input)
  .middleware([durableMiddleware])
  .handler(async ({ data }) => {
    const client = new JuicyClient();
    const result = await client.passwordLogin(data.userNo || "", data.password);
    if (!result.ok) {
      return { ok: false as const, message: result.message };
    }
    const user = result.user as { userId?: string; userName?: string; userNo?: string } | null;
    saveSession({
      cookie: client.cookie,
      secretKey: client.secretKey,
      distinctId: client.distinctId,
      userId: user?.userId,
      userName: user?.userName,
      userNo: user?.userNo || data.userNo,
      email: data.email || "",
      source: "password",
      loggedInAt: new Date().toISOString(),
    });
    await afterLoungeLogin();
    return { ok: true as const, message: result.message, user };
  });

export const loginWithMagicLink = createServerFn({ method: "POST" })
  .validator((input: { link: string; email?: string }) => input)
  .middleware([durableMiddleware])
  .handler(async ({ data }) => {
    const client = new JuicyClient();
    const result = await client.redeemMagicLink(data.link);
    if (!result.ok) {
      return { ok: false as const, message: result.message };
    }
    let user: { userId?: string; userName?: string; userNo?: string } | null = result.user || null;
    if (!user?.userId) {
      try {
        const me = await client.get<Record<string, unknown> | null>("/yume/api/user/v1/getUserInfo");
        if (me.data && (me.data as { userId?: string }).userId) {
          user = me.data as { userId?: string; userName?: string; userNo?: string };
        }
      } catch {
        /* cookie may still be enough */
      }
    }
    saveSession({
      cookie: client.cookie,
      secretKey: client.secretKey,
      distinctId: client.distinctId,
      userId: user?.userId,
      userName: user?.userName,
      userNo: user?.userNo,
      email: data.email || "",
      source: "magic-link",
      loggedInAt: new Date().toISOString(),
    });
    await afterLoungeLogin();
    return { ok: true as const, message: result.message, user };
  });

export const loginWithCookie = createServerFn({ method: "POST" })
  .validator((input: { cookie: string; email?: string }) => input)
  .middleware([durableMiddleware])
  .handler(async ({ data }) => {
    const client = new JuicyClient({ cookie: data.cookie });
    let user: { userId?: string; userName?: string; userNo?: string } | null = null;
    try {
      const me = await client.get<Record<string, unknown> | null>("/yume/api/user/v1/getUserInfo");
      if (me.data && (me.data as { userId?: string }).userId) {
        user = me.data as { userId?: string; userName?: string; userNo?: string };
      }
    } catch {
      /* */
    }
    if (!user?.userId && !client.cookie) {
      return { ok: false as const, message: "Cookie did not yield a session." };
    }
    saveSession({
      cookie: client.cookie || data.cookie,
      secretKey: client.secretKey,
      distinctId: client.distinctId,
      userId: user?.userId,
      userName: user?.userName,
      userNo: user?.userNo,
      email: data.email || "",
      source: "manual-cookie",
      loggedInAt: new Date().toISOString(),
    });
    await afterLoungeLogin();
    return { ok: true as const, message: user ? `Logged in as @${user.userName || user.userId}` : "Cookie saved.", user };
  });

export const logoutJuicy = createServerFn({ method: "POST" })
  .middleware([durableMiddleware])
  .handler(async () => {
  const session = loadSession();
  if (session?.cookie) {
    try {
      const client = JuicyClient.fromSession(session);
      await client.get("/yume/api/login/v1/signOut");
    } catch {
      /* */
    }
  }
  const { currentLoungeUserId } = await import("./paths");
  const { deleteSessionKv } = await import("./user-kv");
  clearSession();
  const uid = currentLoungeUserId();
  if (uid) await deleteSessionKv(uid);
  return { ok: true as const };
});

export const loginWithGoogleIdToken = createServerFn({ method: "POST" })
  .validator((input: { idToken: string; email?: string }) => input)
  .middleware([durableMiddleware])
  .handler(async ({ data }) => {
    const client = new JuicyClient();
    const result = await client.googleSignUp(data.idToken);
    if (!result.ok) {
      return { ok: false as const, message: result.message };
    }
    const user = result.user as { userId?: string; userName?: string; userNo?: string } | null;
    saveSession({
      cookie: client.cookie,
      secretKey: client.secretKey,
      distinctId: client.distinctId,
      userId: user?.userId,
      userName: user?.userName,
      userNo: user?.userNo,
      email: data.email || "",
      source: "google",
      loggedInAt: new Date().toISOString(),
    });
    await afterLoungeLogin();
    return { ok: true as const, message: result.message, user };
  });

/** Import raw Cookie header captured from Android WebView after Google OAuth. */
export const loginWithGoogleCookie = createServerFn({ method: "POST" })
  .validator((input: { cookie: string }) => input)
  .middleware([durableMiddleware])
  .handler(async ({ data }) => {
    const client = new JuicyClient({ cookie: data.cookie });
    client.importCookie(data.cookie);
    let user: { userId?: string; userName?: string; userNo?: string } | null = null;
    try {
      const me = await client.get<Record<string, unknown> | null>("/yume/api/user/v1/getUserInfo");
      if (me.data && (me.data as { userId?: string }).userId) {
        user = me.data as { userId?: string; userName?: string; userNo?: string };
      }
    } catch {
      /* */
    }
    if (!client.cookie.includes("yume_voucher") && !user?.userId) {
      return { ok: false as const, message: "Google cookie missing session (yume_voucher)." };
    }
    saveSession({
      cookie: client.cookie,
      secretKey: client.secretKey,
      distinctId: client.distinctId,
      userId: user?.userId,
      userName: user?.userName,
      userNo: user?.userNo,
      source: "google",
      loggedInAt: new Date().toISOString(),
    });
    await afterLoungeLogin();
    return {
      ok: true as const,
      message: user ? `Logged in as @${user.userName || user.userId}` : "Google session saved.",
      user,
    };
  });

export const refreshCreatorInsights = createServerFn({ method: "POST" })
  .validator(
    (input: { followerPages?: number; walletPages?: number; discoveryPages?: number } | undefined) =>
      input ?? {},
  )
  .middleware([durableMiddleware])
  .handler(async ({ data }) => {
    const { scrapeCreatorInsights } = await import("./insights");
    return scrapeCreatorInsights({
      followerPages: data.followerPages,
      walletPages: data.walletPages,
      discoveryPages: data.discoveryPages,
    });
  });

export const loadCreatorInsightsCached = createServerFn({ method: "GET" })
  .middleware([durableMiddleware])
  .handler(async () => {
  const { loadCreatorInsights } = await import("./insights");
  return loadCreatorInsights();
});

export const loadPublishQueueCached = createServerFn({ method: "GET" })
  .middleware([durableMiddleware])
  .handler(async () => {
  const { loadPublishQueueCached } = await import("./publish-bots");
  try {
    const { fireDuePublishJobs } = await import("./cloud-publish");
    await fireDuePublishJobs();
  } catch {
    /* due jobs are best-effort when opening the queue */
  }
  return loadPublishQueueCached();
});

export const refreshPublishQueue = createServerFn({ method: "POST" })
  .middleware([durableMiddleware])
  .handler(async () => {
  const { refreshPublishQueue } = await import("./publish-bots");
  return refreshPublishQueue();
});

export const publishApprovedBots = createServerFn({ method: "POST" })
  .validator((input: { characterIds: string[] }) => input)
  .middleware([durableMiddleware])
  .handler(async ({ data }) => {
    const ids = (data.characterIds || []).map(String).filter(Boolean);
    if (!ids.length) throw new Error("No bots selected.");
    const { publishCharacters } = await import("./publish-bots");
    return publishCharacters(ids);
  });

export const loadFollowersCached = createServerFn({ method: "GET" })
  .middleware([durableMiddleware])
  .handler(async () => {
  const { loadFollowersCached } = await import("./followers");
  return loadFollowersCached();
});

export const refreshFollowers = createServerFn({ method: "POST" })
  .validator((input: { userId?: string } | undefined) => input ?? {})
  .middleware([durableMiddleware])
  .handler(async ({ data }) => {
    const { scrapeFollowers } = await import("./followers");
    return scrapeFollowers({ userId: data.userId });
  });

/** Homepage New feed — manual only, never on cron. */
export const loadNewFeedCached = createServerFn({ method: "GET" })
  .middleware([durableMiddleware])
  .handler(async () => {
    const { loadNewFeedView } = await import("./new-feed");
    return loadNewFeedView();
  });

export const refreshNewFeed = createServerFn({ method: "POST" })
  .validator((input: { maxPages?: number } | undefined) => input ?? {})
  .middleware([durableMiddleware])
  .handler(async ({ data }) => {
    const { scrapeNewFeed } = await import("./new-feed");
    return scrapeNewFeed({ maxPages: data.maxPages });
  });


/** Credentials-free data warehouse — every analytics signal, never the session. */
export const exportDataBackup = createServerFn({ method: "GET" })
  .middleware([durableMiddleware])
  .handler(async () => {
    const { collectWarehouse } = await import("./backup");
    return collectWarehouse();
  });

export const importDataBackup = createServerFn({ method: "POST" })
  .validator((input: { backup: unknown }) => input)
  .middleware([durableMiddleware])
  .handler(async ({ data }) => {
    const { applyBackup } = await import("./backup");
    const result = applyBackup(data.backup, { allowCredentials: false });
    const raw = data.backup as { publishJobs?: unknown; files?: Record<string, unknown> };
    const jobs = raw?.publishJobs ?? raw?.files?.["publish-jobs.json"];
    if (Array.isArray(jobs)) {
      const { replaceJobsFromBackup } = await import("./cloud-publish");
      await replaceJobsFromBackup(jobs);
    }
    return result;
  });

export const clearAnalyticsData = createServerFn({ method: "POST" })
  .validator((input: { keepSession?: boolean } | undefined) => input ?? {})
  .middleware([durableMiddleware])
  .handler(async ({ data }) => {
    const { clearAnalyticsFiles } = await import("./backup");
    clearAnalyticsFiles({ keepSession: data.keepSession !== false });
    return { ok: true as const };
  });

/** Everything the PDF report needs, from the warehouse (no credentials). */
export const loadReportBundle = createServerFn({ method: "GET" })
  .middleware([durableMiddleware])
  .handler(async () => {
    const { getCachedOrEmptyDashboard } = await import("./dashboard");
    const { ingestForensicsIfStale, buildForensicIndex } = await import("./forensics");
    const { loadFollowersCached } = await import("./followers");
    const { loadNewFeedView } = await import("./new-feed");
    const dash = getCachedOrEmptyDashboard();
    const timing = dash.timing || analyzeTiming();
    const followers = loadFollowersCached();
    let forensics = null;
    try {
      const file = ingestForensicsIfStale({
        snapshot: dash.snapshot,
        deep: dash.deep,
        insights: dash.insights,
        timing,
        publish: dash.publish,
      });
      forensics = buildForensicIndex(file);
    } catch {
      /* archive must not block the PDF */
    }
    return {
      snapshot: dash.snapshot,
      growth: dash.growth,
      timing,
      insights: dash.insights,
      deep: dash.deep,
      publish: dash.publish,
      rivals: dash.rivals?.compare ?? null,
      forensics,
      followers,
      economy: dash.economy ?? null,
      tagForensics: dash.tagForensics ?? null,
      newFeed: loadNewFeedView(),
      signals: dash.signals ?? null,
      accountLabel:
        dash.snapshot?.profile?.userName ||
        dash.snapshot?.profile?.userId ||
        dash.snapshot?.userId ||
        null,
      lookbackDays: timing?.lookbackDays ?? 30,
    };
  });

// ── Creator stalker / rivals ─────────────────────────────────
export const listRivals = createServerFn({ method: "GET" })
  .middleware([durableMiddleware])
  .handler(async () => {
  const { loadRivals, buildCompare, syncNeighborRoster } = await import("./rivals");
  const snap = loadSnapshotFile();
  const session = loadSession();
  const youId = session?.userId || snap?.userId || snap?.profile?.userId;
  try {
    syncNeighborRoster({ youUserId: youId || null });
  } catch {
    /* roster is best-effort */
  }
  return {
    file: loadRivals(),
    compare: buildCompare(snap, youId),
  };
});

export const addRivalCreator = createServerFn({ method: "POST" })
  .validator((input: { linkOrId: string; label?: string }) => input)
  .middleware([durableMiddleware])
  .handler(async ({ data }) => {
    const { addRival, buildCompare } = await import("./rivals");
    const { entry, file } = await addRival({
      linkOrId: data.linkOrId,
      label: data.label,
      scrapeNow: true,
    });
    const snap = loadSnapshotFile();
    const session = loadSession();
    return {
      entry,
      file,
      compare: buildCompare(snap, session?.userId || snap?.userId || snap?.profile?.userId),
    };
  });

export const removeRivalCreator = createServerFn({ method: "POST" })
  .validator((input: { userId: string }) => input)
  .middleware([durableMiddleware])
  .handler(async ({ data }) => {
    const { removeRival, buildCompare } = await import("./rivals");
    const file = removeRival(data.userId);
    const snap = loadSnapshotFile();
    const session = loadSession();
    return {
      file,
      compare: buildCompare(snap, session?.userId || snap?.userId || snap?.profile?.userId),
    };
  });

export const pinRivalCreator = createServerFn({ method: "POST" })
  .validator((input: { userId: string }) => input)
  .middleware([durableMiddleware])
  .handler(async ({ data }) => {
    const { pinRival, buildCompare } = await import("./rivals");
    const file = pinRival(data.userId);
    const snap = loadSnapshotFile();
    const session = loadSession();
    return {
      file,
      compare: buildCompare(snap, session?.userId || snap?.userId || snap?.profile?.userId),
    };
  });

export const refreshRivalCreator = createServerFn({ method: "POST" })
  .validator((input: { userId: string }) => input)
  .middleware([durableMiddleware])
  .handler(async ({ data }) => {
    const { refreshRival, buildCompare } = await import("./rivals");
    const { entry, file } = await refreshRival(data.userId);
    const snap = loadSnapshotFile();
    const session = loadSession();
    return {
      entry,
      file,
      compare: buildCompare(snap, session?.userId || snap?.userId || snap?.profile?.userId),
    };
  });

export const refreshAllRivals = createServerFn({ method: "POST" })
  .validator((input: { enrich?: boolean } | undefined) => input ?? {})
  .middleware([durableMiddleware])
  .handler(async ({ data }) => {
  const { refreshAllRivals: refreshAll, buildCompare, loadRivals, syncNeighborRoster } = await import("./rivals");
  const { scrapeLounge } = await import("./scrape");
  const { recordAndAnalyze } = await import("./history");
  const session = loadSession();
  let snap = loadSnapshotFile();
  const youId = session?.userId || snap?.userId || snap?.profile?.userId;
  if (youId) {
    try {
      snap = await scrapeLounge({ userId: youId, forceAuth: true });
      persistSnapshot(snap);
      recordAndAnalyze(snap);
    } catch {
      /* still refresh rivals */
    }
  }
  try {
    syncNeighborRoster({ youUserId: youId || null });
  } catch {
    /* */
  }
  await refreshAll({ enrich: data?.enrich === true });
  const file = loadRivals();
  return {
    file,
    compare: buildCompare(snap, session?.userId || snap?.userId || snap?.profile?.userId),
  };
});

// ── Full creator dashboard ───────────────────────────────────
export const loadCreatorDashboard = createServerFn({ method: "GET" })
  .middleware([durableMiddleware])
  .handler(async () => {
  const { getCachedOrEmptyDashboard, loadDashboardCache } = await import("./dashboard");
  return getCachedOrEmptyDashboard();
});

export const refreshCreatorDashboard = createServerFn({ method: "POST" })
  .validator(
    (input: {
      userId?: string;
      full?: boolean;
      refreshLounge?: boolean;
      refreshDeep?: boolean;
      refreshInsights?: boolean;
      refreshTiming?: boolean;
    } | undefined) => input ?? {},
  )
  .middleware([durableMiddleware])
  .handler(async ({ data }) => {
    const { buildCreatorDashboard } = await import("./dashboard");
    return buildCreatorDashboard({
      userId: data.userId,
      full: data.full !== false,
      refreshLounge: data.refreshLounge !== false,
      refreshDeep: data.refreshDeep !== false,
      refreshInsights: data.refreshInsights !== false,
      refreshTiming: data.refreshTiming !== false,
    });
  });

export const refreshRanklistBoards = createServerFn({ method: "POST" })
  .middleware([durableMiddleware])
  .handler(async () => {
    const session = loadSession();
    const { JuicyClient } = await import("./client");
    const { scrapeDeepSignals } = await import("./deep-signals");
    const { buildCreatorDashboard, saveRanklistCache } = await import("./dashboard");
    const snap = loadSnapshotFile();
    const youUserId = snap?.profile?.userId || snap?.userId || session?.userId || null;
    if (!youUserId && !session?.cookie) {
      throw new Error("Connect JuicyChat first — ranklist needs a live session.");
    }
    const client = JuicyClient.fromSession(session);
    const deep = await scrapeDeepSignals(client, {
      bots: snap?.bots || [],
      youUserId,
      youName: snap?.profile?.userName || session?.userName || null,
      ranklistOnly: true,
    });
    if (deep.leaderboards?.length) saveRanklistCache(deep.leaderboards, deep.scrapedAt);
    return buildCreatorDashboard({
      userId: youUserId || undefined,
      full: false,
      refreshLounge: false,
      refreshDeep: false,
      refreshInsights: false,
      refreshTiming: false,
      deepOverride: deep,
    });
  });

export const loadForensicsIndex = createServerFn({ method: "GET" })
  .middleware([durableMiddleware])
  .handler(async () => {
    const { ingestForensicsIfStale, buildForensicIndex } = await import("./forensics");
    const { buildTagForensics } = await import("./tag-forensics");
    const file = ingestForensicsIfStale();
    return { ...buildForensicIndex(file), warehouse: buildTagForensics() };
  });

export const loadForensicReport = createServerFn({ method: "POST" })
  .validator((input: { characterId?: string } | undefined) => input ?? {})
  .middleware([durableMiddleware])
  .handler(async ({ data }) => {
    const id = String(data.characterId || "").trim();
    if (!id) return null;
    const { ingestForensicsIfStale, buildForensicReport } = await import("./forensics");
    ingestForensicsIfStale();
    return buildForensicReport(id);
  });

export const ingestForensicsNow = createServerFn({ method: "POST" })
  .middleware([durableMiddleware])
  .handler(async () => {
    const { ingestForensics, buildForensicIndex } = await import("./forensics");
    const { buildTagForensics } = await import("./tag-forensics");
    const file = ingestForensics();
    return { ...buildForensicIndex(file), warehouse: buildTagForensics() };
  });

export const getCloudLoungeStatus = createServerFn({ method: "GET" })
  .middleware([durableMiddleware])
  .handler(async () => {
    const { getCloudStatus } = await import("./daily-pull");
    const { fireDuePublishJobs, listCloudJobs } = await import("./cloud-publish");
    const { persistHealth } = await import("./user-kv");
    const { currentLoungeUserId } = await import("./paths");
    let publishFired = 0;
    try {
      const due = await fireDuePublishJobs();
      publishFired = due.fired;
    } catch {
      /* due publishes must not break status */
    }
    const status = await getCloudStatus();
    const jobs = await listCloudJobs();
    return {
      ...status,
      jobs,
      scheduled: jobs.filter((j) => j.status === "scheduled").length,
      persist: await persistHealth(currentLoungeUserId()),
      publishFired,
    };
  });

export const scheduleCloudPublish = createServerFn({ method: "POST" })
  .validator((input: { characterId: string; characterName?: string; fireAtMs: number }) => input)
  .middleware([durableMiddleware])
  .handler(async ({ data }) => {
    const { scheduleCloudJob } = await import("./cloud-publish");
    return scheduleCloudJob(data);
  });

export const cancelCloudPublish = createServerFn({ method: "POST" })
  .validator((input: { id: string }) => input)
  .middleware([durableMiddleware])
  .handler(async ({ data }) => {
    const { cancelCloudJob } = await import("./cloud-publish");
    return { ok: await cancelCloudJob(data.id) };
  });

export const runCloudPullNow = createServerFn({ method: "POST" })
  .middleware([durableMiddleware])
  .handler(async () => {
    const { runDailyPull } = await import("./daily-pull");
    const res = await runDailyPull("manual");
    return {
      ok: res.ok,
      message: res.message,
      bots: Number(res.details.bots ?? 0),
      publishFired: Number(res.details.publishFired ?? 0),
    };
  });

export const getPullSchedule = createServerFn({ method: "GET" })
  .middleware([durableMiddleware])
  .handler(async () => {
    const { loadPullSchedule, packScheduleView } = await import("./pull-schedule");
    return packScheduleView(loadPullSchedule());
  });

export const savePullSchedule = createServerFn({ method: "POST" })
  .validator((input: Record<string, unknown> | undefined) => input ?? {})
  .middleware([durableMiddleware])
  .handler(async ({ data }) => {
    const { savePullSchedule: write, packScheduleView } = await import("./pull-schedule");
    return packScheduleView(write(data));
  });
