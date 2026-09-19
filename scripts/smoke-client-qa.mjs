#!/usr/bin/env node
/**
 * Client QA against a running local server (default http://127.0.0.1:8080).
 * Does not boot Vite — use the live `npm run dev` so PGLite stays unique.
 *
 * - comboMatchesQuery ("yandere x romance")
 * - Playwright: lounge / forensics / timing / stalker / config
 * - no node:os.homedir, no error overlay, SampleCreator visible
 */
import { createServer } from "vite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const base = (process.env.SMOKE_URL || "http://127.0.0.1:8080").replace(/\/$/, "");
const shotDir = process.env.QA_SHOTS || "/workspace/screenshots";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function unitView() {
  const vite = await createServer({
    root,
    configFile: false,
    server: { middlewareMode: true },
    appType: "custom",
    logLevel: "error",
    resolve: { alias: { "@": join(root, "src") } },
  });
  try {
    const view = await vite.ssrLoadModule("/src/lib/juicychat/tag-forensics-view.ts");
    assert(view.comboMatchesQuery("yandere", "romance", "yandere x romance"), "combo yandere x romance");
    assert(view.comboMatchesQuery("romance", "yandere", "yandere x romance"), "combo swapped");
    assert(!view.comboMatchesQuery("comedy", "fantasy", "yandere x romance"), "combo miss");
    assert(view.tagMatchesQuery("yandere", "yan"), "tag prefix");
    assert(!/\bnode:/.test(String(view.tagKey)), "view helpers have no node:");
    console.log("SMOKE CLIENT VIEW OK");
  } finally {
    await vite.close().catch(() => {});
  }
}

function pickChrome() {
  for (const c of [
    process.env.PLAYWRIGHT_CHROMIUM,
    "/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell",
    "/root/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell",
    "/root/.cache/ms-playwright/chromium-1243/chrome-linux/chrome",
  ]) {
    if (c && existsSync(c)) return c;
  }
  return undefined;
}

async function pages() {
  mkdirSync(shotDir, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    executablePath: pickChrome(),
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const report = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    const routes = [
      { path: "/", expect: /SampleCreator|lounge|Creator/i, shot: "qa-home.png" },
      { path: "/lounge", expect: /SampleCreator|bots|warehouse|dashboard/i, shot: "qa-lounge.png" },
      { path: "/forensics", expect: /Forensics|Tag|catalog|warehouse/i, shot: "qa-forensics.png", forbid: /node:os|Something went wrong/i },
      { path: "/timing", expect: /Timing|heatmap|slot|Madrid/i, shot: "qa-timing.png", forbid: /Cannot read properties|Something went wrong/i },
      { path: "/stalker", expect: /rival|compare|pin|track/i, shot: "qa-stalker.png" },
      { path: "/config", expect: /JuicyChat|source|database|PGLite|local/i, shot: "qa-config.png" },
    ];
    for (const r of routes) {
      const consoleErrors = [];
      const pageErrors = [];
      const onConsole = (msg) => {
        if (msg.type() === "error") consoleErrors.push(msg.text());
      };
      const onPage = (err) => pageErrors.push(String(err?.message || err));
      page.on("console", onConsole);
      page.on("pageerror", onPage);
      const resp = await page.goto(`${base}${r.path}`, { waitUntil: "networkidle", timeout: 45000 });
      await page.waitForTimeout(1200);
      const status = resp?.status() ?? 0;
      const body = (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ");
      const html = await page.content();
      const shot = join(shotDir, r.shot);
      await page.screenshot({ path: shot, fullPage: false });
      page.off("console", onConsole);
      page.off("pageerror", onPage);

      const fatal = pageErrors.concat(consoleErrors).filter((t) =>
        /node:os|homedir|Cannot access|Cannot read properties of undefined|Something went wrong/i.test(t),
      );
      const overlay = /Something went wrong/i.test(body) || /node:os\.homedir/i.test(html);
      assert(status < 400 && status > 0, `${r.path} HTTP ${status}`);
      assert(!overlay, `${r.path} rendered error overlay`);
      if (r.forbid) assert(!r.forbid.test(body + html), `${r.path} matched forbidden text`);
      assert(r.expect.test(body) || r.expect.test(html), `${r.path} missing expected copy: ${body.slice(0, 180)}`);
      assert(!fatal.length, `${r.path} console/page errors:\n${fatal.join("\n")}`);
      report.push({
        path: r.path,
        status,
        bodyChars: body.length,
        consoleErrors: consoleErrors.length,
        pageErrors: pageErrors.length,
        shot,
      });
      console.log("QA PAGE OK", r.path, { status, bodyChars: body.length, shot });
    }
  } finally {
    await browser.close();
  }
  return report;
}

async function main() {
  if (process.env.SMOKE_SKIP_VIEW !== "1") {
    await unitView();
  }
  const html = await fetch(`${base}/forensics`).then((r) => r.text());
  assert(!/node:os\.homedir/.test(html), "/forensics leaked node:os.homedir");
  assert(!/Something went wrong/.test(html), "/forensics SSR error overlay");
  const report = await pages();
  console.log("SMOKE CLIENT QA OK", { base, pages: report.map((p) => p.path) });
}

main().catch((err) => {
  console.error("SMOKE CLIENT QA FAIL", err);
  process.exit(1);
});
