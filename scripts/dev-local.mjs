#!/usr/bin/env node
/**
 * Local laptop entry: optional Docker Postgres, migrate, then `vite dev`.
 *
 *   npm run dev:local
 *
 * If Docker is missing / unhealthy, falls back to file-backed PGLite
 * (unset DATABASE_URL for this process) so the app still starts offline.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { databaseUrl, loadLocalEnv } from "./local-env.mjs";

loadLocalEnv();

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const composeFile = join(root, "docker-compose.yml");

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { stdio: "inherit", cwd: root, ...opts });
}

function hasDocker() {
  const r = spawnSync("docker", ["compose", "version"], { stdio: "pipe" });
  return r.status === 0;
}

function waitForPostgres(url, attempts = 24) {
  return new Promise((resolve, reject) => {
    let n = 0;
    const tick = async () => {
      n += 1;
      try {
        const { default: pg } = await import("pg");
        const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 2000 });
        await client.connect();
        await client.query("select 1");
        await client.end();
        resolve();
        return;
      } catch (e) {
        if (n >= attempts) {
          reject(e);
          return;
        }
        setTimeout(tick, 1000);
      }
    };
    void tick();
  });
}

async function maybeStartPostgres() {
  const url = databaseUrl();
  if (!url) {
    console.log("[dev:local] DATABASE_URL unset — using file-backed PGLite");
    return;
  }
  if (!hasDocker()) {
    console.warn("[dev:local] Docker Compose not found. If Postgres is not already running, unset DATABASE_URL to use PGLite.");
    return;
  }
  if (!existsSync(composeFile)) return;
  console.log("[dev:local] docker compose up -d");
  const up = run("docker", ["compose", "-f", composeFile, "up", "-d"]);
  if (up.status !== 0) {
    console.warn("[dev:local] docker compose up failed — continuing; migrate will error if Postgres is down.");
    return;
  }
  console.log("[dev:local] waiting for Postgres…");
  await waitForPostgres(url);
}

async function migrate() {
  const script = join(root, "scripts", "migrate.mjs");
  const r = run(process.execPath, [script]);
  if (r.status !== 0) {
    console.warn("[dev:local] db:migrate failed — Vite will bootstrap PGLite on start");
  }
}

await maybeStartPostgres();
if (databaseUrl()) {
  await migrate();
} else {
  console.log("[dev:local] file-backed PGLite — Vite migrates on boot");
}

console.log("[dev:local] starting vite on http://0.0.0.0:8080");
const child = spawn("npm", ["run", "dev:vite"], { stdio: "inherit", cwd: root, shell: false });
child.on("exit", (code) => process.exit(code ?? 0));
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => child.kill(sig));
}
