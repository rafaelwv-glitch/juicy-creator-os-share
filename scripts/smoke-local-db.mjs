#!/usr/bin/env node
/**
 * Minimal local-DB smoke: migrate a throwaway PGLite dir, import the anonymized
 * fixture, re-import (idempotent), assert counts. No Docker, no secrets.
 *
 *   npm run db:smoke
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = mkdtempSync(join(tmpdir(), "juicy-pglite-smoke-"));
const fixture = join(root, "fixtures", "warehouse-sample.json");

function parseResult(stdout) {
  const line = stdout
    .split(/\r?\n/)
    .reverse()
    .find((l) => l.startsWith("[import] result "));
  if (!line) throw new Error(`no [import] result line\n${stdout}`);
  return JSON.parse(line.slice("[import] result ".length));
}

function run(script, extraArgs = [], extraEnv = {}) {
  const r = spawnSync(process.execPath, [join(root, "scripts", script), ...extraArgs], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      DATABASE_URL: "",
      PGLITE_DATA_DIR: dir,
      JUICY_DATA_DIR: join(dir, "files"),
      ...extraEnv,
    },
  });
  if (r.status !== 0) {
    console.error(r.stdout);
    console.error(r.stderr);
    throw new Error(`${script} exited ${r.status}`);
  }
  return r.stdout;
}

try {
  console.log("[smoke] migrate →", dir);
  const mig = run("migrate.mjs");
  if (!/applied 0001_auth|up to date/i.test(mig) && !/pglite done|pglite up to date/i.test(mig)) {
    console.log(mig);
  }
  if (!/0006_solid_lounge|up to date/i.test(mig)) {
    throw new Error("expected migrations 0001–0006 to apply");
  }

  console.log("[smoke] import fixture");
  const first = run("import-warehouse.mjs", [fixture, "--user-id", "smoke-user", "--no-files"]);
  const parsed = parseResult(first);
  if (!parsed.ok) throw new Error("import did not report ok");
  if (parsed.counts.bots !== 2) throw new Error(`expected 2 bots, got ${parsed.counts.bots}`);
  if (parsed.counts.historyDays !== 2) throw new Error(`expected 2 history days, got ${parsed.counts.historyDays}`);
  if (parsed.counts.events !== 1) throw new Error(`expected 1 event, got ${parsed.counts.events}`);
  if (parsed.snapshotBots !== 2) throw new Error(`expected snapshot bots 2, got ${parsed.snapshotBots}`);
  if (parsed.upserted < 4) throw new Error(`expected several upserts, got ${parsed.upserted}`);

  console.log("[smoke] re-import (idempotent)");
  const second = run("import-warehouse.mjs", [fixture, "--user-id", "smoke-user", "--no-files"]);
  const again = parseResult(second);
  if (again.snapshotBots !== 2 || again.historyDays !== 2) {
    throw new Error("re-import changed counts");
  }

  console.log("[smoke] ok — migrations + warehouse import");
  console.log(
    JSON.stringify(
      {
        ok: true,
        bots: parsed.counts.bots,
        historyDays: parsed.counts.historyDays,
        events: parsed.counts.events,
        keys: parsed.counts.keys,
        reimportKeys: again.dbKeys,
      },
      null,
      2,
    ),
  );
} finally {
  rmSync(dir, { recursive: true, force: true });
}
