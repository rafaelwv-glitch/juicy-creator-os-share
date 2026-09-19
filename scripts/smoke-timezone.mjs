#!/usr/bin/env node
/**
 * Timezone autodect + Config override.
 * Isolated Vite (configFile: false) so this never locks the live PGLite.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, acc);
    else if (/\.(tsx|ts|jsx|js)$/.test(name)) acc.push(p);
  }
  return acc;
}

function stripTypeImports(src) {
  return src.replace(/import\s+type\s+[\s\S]*?from\s+["'][^"']+["']\s*;?/g, "");
}

async function main() {
  const dir = mkdtempSync(join(tmpdir(), "jcos-tz-"));
  process.env.JUICY_DATA_DIR = dir;
  process.env.PGLITE_DATA_DIR = join(dir, "pglite");
  delete process.env.JUICY_TZ;
  mkdirSync(process.env.PGLITE_DATA_DIR, { recursive: true });

  const vite = await createServer({
    root,
    configFile: false,
    cacheDir: join(root, "node_modules/.vite-smoke-tz"),
    server: { middlewareMode: true },
    appType: "custom",
    logLevel: "error",
    resolve: { alias: { "@": join(root, "src") } },
  });

  try {
    const tz = await vite.ssrLoadModule("/src/lib/juicychat/timezone.ts");
    const srv = await vite.ssrLoadModule("/src/lib/juicychat/timezone-server.ts");

    assert(tz.isValidTimeZone("Europe/Madrid"), "Madrid is a valid IANA zone");
    assert(tz.isValidTimeZone("America/New_York"), "New York is a valid IANA zone");
    assert(tz.isValidTimeZone("Asia/Tokyo"), "Tokyo is a valid IANA zone");
    assert(!tz.isValidTimeZone("Not/AZone"), "junk zone rejected");
    assert(!tz.isValidTimeZone(""), "empty zone rejected");

    const detected = tz.detectHostTimezone();
    assert(tz.isValidTimeZone(detected), `detectHostTimezone ${detected}`);
    assert(tz.normalizeTimeZone("bogus") === detected, "normalize falls back to host");
    assert(tz.timezoneCity("America/New_York") === "New York", "city label");
    assert(tz.timezoneCity("UTC") === "UTC", "UTC city");

    const instant = Date.parse("2026-01-15T12:00:00.000Z");
    const utc = tz.zonedParts(instant, "UTC");
    const ny = tz.zonedParts(instant, "America/New_York");
    const tokyo = tz.zonedParts(instant, "Asia/Tokyo");
    assert(utc.h === 12, `UTC hour ${utc.h}`);
    assert(ny.h === 7, `NY winter hour ${ny.h}`);
    assert(tokyo.h === 21, `Tokyo hour ${tokyo.h}`);
    assert(tz.dayKeyInZone(new Date(instant), "UTC") === "2026-01-15", "UTC day key");
    assert(tz.clockInZone("UTC", instant) === "12:00", "UTC clock");

    const formatted = tz.formatWhenInZone("2026-01-15T12:00:00.000Z", "UTC");
    assert(/15/.test(formatted) && /2026/.test(formatted), `formatWhenInZone ${formatted}`);

    srv.resetTimezoneMemo();
    const auto = srv.loadTimezoneSettings();
    assert(auto.mode === "auto", `fresh auto mode, got ${auto.mode}`);
    assert(auto.timezone === detected, `auto uses host ${auto.timezone} vs ${detected}`);
    assert(!existsSync(join(dir, "shared", "timezone.json")) && !existsSync(join(dir, "timezone.json")), "no file until save");

    const saved = srv.saveTimezoneSettings({ mode: "manual", timezone: "America/New_York" });
    assert(saved.mode === "manual", "saved manual");
    assert(saved.timezone === "America/New_York", saved.timezone);
    srv.resetTimezoneMemo();
    const loaded = srv.loadTimezoneSettings();
    assert(loaded.timezone === "America/New_York", `reload ${loaded.timezone}`);
    assert(loaded.mode === "manual", loaded.mode);

    process.env.JUICY_TZ = "Asia/Tokyo";
    srv.resetTimezoneMemo();
    const fileWins = srv.loadTimezoneSettings();
    assert(fileWins.timezone === "America/New_York", "saved file beats JUICY_TZ");

    srv.saveTimezoneSettings({ mode: "auto" });
    srv.resetTimezoneMemo();
    const back = srv.loadTimezoneSettings();
    assert(back.mode === "auto", "auto after save");
    assert(back.timezone === detected, `auto after save ${back.timezone}`);

    const envDir = mkdtempSync(join(tmpdir(), "jcos-tz-env-"));
    process.env.JUICY_DATA_DIR = envDir;
    process.env.JUICY_TZ = "Pacific/Auckland";
    srv.resetTimezoneMemo();
    const fromEnv = srv.loadTimezoneSettings();
    assert(fromEnv.mode === "manual", `env pins mode, got ${fromEnv.mode}`);
    assert(fromEnv.timezone === "Pacific/Auckland", fromEnv.timezone);

    const payload = srv.timezonePublicPayload();
    assert(payload.timezone === "Pacific/Auckland", "public payload");
    assert(payload.detected === detected, "detected stays host");

    const pdf = readFileSync(join(root, "src/lib/juicychat/pdf-report.ts"), "utf8");
    assert(!/timezone-server/.test(pdf), "pdf-report must not import timezone-server (browser PDF)");
    assert(/getDisplayTimezone/.test(pdf), "pdf-report uses browser-safe display timezone");

    const format = readFileSync(join(root, "src/lib/juicychat/format.ts"), "utf8");
    assert(/getDisplayTimezone/.test(format), "formatWhen uses lounge display timezone");

    const panel = readFileSync(join(root, "src/components/timezone-panel.tsx"), "utf8");
    assert(/saveTimezoneSettings/.test(panel), "Config timezone panel can save");
    assert(/detectHostTimezone|detected/.test(panel), "Config timezone panel shows autodect");

    const clientRoots = [join(root, "src/components"), join(root, "src/routes")];
    const offenders = [];
    const madrid = [];
    for (const cdir of clientRoots) {
      for (const file of walk(cdir)) {
        if (file.includes("/routes/api/")) continue;
        const src = stripTypeImports(readFileSync(file, "utf8"));
        if (/from\s+["']@\/lib\/juicychat\/timezone-server["']/.test(src)) {
          offenders.push(file.replace(root + "/", ""));
        }
        if (/Europe\/Madrid/.test(src)) madrid.push(file.replace(root + "/", ""));
      }
    }
    assert(!offenders.length, `client files import timezone-server:\n  ${offenders.join("\n  ")}`);
    assert(!madrid.length, `client files still hardcode Europe/Madrid:\n  ${madrid.join("\n  ")}`);

    const warehouse = readFileSync(join(root, "src/lib/juicychat/backup.ts"), "utf8");
    assert(/timezone\.json/.test(warehouse), "warehouse includes timezone.json");
    assert(/followed-bots\.json/.test(warehouse), "warehouse includes followed-bots.json");
    const kv = readFileSync(join(root, "src/lib/juicychat/durable-io.ts"), "utf8");
    assert(/timezone\.json/.test(kv), "lounge kv includes timezone.json");

    console.log("SMOKE TIMEZONE OK", {
      detected,
      manualRoundTrip: "America/New_York",
      envPin: "Pacific/Auckland",
      zones: tz.listTimeZones().length,
    });
    await vite.close().catch(() => {});
    rmSync(dir, { recursive: true, force: true });
    rmSync(envDir, { recursive: true, force: true });
  } catch (e) {
    await vite.close().catch(() => {});
    rmSync(dir, { recursive: true, force: true });
    throw e;
  }
}

main().catch((e) => {
  console.error("SMOKE TIMEZONE FAIL", e);
  process.exit(1);
});
