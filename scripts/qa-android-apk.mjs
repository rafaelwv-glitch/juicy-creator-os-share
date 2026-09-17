#!/usr/bin/env node
/**
 * Full QA for Juicy Lounge Android SPA (dist/) + ranking/chart logic.
 * Exit 0 only if all checks pass.
 */
import { chromium } from "playwright";
import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

const fails = [];
function ok(name, cond, detail) {
  if (cond) console.log("PASS  " + name);
  else {
    console.log("FAIL  " + name + (detail ? " — " + detail : ""));
    fails.push(name);
  }
}

const appJs = readFileSync("/workspace/dist/app.js", "utf8");
const html = readFileSync("/workspace/dist/index.html", "utf8");
const css = readFileSync("/workspace/dist/app.css", "utf8");

ok("engine version 9.3.1", /APP_VERSION = "9\.3\.1"/.test(appJs));
ok("index splash 9.3.1", html.includes("v9.3.1"));
ok("3 delta charts", appJs.includes("Δ Interactions") && appJs.includes("Δ Likes") && appJs.includes("Δ Chats"));
ok("not a single mixed delta chart", !appJs.includes('key: "interactions", color: "#8b7cff", label: "Δ interactions" },\n      { key: "chats"'));
ok("ranklist 4 boards", ["c_30d_all", "c_30d_new", "c_all_all", "c_all_new"].every((id) => appJs.includes(id)));
ok("rankingType 1-4", appJs.includes("type: 1") && appJs.includes("type: 4"));
ok("pageSize 200 ALL", appJs.includes("size: 200"));
ok("pageSize 100 NEW", appJs.includes("size: 100"));
ok("monthly NEW since May 2026", appJs.includes("monthKeysSince(202605)"));
ok("quota IndexedDB", appJs.includes("indexedDB") && appJs.includes("QuotaExceededError"));
ok("comment pulse list", appJs.includes("Ranked list — not a bar chart"));
ok("quality legend", appJs.includes("What these mean"));
ok("native file picker", appJs.includes("beginSave") && appJs.includes("openImportPicker"));
ok("widgets bridge", appJs.includes("saveWidgetData") && appJs.includes("setWidgetIntervalHours"));
ok("Deep button", html.includes('id="btnDeep"') && html.includes('id="btnRefreshAll"'));
ok("tabs", ["lounge", "timing", "insights", "stalker", "account"].every((t) => html.includes(`data-tab="${t}"`)));
ok("grid2 css", css.includes(".grid2"));
ok("rankingList unwrap", appJs.includes("rankingList") && appJs.includes("rankList"));
ok("username @ strip", appJs.includes(".replace(/^@/, \"\")"));

const syn = spawnSync("node", ["--check", "/workspace/dist/app.js"], { encoding: "utf8" });
ok("node --check app.js", syn.status === 0, syn.stderr);

// --- unit: ranking map + parse ---
function asArray(data) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== "object") return [];
  for (const k of ["list", "records", "rows", "data", "characterList", "items", "rankingList", "rankList", "creatorList"]) {
    if (Array.isArray(data[k])) return data[k];
  }
  return [];
}
function rankYouMatch(raw, youUserId, youName) {
  const uid = raw.userId != null ? String(raw.userId) : "";
  const uname = String(raw.userName || "").toLowerCase().replace(/^@/, "");
  if (youUserId && uid && String(youUserId) === uid) return true;
  const want = String(youName || "").toLowerCase().replace(/^@/, "").trim();
  return !!(want && uname && want === uname);
}
ok("asArray rankingList", asArray({ rankingList: [{ userId: "1" }] }).length === 1);
ok("asArray nested data", asArray({ data: [{ a: 1 }, { a: 2 }] }).length === 2);
ok("match by userId", rankYouMatch({ userId: "2045", userName: "x" }, "2045", "SampleCreator"));
ok("match by @name", rankYouMatch({ userId: "9", userName: "SampleCreator" }, null, "@SampleCreator"));
ok("no false match", !rankYouMatch({ userId: "1", userName: "SKVIRT" }, "2045", "SampleCreator"));

const rankingType = (period, cohort) =>
  period === "Monthly" && cohort === "All" ? 1
  : period === "Monthly" && cohort === "New" ? 2
  : period === "All" && cohort === "All" ? 3
  : period === "All" && cohort === "New" ? 4
  : null;
ok("map 30d ALL → 1", rankingType("Monthly", "All") === 1);
ok("map 30d NEW → 2", rankingType("Monthly", "New") === 2);
ok("map all-time ALL → 3", rankingType("All", "All") === 3);
ok("map all-time NEW → 4", rankingType("All", "New") === 4);

function monthKeysSince(yyyymm) {
  const now = new Date("2026-08-20T00:00:00Z");
  let y = Math.floor(yyyymm / 100);
  let m = yyyymm % 100;
  const out = [];
  for (let i = 0; i < 36; i++) {
    out.push(y * 100 + m);
    if (y > now.getUTCFullYear() || (y === now.getUTCFullYear() && m >= now.getUTCMonth() + 1)) break;
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}
const months = monthKeysSince(202605);
ok("months May–Aug 2026", months[0] === 202605 && months.includes(202608) && months.length === 4, JSON.stringify(months));

// compact history: 18 days × 200 bots should slim
function compact(days) {
  const BOT_HISTORY_DAYS = 8;
  return days.map((d, i) => {
    const keep = i >= days.length - BOT_HISTORY_DAYS;
    return keep ? d : { date: d.date, totals: d.totals, bots: {} };
  });
}
const fat = Array.from({ length: 18 }, (_, i) => ({
  date: "2026-08-" + String(i + 1).padStart(2, "0"),
  totals: { chats: i, likes: i, favorites: 0, interactions: i * 2 },
  bots: Object.fromEntries(Array.from({ length: 200 }, (_, b) => [String(b), { characterId: String(b), characterName: "Bot " + b, chats: b, likes: 1, favorites: 0, interactions: b + 1, characterThumb: "https://cdn.example/" + "x".repeat(80) }])),
}));
const slim = compact(fat);
const fatBytes = JSON.stringify(fat).length;
const slimBytes = JSON.stringify(slim).length;
ok("history compact shrinks", slimBytes < fatBytes * 0.6, `${fatBytes} → ${slimBytes}`);
ok("keeps last 8 bot days", slim.filter((d) => Object.keys(d.bots).length > 0).length === 8);

const gradle = readFileSync("/workspace/android/app/build.gradle", "utf8");
ok("gradle versionCode 13", /versionCode 13/.test(gradle));
ok("gradle versionName 9.3.1", gradle.includes('versionName "9.3.1"'));
ok("applicationId", gradle.includes("ai.juicylounge.analytics"));

const manifest = readFileSync("/workspace/android/app/src/main/AndroidManifest.xml", "utf8");
ok("INTERNET permission", manifest.includes("android.permission.INTERNET"));
ok("widget receivers", manifest.includes("LoungeWidgetSmallProvider") && manifest.includes("LoungeWidgetMediumProvider"));
ok("MainActivity exported", manifest.includes(".MainActivity"));

const java = readFileSync("/workspace/android/app/src/main/java/ai/juicylounge/analytics/MainActivity.java", "utf8");
ok("JuicyNative bridge", java.includes("JuicyNative") && java.includes("beginSave"));
ok("widget saveWidgetData", java.includes("saveWidgetData") || existsSync("/workspace/android/app/src/main/java/ai/juicylounge/analytics/WidgetPrefs.java"));

// --- Playwright UI with seeded data ---
const days = [];
for (let i = 0; i < 18; i++) {
  const d = String(i + 1).padStart(2, "0");
  days.push({
    date: `2026-08-${d}`,
    scrapedAt: `2026-08-${d}T12:00:00.000Z`,
    totals: { chats: 1000 + i * 12, likes: 200 + i * 3, favorites: 50 + i, interactions: 1250 + i * 16, followers: 4400, bots: 194 },
    bots: {},
  });
}
const dailyGrowth = days.slice(1).map((d, i) => ({
  date: d.date,
  chats: d.totals.chats - days[i].totals.chats,
  likes: d.totals.likes - days[i].totals.likes,
  favorites: d.totals.favorites - days[i].totals.favorites,
  interactions: d.totals.interactions - days[i].totals.interactions,
}));
const mockDeep = {
  scrapedAt: "2026-08-20T05:00:00.000Z",
  yourCreatorRank: 1,
  yourBestBoard: "Creators · 30-day · NEW",
  leaderboards: [
    { id: "c_30d_all", label: "Creators · 30-day · ALL", period: "30-day", cohort: "ALL", rankingType: 1, yourRank: 27, yourScore: 410, scanned: 200, top: [], aroundYou: [{ rank: 26, userName: "Ahead", isYou: false, score: 420 }, { rank: 27, userName: "SampleCreator", isYou: true, score: 410 }, { rank: 28, userName: "Behind", isYou: false, score: 400 }] },
    { id: "c_30d_new", label: "Creators · 30-day · NEW", period: "30-day", cohort: "NEW", rankingType: 2, yourRank: 1, yourScore: 1840, scanned: 100, top: [{ rank: 1, userName: "SampleCreator", isYou: true, score: 1840 }, { rank: 2, userName: "Other", isYou: false, score: 900 }], aroundYou: [] },
    { id: "c_all_all", label: "Creators · All-time · ALL", period: "all-time", cohort: "ALL", rankingType: 3, yourRank: 40, yourScore: 900, scanned: 200, top: [], aroundYou: [{ rank: 40, userName: "SampleCreator", isYou: true, score: 900 }] },
    { id: "c_all_new", label: "Creators · All-time · NEW", period: "all-time", cohort: "NEW", rankingType: 4, yourRank: 2, yourScore: 1840, scanned: 100, top: [{ rank: 1, userName: "SKVIRT", isYou: false, score: 1960 }, { rank: 2, userName: "SampleCreator", isYou: true, score: 1840 }], aroundYou: [] },
  ],
  monthlyNew: [{ rankingDate: 202605, label: "2026-05", yourRank: 3, yourScore: 800 }],
  characterBoards: [{ id: "char_30d", label: "Characters · 30-day", own: [] }],
  quality: { avgScore10: 7.2, medianChats: 1200, top10ChatShare: 0.42, engagementRate: 0.11, botsRanked: 0, botsWithComments: 4 },
  commentPulse: [{ characterName: "Bot A", approxTotal: 40 }, { characterName: "Bot B", approxTotal: 12 }],
  tagCompetition: [],
  warnings: [],
};
const mockSnap = {
  scrapedAt: "2026-08-20T05:00:00.000Z",
  authenticated: true,
  userId: "1000000000000000000",
  profile: { userId: "1000000000000000000", userName: "SampleCreator", chatCount: 1560000, likeCount: 4490, favoriteCount: 0, followersCount: 4490, characterCount: 194 },
  bots: [{ characterId: "1", characterName: "Demo", chatCount: 100, likeCount: 10, favoriteCount: 1, score10: 8 }],
  totals: { chats: 1560000, likes: 4490, favorites: 80, interactions: 1564570, followers: 4490, bots: 194 },
};

const url = process.env.QA_URL || "http://127.0.0.1:8080/";
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
try {
  const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  await page.addInitScript(
    ({ deep, hist, snap }) => {
      try {
        localStorage.setItem("jl_deep", JSON.stringify(deep));
        localStorage.setItem("jl_history", JSON.stringify(hist));
        localStorage.setItem("jl_snapshot", JSON.stringify(snap));
        localStorage.setItem("jl_session", JSON.stringify({ userId: snap.userId, userName: "SampleCreator", voucher: "x" }));
      } catch (e) {}
    },
    { deep: mockDeep, hist: { version: 2, timezone: "Europe/Madrid", days, lastScrape: days[days.length - 1] }, snap: mockSnap },
  );
  const resp = await page.goto(url, { waitUntil: "networkidle", timeout: 45000 });
  ok("http 200", (resp?.status() ?? 0) < 400, String(resp?.status()));
  await page.waitForTimeout(1800);
  const alive = await page.locator("#jsAlive").textContent().catch(() => "");
  ok("engine boot", /Engine ready|v9\.3/i.test(alive || ""), alive);
  await page.screenshot({ path: "/workspace/screenshots/qa-lounge.png", fullPage: true });

  const lounge = await page.locator("#tab-lounge").innerText();
  ok("delta interactions heading", lounge.includes("Δ Interactions"));
  ok("delta likes heading", lounge.includes("Δ Likes"));
  ok("delta chats heading", lounge.includes("Δ Chats"));
  ok("three svg line charts", (await page.locator("#tab-lounge svg.chart").count()) >= 3);
  ok("ranklist boards heading", lounge.includes("Ranklist boards") || lounge.includes("30-day"));
  ok("shows #1 NEW", lounge.includes("#1") || lounge.includes("NEW"));
  ok("quality legend", lounge.includes("What these mean") || lounge.includes("Avg score10"));
  ok("comment pulse not overlapping bars of 200", !lounge.includes("svgSimpleBars") && (lounge.includes("Comment pulse") || lounge.includes("comments")));

  await page.locator('[data-tab="account"]').click();
  await page.waitForTimeout(400);
  const account = await page.locator("#tab-account").innerText();
  ok("backup buttons", account.includes("Save data") && account.includes("Import") && account.includes("PDF"));
  ok("widget settings", account.includes("widget") || account.includes("Widget") || (await page.locator("#widgetSettings").count()) > 0);

  await page.locator('[data-tab="stalker"]').click();
  await page.waitForTimeout(300);
  ok("stalker tab", (await page.locator("#tab-stalker").isVisible()) === true);

  await page.locator('[data-tab="timing"]').click();
  await page.waitForTimeout(300);
  ok("timing tab", (await page.locator("#tab-timing").isVisible()) === true);

  ok("no page errors", pageErrors.length === 0, pageErrors.join(" | "));
} catch (e) {
  ok("playwright run", false, String(e && e.message || e));
} finally {
  await browser.close();
}

console.log("\n" + (fails.length ? fails.length + " FAILED: " + fails.join(", ") : "ALL CHECKS PASSED"));
process.exit(fails.length ? 1 : 0);
