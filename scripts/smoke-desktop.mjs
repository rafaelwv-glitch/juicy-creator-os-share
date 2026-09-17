#!/usr/bin/env node
/**
 * Headless desktop smoke: start vite preview/dev like Electron does, hit health, exit.
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.DESKTOP_PORT || 4311);
const url = `http://127.0.0.1:${PORT}/api/health`;
const viteJs = join(root, "node_modules", "vite", "bin", "vite.js");
const child = spawn(process.execPath, [viteJs, "dev", "--host", "127.0.0.1", "--port", String(PORT)], {
  cwd: root,
  env: { ...process.env, VITE_AUTH_ENABLED: "false" },
  stdio: ["ignore", "pipe", "pipe"],
});
child.stdout.on("data", (b) => process.stdout.write(b));
child.stderr.on("data", (b) => process.stderr.write(b));

const t0 = Date.now();
const timer = setInterval(async () => {
  if (Date.now() - t0 > 90000) {
    console.error("SMOKE DESKTOP FAIL timeout");
    child.kill("SIGTERM");
    process.exit(1);
  }
  try {
    const r = await fetch(url);
    if (!r.ok) return;
    const j = await r.json();
    if (j.grokAuth) throw new Error("auth still on");
    console.log("SMOKE DESKTOP OK", j);
    child.kill("SIGTERM");
    clearInterval(timer);
    setTimeout(() => process.exit(0), 300);
  } catch (e) {
    if (String(e).includes("auth still on")) {
      child.kill("SIGTERM");
      process.exit(1);
    }
  }
}, 500);
