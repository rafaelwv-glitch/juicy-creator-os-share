#!/usr/bin/env node
/**
 * Static guard: this clone is local-only. Vercel must not be the build target.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function read(rel) {
  return readFileSync(join(root, rel), "utf8");
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const pkg = JSON.parse(read("package.json"));
const vite = read("vite.config.ts");
const vercel = read("vercel.json");
const readme = read("README.md");
const tools = read("src/components/data-tools-panel.tsx");
const home = read("src/lib/lounge-home.ts");
const loungeHomeCli = read("scripts/lounge-home.mjs");

assert(pkg.scripts.dev === "node scripts/dev-local.mjs", "npm run dev must be the local installer path");
assert(pkg.scripts.start === "node scripts/start-local.mjs", "npm start must run the local Node server");
assert(String(pkg.scripts.build).includes("bundle-pglite-assets"), "build must copy PGLite WASM next to the node-server");
assert(!String(pkg.scripts.build).includes("vercel"), "build script must not mention vercel");
assert(/preset:\s*["']node-server["']/.test(vite), "vite nitro preset must be node-server");
assert(!/preset:\s*["']vercel["']/.test(vite), "vite must not use the vercel nitro preset");
assert(/github[\s\S]*enabled["']?\s*:\s*false/.test(vercel) || /"enabled":\s*false/.test(vercel), "vercel.json must disable GitHub deploys");
assert(/ignoreCommand/.test(vercel), "vercel.json must skip any leftover Vercel build");
assert(!/Restore on Vercel/.test(tools), "UI must not offer Restore on Vercel");
assert(!/Default branch is `vercel`/.test(readme), "README must not treat vercel as default");
assert(/local-only|Local only|local \/ desktop/i.test(readme), "README must describe local-only");
assert(pkg.version === "1.3.0", `package version must be 1.3.0, got ${pkg.version}`);
assert(pkg.dependencies?.["electron-updater"], "electron-updater must be a production dependency");
assert(Array.isArray(pkg.build?.publish) && pkg.build.publish[0]?.provider === "github", "electron-builder publish = github");
assert(String(pkg.build?.linux?.artifactName || "").includes("linux-x64"), "Linux artifactName must stay linux-x64 (one AppImage)");
assert(String(pkg.scripts["desktop:publish"] || "").includes("--publish always"), "desktop:publish must publish GitHub updater yml");
assert(String(pkg.scripts["desktop:build:win"] || "").includes("npm run build"), "Windows pack must vite-build first");
assert(existsSync(join(root, "desktop/preload.cjs")), "desktop preload must exist");
assert(/return false/.test(home.split("export function isServerlessRuntime")[1]?.slice(0, 400) || ""), "isServerlessRuntime must be a no-op");
assert(/return false/.test(loungeHomeCli.split("export function isServerless")[1]?.slice(0, 400) || ""), "CLI isServerless must be a no-op");

console.log("SMOKE LOCAL-ONLY OK", {
  version: pkg.version,
  dev: pkg.scripts.dev,
  start: pkg.scripts.start,
  nitro: "node-server",
});
