#!/usr/bin/env node
/**
 * Run the production Node server from `npm run build` (Nitro node-server).
 *
 *   npm run build
 *   npm start
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadLocalEnv } from "./local-env.mjs";
import { ensureLoungeHome } from "./lounge-home.mjs";

loadLocalEnv();
ensureLoungeHome();

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const server = join(root, ".output", "server", "index.mjs");
if (!existsSync(server)) {
  console.error("[start] missing .output/server/index.mjs — run `npm run build` first.");
  process.exit(1);
}

const port = String(process.env.PORT || process.env.NITRO_PORT || 8080);
const host = String(process.env.HOST || process.env.NITRO_HOST || "0.0.0.0");
process.env.PORT = port;
process.env.NITRO_PORT = port;
process.env.HOST = host;
process.env.NITRO_HOST = host;
process.env.VITE_AUTH_ENABLED = process.env.VITE_AUTH_ENABLED || "false";

console.log(`[start] node-server http://${host}:${port}`);
const child = spawn(process.execPath, [server], {
  cwd: root,
  env: process.env,
  stdio: "inherit",
});
child.on("exit", (code) => process.exit(code ?? 0));
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => child.kill(sig));
}
