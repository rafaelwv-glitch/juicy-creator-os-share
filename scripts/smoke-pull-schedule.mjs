#!/usr/bin/env node
/**
 * Deleted scrape jobs must stay deleted. Isolated Vite, tmp data dir.
 */
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  const dir = mkdtempSync(join(tmpdir(), "jcos-sched-"));
  process.env.JUICY_DATA_DIR = dir;
  process.env.PGLITE_DATA_DIR = join(dir, "pglite");
  mkdirSync(process.env.PGLITE_DATA_DIR, { recursive: true });

  const vite = await createServer({
    root,
    configFile: false,
    cacheDir: join(root, "node_modules/.vite-smoke-sched"),
    server: { middlewareMode: true },
    appType: "custom",
    logLevel: "error",
    resolve: { alias: { "@": join(root, "src") } },
  });

  try {
    const mod = await vite.ssrLoadModule("/src/lib/juicychat/pull-schedule.ts");

    const fresh = mod.loadPullSchedule();
    assert(fresh.jobs.length === 2, `missing file seeds defaults, got ${fresh.jobs.length}`);
    assert(fresh.jobs.some((j) => j.id === "morning"), "morning default");
    assert(fresh.jobs.some((j) => j.id === "night"), "night default");

    const emptied = mod.savePullSchedule({ enabled: true, jobs: [] });
    assert(emptied.jobs.length === 0, `save [] must persist empty, got ${emptied.jobs.length}`);
    const reloaded = mod.loadPullSchedule();
    assert(reloaded.jobs.length === 0, `reload after delete resurrected ${reloaded.jobs.length} jobs`);

    const one = mod.savePullSchedule({
      enabled: true,
      jobs: [{ id: "custom", name: "Noon", hour: 12, minute: 0, sources: { lounge: true } }],
    });
    assert(one.jobs.length === 1, "single custom job");
    assert(one.jobs[0].id === "custom", "custom id kept");
    assert(!one.jobs.some((j) => j.id === "morning" || j.id === "night"), "defaults stayed gone");

    const parsed = JSON.parse(readFileSync(join(dir, "shared", "pull-schedule.json"), "utf8"));
    assert(Array.isArray(parsed.jobs) && parsed.jobs.length === 1, "file on disk is the custom job");

    const emptyAgain = mod.normalizePullSchedule({ version: 2, jobs: [] });
    assert(emptyAgain.jobs.length === 0, "normalize [] is empty, not defaults");

    const missingJobs = mod.normalizePullSchedule({ version: 2 });
    assert(missingJobs.jobs.length === 2, "version 2 with no jobs key still seeds defaults");

    console.log("SMOKE PULL SCHEDULE OK", { empty: reloaded.jobs.length, custom: one.jobs[0].name });
    await vite.close().catch(() => {});
  } catch (e) {
    await vite.close().catch(() => {});
    throw e;
  }
}

main().catch((e) => {
  console.error("SMOKE PULL SCHEDULE FAIL", e);
  process.exit(1);
});
