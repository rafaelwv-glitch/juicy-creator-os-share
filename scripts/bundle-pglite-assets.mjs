#!/usr/bin/env node
/**
 * Nitro's Vercel preset traces `electric-sql__pglite.mjs` into `_libs/` but not
 * the WASM/data files it opens at runtime (`pglite.data`, `pglite.wasm`,
 * `initdb.wasm`). Without those, every `/api/auth/*` call 500s:
 *   ENOENT open '/var/task/_libs/pglite.data'
 *
 * Walk the function output and copy the assets next to every traced pglite
 * module and into every `_libs` directory.
 */
import { copyFile, mkdir, readdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = join(root, "node_modules/@electric-sql/pglite/dist");
const files = ["pglite.data", "pglite.wasm", "initdb.wasm"];
const functionsRoot = join(root, ".vercel/output/functions");

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

async function main() {
  let st;
  try {
    st = await stat(functionsRoot);
  } catch {
    console.log("[pglite-assets] no .vercel/output/functions — skip");
    return;
  }
  if (!st.isDirectory()) return;

  const dirs = await walkDirs(functionsRoot);
  const targets = new Set();
  for (const dir of dirs) {
    const base = dir.split("/").pop() || "";
    if (base === "_libs" || base.endsWith(".func")) targets.add(dir);
    // Nitro traces the module as electric-sql__pglite.mjs inside _libs
    try {
      const names = await readdir(dir);
      if (names.some((n) => n.includes("pglite"))) targets.add(dir);
    } catch {
      /* */
    }
  }
  // Always also seed the top-level function folders
  for (const dir of dirs) {
    if (dir.startsWith(functionsRoot) && dir.split("/").length - functionsRoot.split("/").length === 1) {
      targets.add(join(dir, "_libs"));
    }
  }

  let copied = 0;
  for (const dir of targets) {
    await mkdir(dir, { recursive: true });
    for (const name of files) {
      await copyFile(join(srcDir, name), join(dir, name));
      copied += 1;
    }
  }
  console.log(
    `[pglite-assets] copied ${copied} file(s) into ${targets.size} function dir(s)`,
  );
}

main().catch((err) => {
  console.error("[pglite-assets] failed:", err?.message || err);
  process.exit(1);
});
