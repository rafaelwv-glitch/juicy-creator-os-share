#!/usr/bin/env node
/**
 * Guard: Forensics UI must not pull Node os/fs into the browser bundle.
 * Regression: TagForensicsPanel imported tag-forensics.ts → paths → lounge-home
 * → node:os.homedir → Vite "Cannot access node:os.homedir in client code".
 *
 * Static only — do not boot Vite here; a second PGLite lock kills the live server.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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

const panel = readFileSync(join(root, "src/components/tag-forensics-panel.tsx"), "utf8");
assert(
  panel.includes("@/lib/juicychat/tag-forensics-view"),
  "TagForensicsPanel must import from tag-forensics-view",
);
assert(
  !/from\s+["']@\/lib\/juicychat\/tag-forensics["']/.test(panel),
  "TagForensicsPanel must not import the Node analyzer",
);

const view = readFileSync(join(root, "src/lib/juicychat/tag-forensics-view.ts"), "utf8");
assert(!/\bnode:/.test(view), "tag-forensics-view must stay browser-safe (no node: imports)");
assert(!/from\s+["']\.\/paths["']/.test(view), "tag-forensics-view must not import paths.ts");
assert(!/lounge-home/.test(view), "tag-forensics-view must not import lounge-home");
assert(view.includes("[×x,|/") || view.includes("[×x,"), "queryTokens must split on x / ×");
assert(/export function comboMatchesQuery/.test(view), "comboMatchesQuery must live in the view module");

const clientRoots = [join(root, "src/components"), join(root, "src/routes")];
const forbidden = [
  "@/lib/juicychat/tag-forensics",
  "@/lib/juicychat/paths",
  "@/lib/lounge-home",
  "node:os",
  "node:fs",
];
const offenders = [];
for (const dir of clientRoots) {
  for (const file of walk(dir)) {
    if (file.includes("/routes/api/")) continue;
    const src = stripTypeImports(readFileSync(file, "utf8"));
    for (const spec of forbidden) {
      const re = new RegExp(
        `from\\s+["']${spec.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`,
      );
      if (re.test(src)) offenders.push(`${file.replace(root + "/", "")} → ${spec}`);
    }
  }
}
assert(!offenders.length, `client files pull Node I/O:\n  ${offenders.join("\n  ")}`);

const base = process.env.SMOKE_BASE;
if (base) {
  const url = `${base.replace(/\/$/, "")}/forensics`;
  const html = await fetch(url).then((r) => r.text());
  assert(!/node:os\.homedir/.test(html), `/forensics leaked node:os.homedir (${url})`);
  assert(!/Something went wrong/.test(html), `/forensics rendered AppErrorComponent (${url})`);
  assert(/Forensics|Tag|warehouse|catalog/i.test(html), `/forensics missing expected markup`);
  console.log("SMOKE FORENSICS PAGE OK", { url, chars: html.length });
}

console.log("SMOKE FORENSICS CLIENT OK");
