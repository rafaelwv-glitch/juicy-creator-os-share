/**
 * Load `.env.local` then `.env` into process.env without overriding real env.
 * Used by local CLI scripts (migrate, import, cron, smoke) so they match Vite.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export function loadLocalEnv(cwd = process.cwd()) {
  for (const name of [".env.local", ".env"]) {
    const path = resolve(cwd, name);
    if (!existsSync(path)) continue;
    const text = readFileSync(path, "utf8");
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      if (!key || process.env[key] !== undefined) continue;
      let value = line.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  }
}

export function databaseUrl() {
  const raw = process.env.DATABASE_URL;
  return raw && raw.trim() ? raw.trim() : undefined;
}

export function pgliteDataDir(cwd = process.cwd()) {
  const forced = process.env.PGLITE_DATA_DIR?.trim();
  if (forced) return forced;
  return resolve(cwd, "data", "pglite");
}

export function isServerless() {
  return (
    process.env.VERCEL === "1" ||
    process.env.VERCEL === "true" ||
    Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME) ||
    process.env.NETLIFY === "true" ||
    process.cwd() === "/var/task" ||
    process.cwd().startsWith("/var/task/")
  );
}
