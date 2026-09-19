#!/usr/bin/env node
/**
 * Fire the same daily-pull handler (`/api/cron/pull`) against a
 * running local server. Does not require a cloud host or CRON_SECRET.
 *
 *   npm run dev                # in one terminal
 *   npm run cron:local         # in another
 */
import { loadLocalEnv } from "./local-env.mjs";

loadLocalEnv();

const base = (process.env.LOCAL_APP_URL || "http://localhost:8080").replace(/\/+$/, "");
const secret = process.env.CRON_SECRET?.trim() || process.env.LOUNGE_CRON_SECRET?.trim() || "";
const url = `${base}/api/cron/pull`;

const headers = {
  accept: "application/json",
  "user-agent": "juicylounge-cron",
};
if (secret) headers.authorization = `Bearer ${secret}`;

console.log(`[cron:local] POST ${url}`);
let res;
try {
  res = await fetch(url, { method: "POST", headers });
} catch (e) {
  console.error(
    `[cron:local] cannot reach ${url} — start the app first (npm run dev).\n${e instanceof Error ? e.message : e}`,
  );
  process.exit(1);
}

const text = await res.text();
let body = text;
try {
  body = JSON.stringify(JSON.parse(text), null, 2);
} catch {
  /* raw */
}
console.log(`[cron:local] HTTP ${res.status}`);
console.log(body);
if (!res.ok) process.exit(1);
