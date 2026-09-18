#!/usr/bin/env node
/**
 * Create the local lounge DB dirs and seed SampleCreator if empty.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureLoungeHome } from "./lounge-home.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const info = ensureLoungeHome();

const marker = join(info.lounge, "last-snapshot.json");
if (!existsSync(marker)) {
  const fixture = join(root, "fixtures", "warehouse-sample.json");
  if (existsSync(fixture)) {
    const raw = JSON.parse(readFileSync(fixture, "utf8"));
    for (const [name, body] of Object.entries(raw.files || {})) {
      if (!String(name).endsWith(".json")) continue;
      writeFileSync(join(info.lounge, String(name)), JSON.stringify(body, null, 2));
    }
    console.log("==> seeded sample warehouse into", info.lounge);
  }
} else {
  console.log("==> lounge already has data at", info.lounge);
}

console.log("==> local DB");
console.log("    home  ", info.home);
console.log("    files ", info.lounge);
console.log("    pglite", info.pglite);
