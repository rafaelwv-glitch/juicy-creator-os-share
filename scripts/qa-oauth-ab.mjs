#!/usr/bin/env node
/**
 * A/B + exhaustive QA for lounge Google login.
 *
 * A (default): pop-up. Parent stays on /login; a new window hits /auth/popup → broker.
 * B (?oauth=redirect): full-page. Parent leaves /login for the broker; MUST NOT bounce back.
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.env.QA_BASE || "http://127.0.0.1:8080";
const SCREEN = "/workspace/screenshots";
mkdirSync(SCREEN, { recursive: true });

const results = [];
const failures = [];

function record(name, pass, extra = {}) {
  results.push({ name, pass, ...extra });
  if (!pass) failures.push({ name, ...extra });
  const mark = pass ? "PASS" : "FAIL";
  console.log(`${mark}  ${name}${extra.detail ? ` — ${extra.detail}` : ""}`);
}

async function get(path, headers = {}) {
  const r = await fetch(`${BASE}${path}`, { redirect: "manual", headers });
  const loc = r.headers.get("location") || "";
  return { status: r.status, loc, type: r.headers.get("content-type") || "" };
}

function isBrokerOrGoogle(url) {
  const u = String(url || "").toLowerCase();
  return (
    u.includes("auth.grok.me") ||
    u.includes("accounts.google.com") ||
    u.includes("google.com/o/oauth") ||
    u.includes("/api/auth/oauth2/authorize")
  );
}

function isPopupStart(url) {
  const u = String(url || "");
  return u.includes("/auth/popup") || isBrokerOrGoogle(u);
}

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

async function withPage(fn) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  try {
    return await fn(page, context, errors);
  } finally {
    await context.close();
  }
}

// ---------------------------------------------------------------------------
// Server-side probes (no browser)
// ---------------------------------------------------------------------------
{
  const missing = await get("/auth/popup");
  record("GET /auth/popup without provider → 400", missing.status === 400, {
    status: missing.status,
  });

  const local = await get("/auth/popup?providerId=grok-google");
  record("GET /auth/popup Google → 302 to broker", local.status === 302 && isBrokerOrGoogle(local.loc), {
    status: local.status,
    loc: local.loc.slice(0, 180),
  });
  record(
    "popup redirect_uri is this origin (or sandbox)",
    /redirect_uri=/.test(local.loc) &&
      (/localhost%3A8080|127\.0\.0\.1%3A8080|grok-sandbox\.com|vercel\.app/.test(local.loc)),
    { loc: local.loc.slice(0, 220) },
  );

  const x = await get("/auth/popup?providerId=grok-x");
  record("GET /auth/popup X → 302 to broker", x.status === 302 && isBrokerOrGoogle(x.loc), {
    status: x.status,
    loc: x.loc.slice(0, 180),
  });

  const sb = await get("/auth/popup?providerId=grok-google", {
    Host: "abc123.grok-sandbox.com",
    "x-forwarded-host": "abc123.grok-sandbox.com",
    "x-forwarded-proto": "https",
  });
  record(
    "sandbox Host popup redirect_uri uses https://*.grok-sandbox.com",
    sb.status === 302 && /abc123\.grok-sandbox\.com/.test(sb.loc) && /redirect_uri=https%3A%2F%2F/.test(sb.loc),
    { status: sb.status, loc: sb.loc.slice(0, 220) },
  );

  const handoff = await fetch(`${BASE}/auth/popup/handoff?id=${crypto.randomUUID()}`);
  const hj = await handoff.json().catch(() => ({}));
  record("GET /auth/popup/handoff pending", handoff.ok && hj.pending === true, { body: hj });

  const loginPage = await fetch(`${BASE}/login`);
  record("GET /login 200", loginPage.status === 200);

  const home = await fetch(`${BASE}/`, { redirect: "manual" });
  record("GET / 200 (SPA; client gate sends guests to /login)", home.status === 200);
}

// ---------------------------------------------------------------------------
// Variant A — popup (default)
// ---------------------------------------------------------------------------
const variantA = await withPage(async (page, context, errors) => {
  const popups = [];
  page.on("popup", (p) => popups.push(p));

  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(SCREEN, "ab-a-login.png"), fullPage: false });

  const google = page.getByRole("button", { name: /Continue with Google/i });
  record("A: Google button visible", await google.count() > 0);

  const popupPromise = page.waitForEvent("popup", { timeout: 8000 }).catch(() => null);
  await google.click();
  const popup = await popupPromise;

  await page.waitForTimeout(2500);
  const parentUrl = page.url();
  const parentText = await page.locator("body").innerText();
  await page.screenshot({ path: join(SCREEN, "ab-a-after-click.png"), fullPage: false });

  let popupUrl = "";
  let popupFinal = "";
  if (popup) {
    popupUrl = popup.url();
    await popup.waitForLoadState("domcontentloaded").catch(() => {});
    await page.waitForTimeout(1500);
    popupFinal = popup.url();
    await popup.screenshot({ path: join(SCREEN, "ab-a-popup.png"), fullPage: false }).catch(() => {});
  }

  const parentStayed =
    /\/login/.test(parentUrl) && !isBrokerOrGoogle(parentUrl);
  const bouncedHome = parentUrl.replace(/\/+$/, "").endsWith(BASE.replace(/\/+$/, "")) && !/login/.test(parentUrl);

  record("A: pop-up opened", Boolean(popup), {
    popupCount: popups.length,
    popupUrl: popupUrl.slice(0, 180),
  });
  record("A: parent stayed on /login (no 2s bounce)", parentStayed && !bouncedHome, {
    parentUrl,
    bouncedHome,
    hint: parentText.slice(0, 180),
  });
  record("A: pop-up reached /auth/popup or broker/Google", popup ? isPopupStart(popupUrl) || isBrokerOrGoogle(popupFinal) : false, {
    popupUrl: popupUrl.slice(0, 200),
    popupFinal: popupFinal.slice(0, 200),
  });
  record("A: waiting copy shown on parent", /window should have opened|pop-up|Google \/ X window/i.test(parentText), {
    excerpt: parentText.slice(0, 240),
  });
  record("A: no pageerror", errors.length === 0, { errors: errors.slice(0, 5) });

  return { parentUrl, popupUrl: popupFinal || popupUrl };
});

// ---------------------------------------------------------------------------
// Variant B — full-page redirect (?oauth=redirect)
// ---------------------------------------------------------------------------
const variantB = await withPage(async (page, context, errors) => {
  const popups = [];
  page.on("popup", (p) => popups.push(p));

  await page.goto(`${BASE}/login?oauth=redirect`, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(SCREEN, "ab-b-login.png"), fullPage: false });

  const google = page.getByRole("button", { name: /Continue with Google/i });
  await google.click();

  // Must leave /login toward the broker, and MUST NOT land back on /login.
  const left = await page
    .waitForURL((u) => isBrokerOrGoogle(u.href) || /oauth2\/authorize/.test(u.href), {
      timeout: 12000,
    })
    .then(() => true)
    .catch(() => false);

  await page.waitForTimeout(2000);
  const after = page.url();
  await page.screenshot({ path: join(SCREEN, "ab-b-after-click.png"), fullPage: false });

  const bounced = /\/login/.test(after) && !isBrokerOrGoogle(after);

  record("B: no pop-up (full-page variant)", popups.length === 0, { popupCount: popups.length });
  record("B: navigated to broker/Google", left || isBrokerOrGoogle(after), { after: after.slice(0, 220) });
  record("B: did NOT bounce back to /login", !bounced, { after: after.slice(0, 220) });
  record("B: no pageerror", errors.length === 0, { errors: errors.slice(0, 5) });

  return { after };
});

// ---------------------------------------------------------------------------
// Iframe (live-preview shape)
// ---------------------------------------------------------------------------
await withPage(async (page, context) => {
  // Same-origin wrapper so the iframe is not opaque (setContent is). Grok's
  // live preview also embeds same-scheme and allows popups.
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.evaluate((src) => {
    const f = document.createElement("iframe");
    f.src = src;
    f.setAttribute("allow", "popups *; popups-to-escape-sandbox *");
    f.style.cssText = "position:fixed;inset:0;width:100%;height:100%;border:0;z-index:99;background:#fff";
    document.body.appendChild(f);
  }, `${BASE}/login`);
  await page.waitForTimeout(1000);
  const frame = page.frameLocator("iframe").last();
  const popupPromise = page.waitForEvent("popup", { timeout: 10000 }).catch(() => null);
  await frame.getByRole("button", { name: /Continue with Google/i }).click();
  const popup = await popupPromise;
  await page.waitForTimeout(1500);
  const popupUrl = popup?.url() || "";
  await page.screenshot({ path: join(SCREEN, "ab-iframe.png"), fullPage: false });
  record("iframe: pop-up opened from embedded login", Boolean(popup), {
    popupUrl: popupUrl.slice(0, 200),
  });
  record("iframe: pop-up is OAuth (not the app shell)", popup ? isPopupStart(popupUrl) : false, {
    popupUrl: popupUrl.slice(0, 200),
  });
});

// ---------------------------------------------------------------------------
// Email path still works (exhaustive)
// ---------------------------------------------------------------------------
await withPage(async (page, _ctx, errors) => {
  const email = `qa-${Date.now()}@example.com`;
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Need an account/i }).click();
  await page.getByPlaceholder("you@email.com").fill(email);
  await page.getByPlaceholder(/Password/i).fill("password123");
  await page.getByRole("button", { name: /Create account/i }).click();
  await page.waitForURL((u) => u.pathname === "/" || u.pathname === "", { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1200);
  const url = page.url();
  const body = await page.locator("body").innerText();
  await page.screenshot({ path: join(SCREEN, "ab-email-after.png"), fullPage: false });
  const session = await page.evaluate(async () => {
    const r = await fetch("/api/auth/get-session", { credentials: "include" });
    return r.json().catch(() => null);
  });
  const ok = Boolean(session?.user) || /Open dashboard|@/.test(body) || /\/$/.test(new URL(url).pathname);
  record("email: create-account reaches dashboard", ok, {
    url,
    user: session?.user?.email || session?.user?.id || null,
    errors: errors.slice(0, 3),
  });
});

// ---------------------------------------------------------------------------
// X button also opens a pop-up
// ---------------------------------------------------------------------------
await withPage(async (page) => {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  const popupPromise = page.waitForEvent("popup", { timeout: 8000 }).catch(() => null);
  await page.getByRole("button", { name: /Continue with X/i }).click();
  const popup = await popupPromise;
  await page.waitForTimeout(1200);
  record("X: pop-up opened", Boolean(popup), { url: popup?.url()?.slice(0, 180) });
});

// ---------------------------------------------------------------------------
// Mobile viewport popup
// ---------------------------------------------------------------------------
{
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  const popupPromise = page.waitForEvent("popup", { timeout: 8000 }).catch(() => null);
  await page.getByRole("button", { name: /Continue with Google/i }).click();
  const popup = await popupPromise;
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(SCREEN, "ab-mobile.png"), fullPage: false });
  record("mobile: pop-up opened", Boolean(popup), { url: popup?.url()?.slice(0, 180) });
  const stayed = /\/login/.test(page.url());
  record("mobile: parent stayed on /login", stayed, { url: page.url() });
  await context.close();
}

await browser.close();

const report = {
  base: BASE,
  variantA,
  variantB,
  passed: results.filter((r) => r.pass).length,
  failed: failures.length,
  total: results.length,
  results,
  failures,
};
const out = join(dirname(fileURLToPath(import.meta.url)), "../screenshots/qa-oauth-ab.json");
writeFileSync(out, JSON.stringify(report, null, 2));
console.log("\nSUMMARY", JSON.stringify({ passed: report.passed, failed: report.failed, total: report.total }));
if (failures.length) {
  console.error(JSON.stringify(failures, null, 2));
  process.exit(2);
}
