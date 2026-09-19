#!/usr/bin/env node
/**
 * Nitro traces `electric-sql__pglite.mjs` into `.output/server/_libs/` but not
 * the WASM/data files it opens at runtime (`pglite.data`, `pglite.wasm`,
 * `initdb.wasm`). Without those, `npm start` dies:
 *   ENOENT open '.output/server/_libs/pglite.wasm'
 *
 * Copy those assets next to every traced pglite module (node-server and any
 * leftover Vercel function tree).
 */
import { copyFile, mkdir, readdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = join(root, "node_modules/@electric-sql/pglite/dist");
const files = ["pglite.data", "pglite.wasm", "initdb.wasm"];

async function walkDirs(dir, acc = []) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const p = join(dir, entry.name);
    acc.push(p);
    await walkDirs(p, acc);
  }
  return acc;
}

async function collectTargets(base) {
  const targets = new Set();
  let st;
  try {
    st = await stat(base);
  } catch {
    return targets;
  }
  if (!st.isDirectory()) return targets;

  const dirs = [base, ...(await walkDirs(base))];
  for (const dir of dirs) {
    const baseName = dir.split("/").pop() || "";
    if (baseName === "_libs") targets.add(dir);
    try {
      const names = await readdir(dir);
      if (names.some((n) => n.includes("pglite"))) targets.add(dir);
    } catch {
      /* */
    }
  }
  return targets;
}

async function copyInto(dir) {
  await mkdir(dir, { recursive: true });
  for (const name of files) {
    await copyFile(join(srcDir, name), join(dir, name));
  }
  return files.length;
}

async function main() {
  const roots = [
    join(root, ".output", "server"),
    join(root, ".vercel", "output", "functions"),
  ];
  const targets = new Set();
  for (const base of roots) {
    for (const dir of await collectTargets(base)) targets.add(dir);
  }
  // Always seed the node-server _libs path even if the tracer renamed it.
  targets.add(join(root, ".output", "server", "_libs"));

  let copied = 0;
  for (const dir of targets) {
    copied += await copyInto(dir);
  }
  console.log(`[pglite-assets] copied ${copied} file(s) into ${targets.size} dir(s)`);
}

main().catch((err) => {
  console.error("[pglite-assets] failed:", err?.message || err);
  process.exit(1);
});
