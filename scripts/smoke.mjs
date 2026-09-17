#!/usr/bin/env node
/**
 * Boot the app, hit /api/health and /, assert sample dashboard HTML/JSON.
 * Usage: node scripts/smoke.mjs
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.SMOKE_PORT || 8099);
const HOST = "127.0.0.1";
const base = `http://${HOST}:${PORT}`;

function start() {
  const viteJs = join(root, "node_modules", "vite", "bin", "vite.js");
  const child = spawn(process.execPath, [viteJs, "dev", "--host", HOST, "--port", String(PORT)], {
    cwd: root,
    env: { ...process.env, VITE_AUTH_ENABLED: "false" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (b) => process.stdout.write(b));
  child.stderr.on("data", (b) => process.stderr.write(b));
  return child;
}

async function waitReady(child, ms = 90000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (child.exitCode != null) throw new Error(`dev server exited ${child.exitCode}`);
    try {
      const r = await fetch(`${base}/api/health`);
      if (r.ok) return;
    } catch {
      /* */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("timeout waiting for /api/health");
}

async function main() {
  const child = start();
  const kill = () => {
    try {
      child.kill("SIGTERM");
    } catch {
      /* */
    }
  };
  process.on("exit", kill);
  try {
    await waitReady(child);
    const health = await fetch(`${base}/api/health`).then((r) => r.json());
    if (health.grokAuth) throw new Error("expected grokAuth false");
    const home = await fetch(`${base}/`).then((r) => r.text());
    if (!/Juicy|Sample|Creator|lounge/i.test(home)) {
      throw new Error("home page missing expected markup");
    }
    const dash = await fetch(`${base}/api/lounge/dashboard`).then((r) => r.json());
    const bots = dash?.dashboard?.snapshot?.bots || dash?.dashboard?.snapshot?.profile;
    if (!dash || dash.ok === false) {
      console.warn("dashboard payload", JSON.stringify(dash).slice(0, 400));
    }
    console.log("SMOKE OK", {
      health: { ok: health.ok, grokAuth: health.grokAuth, db: health.db },
      homeChars: home.length,
      dashOk: dash?.ok !== false,
      bots: Array.isArray(dash?.dashboard?.snapshot?.bots)
        ? dash.dashboard.snapshot.bots.length
        : bots
          ? "profile"
          : 0,
    });
  } finally {
    kill();
  }
}

main().catch((err) => {
  console.error("SMOKE FAIL", err);
  process.exit(1);
});
