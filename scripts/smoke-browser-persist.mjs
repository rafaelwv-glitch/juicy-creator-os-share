#!/usr/bin/env node
/**
 * Persistence + integrity for JuicyChat session and warehouse in browser cache.
 * 1) Merge / live-bundle unit tests (sample snapshot must not drop pins or login)
 * 2) Server collectBrowserWarehouse includes every lounge KV key
 * 3) Playwright: IDB + localStorage survive reload and a new page in the same profile
 */
import { createServer } from "vite";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { chromium } from "playwright";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const SESSION = {
  cookie: "voucher=persist-test-cookie-value; other=1",
  secretKey: "sk-test",
  distinctId: "did-test",
  userId: "user-persist-1",
  userName: "PersistUser",
  userNo: "4242",
  email: "persist@example.com",
  source: "manual-cookie",
  loggedInAt: "2026-09-18T12:00:00.000Z",
};

const RIVALS = {
  version: 2,
  timezone: "Europe/Madrid",
  rivals: [
    {
      userId: "rival-alice",
      userName: "Alice",
      addedAt: "2026-09-01T00:00:00.000Z",
      lastScrapedAt: null,
      lastSnapshot: null,
      history: [],
      warnings: [],
      source: "manual",
    },
    {
      userId: "rival-bob",
      userName: "Bob",
      addedAt: "2026-09-01T00:00:00.000Z",
      lastScrapedAt: null,
      lastSnapshot: null,
      history: [],
      warnings: [],
      source: "manual",
    },
  ],
  alumni: [],
};

const SAMPLE_SNAP = {
  scrapedAt: "2026-09-01T11:00:00.000Z",
  userId: "sample-juicy-user",
  profile: { userId: "sample-juicy-user", userName: "SampleCreator" },
  bots: [{ characterId: "1", characterName: "Sample Bot One" }],
};

function sampleWarehouse(extraFiles = {}) {
  return {
    format: "juicy-lounge-warehouse",
    version: "1.6.0",
    account: { userId: "sample-juicy-user", userName: "SampleCreator" },
    files: {
      "last-snapshot.json": SAMPLE_SNAP,
      ...extraFiles,
    },
    manifest: { bots: 1, keys: ["last-snapshot.json"] },
  };
}

async function unitMerge(store) {
  const {
    isLiveBrowserBundle,
    mergeBrowserBundles,
    sampleishWarehouse,
    warehouseHasLiveRivals,
    browserBundleIntegrity,
    BROWSER_CACHE_FORMAT,
    BROWSER_CACHE_VERSION,
  } = store;

  const liveWithPins = {
    format: BROWSER_CACHE_FORMAT,
    version: BROWSER_CACHE_VERSION,
    savedAt: "2026-09-18T10:00:00.000Z",
    session: SESSION,
    warehouse: {
      files: {
        "last-snapshot.json": {
          userId: "user-persist-1",
          profile: { userId: "user-persist-1", userName: "PersistUser" },
          bots: [{ characterId: "9" }],
        },
        "rivals-track.json": RIVALS,
        "juicy-session.json": SESSION,
        "growth-history.json": { days: [{ date: "2026-09-17" }] },
      },
    },
  };

  assert(isLiveBrowserBundle(liveWithPins), "login+pins must count as live");
  assert(warehouseHasLiveRivals(liveWithPins.warehouse), "pins must count as live rivals");

  const sampleOnly = {
    format: BROWSER_CACHE_FORMAT,
    version: BROWSER_CACHE_VERSION,
    savedAt: "2026-09-18T11:00:00.000Z",
    session: null,
    warehouse: sampleWarehouse(),
  };
  assert(sampleishWarehouse(sampleOnly.warehouse), "sample warehouse detected");
  assert(!isLiveBrowserBundle(sampleOnly), "sample-only bundle is not live");

  const samplePlusPins = {
    format: BROWSER_CACHE_FORMAT,
    version: BROWSER_CACHE_VERSION,
    savedAt: "2026-09-18T11:00:00.000Z",
    session: null,
    warehouse: sampleWarehouse({ "rivals-track.json": RIVALS }),
  };
  assert(
    isLiveBrowserBundle(samplePlusPins),
    "pins on a sample snapshot MUST still persist (was the close-tab pin loss)",
  );

  const samplePlusLogin = {
    format: BROWSER_CACHE_FORMAT,
    version: BROWSER_CACHE_VERSION,
    savedAt: "2026-09-18T11:00:00.000Z",
    session: SESSION,
    warehouse: sampleWarehouse(),
  };
  assert(isLiveBrowserBundle(samplePlusLogin), "login on sample snapshot is live");

  const stripped = {
    format: BROWSER_CACHE_FORMAT,
    version: BROWSER_CACHE_VERSION,
    savedAt: "2026-09-18T12:00:00.000Z",
    session: SESSION,
    warehouse: { ...sampleWarehouse(), files: {} },
  };
  const merged = mergeBrowserBundles(liveWithPins, stripped);
  assert(merged.session?.cookie === SESSION.cookie, "merge keeps session when incoming warehouse is empty");
  assert(
    merged.warehouse?.files?.["rivals-track.json"]?.rivals?.length === 2,
    "merge must not drop pinned creators when export strips sample files",
  );
  assert(
    merged.warehouse?.files?.["growth-history.json"]?.days?.length === 1,
    "merge keeps existing warehouse keys omitted by a sample export",
  );

  const unpin = mergeBrowserBundles(liveWithPins, {
    format: BROWSER_CACHE_FORMAT,
    version: BROWSER_CACHE_VERSION,
    savedAt: "2026-09-18T13:00:00.000Z",
    session: SESSION,
    warehouse: {
      files: {
        "rivals-track.json": { version: 2, timezone: "Europe/Madrid", rivals: [], alumni: [] },
      },
    },
  });
  assert(unpin.warehouse?.files?.["rivals-track.json"]?.rivals?.length === 0, "explicit empty rivals is a real unpin");

  const integrity = browserBundleIntegrity(liveWithPins);
  assert(integrity.hasSession, "integrity has session");
  assert(integrity.rivalCount === 2, "integrity rival count");
  assert(integrity.rivalIds.includes("rival-alice") && integrity.rivalIds.includes("rival-bob"), "integrity rival ids");
  assert(integrity.keys.includes("rivals-track.json"), "integrity lists rivals key");
  assert(integrity.keys.includes("juicy-session.json"), "integrity lists session key");
}

async function unitFiles(backup) {
  const { BROWSER_FILES, WAREHOUSE_FILES, SAMPLE_ANALYTICS_FILES, filesForBrowserCache } = backup;
  const expectedKv = [
    "juicy-session.json",
    "last-snapshot.json",
    "growth-history.json",
    "notification-events.json",
    "creator-insights.json",
    "followers-history.json",
    "creator-dashboard.json",
    "creator-ranklist.json",
    "bot-forensics.json",
    "creator-economy.json",
    "rivals-track.json",
    "publish-jobs.json",
    "grok-hook.json",
    "exposure-performance.json",
    "audit15-queue.json",
    "tag-competition.json",
    "pull-schedule.json",
    "new-feed.json",
  ];

  const browserSet = new Set(BROWSER_FILES);
  for (const k of expectedKv) {
    assert(browserSet.has(k), `BROWSER_FILES missing lounge kv key ${k}`);
  }
  for (const k of browserSet) {
    assert(expectedKv.includes(k), `BROWSER_FILES extra key not in lounge kv ${k}`);
  }
  assert(WAREHOUSE_FILES.includes("rivals-track.json"), "rivals-track in warehouse");
  assert(BROWSER_FILES.includes("juicy-session.json"), "session in browser files");
  assert(BROWSER_FILES.includes("grok-hook.json"), "grok-hook in browser files");

  const mixed = {
    "last-snapshot.json": SAMPLE_SNAP,
    "rivals-track.json": RIVALS,
    "juicy-session.json": SESSION,
    "publish-jobs.json": [],
    "pull-schedule.json": { jobs: [] },
    "grok-hook.json": { url: "https://example.com", enabled: true },
    "growth-history.json": { days: [] },
  };
  const kept = filesForBrowserCache(mixed, true);
  assert(!("last-snapshot.json" in kept), "sample snapshot omitted from IDB");
  assert(!("growth-history.json" in kept), "sample analytics omitted from IDB");
  assert(kept["rivals-track.json"]?.rivals?.length === 2, "pins kept when snapshot is sample");
  assert(kept["juicy-session.json"]?.cookie === SESSION.cookie, "session kept when snapshot is sample");
  assert("publish-jobs.json" in kept, "jobs kept");
  assert("pull-schedule.json" in kept, "schedule kept");
  assert("grok-hook.json" in kept, "hook kept");
  for (const name of SAMPLE_ANALYTICS_FILES) {
    assert(!(name in kept) || name === "rivals-track.json", `sample analytics ${name} should drop`);
  }

  const live = filesForBrowserCache(mixed, false);
  assert(live["last-snapshot.json"], "live snapshot kept when not sample");
}

async function unitCollect(vite) {
  const dir = mkdtempSync(join(tmpdir(), "jl-persist-"));
  process.env.JUICY_DATA_DIR = dir;
  const backup = await vite.ssrLoadModule("/src/lib/juicychat/backup.ts");
  const { loungeUserAls } = await vite.ssrLoadModule("/src/lib/juicychat/paths.ts");
  const { BROWSER_FILES, collectBrowserWarehouse } = backup;

  await loungeUserAls.run("smoke-persist", async () => {
    const { dataPath, ensureDataDir } = await vite.ssrLoadModule("/src/lib/juicychat/paths.ts");
    ensureDataDir();
    const sentinels = {};
    for (const name of BROWSER_FILES) {
      if (name === "juicy-session.json") {
        sentinels[name] = SESSION;
      } else if (name === "rivals-track.json") {
        sentinels[name] = RIVALS;
      } else if (name === "grok-hook.json") {
        sentinels[name] = { url: "https://hooks.example/x", secret: "s", pullToken: "p", enabled: true };
      } else if (name === "last-snapshot.json") {
        sentinels[name] = {
          scrapedAt: "2026-09-18T12:00:00.000Z",
          userId: "user-persist-1",
          profile: { userId: "user-persist-1", userName: "PersistUser" },
          bots: [{ characterId: "9", characterName: "Bot Nine" }],
        };
      } else {
        sentinels[name] = { sentinel: name, timezone: "Europe/Madrid" };
      }
      mkdirSync(dirname(dataPath(name)), { recursive: true });
      writeFileSync(dataPath(name), JSON.stringify(sentinels[name]));
    }

    const collected = collectBrowserWarehouse();
    const missing = [];
    for (const name of BROWSER_FILES) {
      if (!(name in (collected.files || {}))) missing.push(name);
    }
    assert(missing.length === 0, `collectBrowserWarehouse missing ${missing.join(", ")}`);
    assert(collected.files["rivals-track.json"].rivals.length === 2, "collect rivals");
    assert(collected.files["juicy-session.json"].cookie === SESSION.cookie, "collect session cookie intact");
    assert(collected.files["grok-hook.json"].url.includes("hooks.example"), "collect hook");
    assert(collected.account?.userName === "PersistUser", "collect account from live snapshot");
  });

  rmSync(dir, { recursive: true, force: true });
}

async function playwrightPersist() {
  const url = process.env.SMOKE_URL || "http://127.0.0.1:8080/";
  let executablePath;
  for (const candidate of [
    process.env.PLAYWRIGHT_CHROMIUM,
    "/root/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell",
    "/root/.cache/ms-playwright/chromium-1243/chrome-linux/chrome",
  ]) {
    if (candidate && existsSync(candidate)) {
      executablePath = candidate;
      break;
    }
  }

  const browser = await chromium.launch({
    headless: true,
    executablePath,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(1500);

    await page.evaluate(
      ({ session, rivals, format, version }) => {
        localStorage.setItem("jl_browser_store_id", "persisttestid000000000000000001");
        localStorage.setItem("jl_browser_session", JSON.stringify(session));
        localStorage.setItem("jl_browser_rivals", JSON.stringify(rivals));
        const bundle = {
          format,
          version,
          savedAt: new Date().toISOString(),
          session,
          warehouse: {
            files: {
              "juicy-session.json": session,
              "rivals-track.json": rivals,
            },
            manifest: { bots: 0, keys: ["juicy-session.json", "rivals-track.json"] },
            account: { userId: session.userId, userName: session.userName },
          },
        };
        return new Promise((resolve, reject) => {
          const req = indexedDB.open("juicy-lounge-browser", 1);
          req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
          };
          req.onerror = () => reject(req.error);
          req.onsuccess = () => {
            const db = req.result;
            const tx = db.transaction("kv", "readwrite");
            tx.objectStore("kv").put(bundle, "bundle");
            tx.oncomplete = () => {
              db.close();
              resolve(true);
            };
            tx.onerror = () => reject(tx.error);
          };
        });
      },
      {
        session: SESSION,
        rivals: RIVALS,
        format: "juicy-lounge-browser-cache",
        version: "1.0.0",
      },
    );

    await page.reload({ waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(2500);

    const afterReload = await page.evaluate(() => {
      const session = JSON.parse(localStorage.getItem("jl_browser_session") || "null");
      const rivals = JSON.parse(localStorage.getItem("jl_browser_rivals") || "null");
      const browserId = localStorage.getItem("jl_browser_store_id");
      return new Promise((resolve) => {
        const req = indexedDB.open("juicy-lounge-browser", 1);
        req.onerror = () => resolve({ session, rivals, browserId, idb: null });
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction("kv", "readonly");
          const get = tx.objectStore("kv").get("bundle");
          get.onsuccess = () => {
            const idb = get.result || null;
            db.close();
            resolve({ session, rivals, browserId, idb });
          };
          get.onerror = () => {
            db.close();
            resolve({ session, rivals, browserId, idb: null });
          };
        };
      });
    });

    assert(afterReload.browserId === "persisttestid000000000000000001", "browser store id stays in localStorage");
    assert(afterReload.session?.cookie === SESSION.cookie, "session stays in localStorage after reload");
    assert(afterReload.rivals?.rivals?.length === 2, "pins stay in localStorage after reload");
    assert(afterReload.idb?.session?.cookie === SESSION.cookie, "session stays in IndexedDB after reload");
    assert(
      afterReload.idb?.warehouse?.files?.["rivals-track.json"]?.rivals?.length === 2,
      "pins stay in IndexedDB after reload",
    );

    const page2 = await context.newPage();
    await page2.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page2.waitForTimeout(2500);
    const afterNewPage = await page2.evaluate(() => {
      const session = JSON.parse(localStorage.getItem("jl_browser_session") || "null");
      const rivals = JSON.parse(localStorage.getItem("jl_browser_rivals") || "null");
      return { session, rivals, body: document.body?.innerText?.slice(0, 2000) || "" };
    });
    assert(afterNewPage.session?.userName === "PersistUser", "new page in same profile keeps login");
    assert(afterNewPage.rivals?.rivals?.some((r) => r.userId === "rival-alice"), "new page keeps pinned Alice");

    await page2.close();
    await page.close();
    return {
      localStorageSession: true,
      localStorageRivals: 2,
      idbSession: true,
      idbRivals: 2,
      newPageKept: true,
    };
  } finally {
    await browser.close();
  }
}

async function main() {
  const vite = await createServer({
    root,
    configFile: false,
    server: { middlewareMode: true },
    appType: "custom",
    logLevel: "error",
    resolve: { alias: { "@": join(root, "src") } },
  });
  const report = { unit: {}, playwright: null };
  try {
    const store = await vite.ssrLoadModule("/src/lib/juicychat/browser-store.ts");
    const backup = await vite.ssrLoadModule("/src/lib/juicychat/backup.ts");
    await unitMerge(store);
    report.unit.merge = "ok";
    await unitFiles(backup);
    report.unit.wiring = "ok";
    await unitCollect(vite);
    report.unit.collect = "ok";
  } finally {
    await vite.close();
  }

  if (process.env.SMOKE_SKIP_PLAYWRIGHT === "1") {
    console.log(JSON.stringify({ ok: true, ...report, playwright: "skipped" }, null, 2));
    process.exit(0);
  }

  try {
    report.playwright = await playwrightPersist();
  } catch (e) {
    const msg = String(e?.message || e);
    if (/ERR_CONNECTION|net::ERR|Timeout/i.test(msg) && process.env.SMOKE_ALLOW_OFFLINE === "1") {
      report.playwright = { skipped: msg };
    } else {
      console.error(JSON.stringify({ ok: false, ...report, error: msg }, null, 2));
      process.exit(1);
    }
  }

  console.log(JSON.stringify({ ok: true, ...report }, null, 2));
  process.exit(0);
}

main().catch((e) => {
  console.error(JSON.stringify({ ok: false, error: String(e?.message || e) }, null, 2));
  process.exit(1);
});
