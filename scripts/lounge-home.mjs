/**
 * CLI path helper — same layout as src/lib/lounge-home.ts
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

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

function electronRoot() {
  const portable = process.env.PORTABLE_EXECUTABLE_DIR?.trim();
  if (portable) return join(portable, "Juicy Creator OS Data");
  const explicit = process.env.ELECTRON_USER_DATA?.trim();
  if (explicit) return explicit;
  return null;
}

export function defaultClientHome() {
  const electron = electronRoot();
  if (electron) return electron;
  const home = homedir();
  if (process.platform === "win32") {
    return join(process.env.APPDATA || join(home, "AppData", "Roaming"), "Juicy Creator OS");
  }
  if (process.platform === "darwin") {
    return join(home, "Library", "Application Support", "Juicy Creator OS");
  }
  return join(process.env.XDG_DATA_HOME || join(home, ".local", "share"), "juicy-creator-os");
}

function legacyCwdData() {
  return join(process.cwd(), "data");
}

function hasLegacy(dir) {
  return (
    existsSync(join(dir, "last-snapshot.json")) ||
    existsSync(join(dir, "juicy-session.json")) ||
    existsSync(join(dir, "users")) ||
    existsSync(join(dir, "pglite"))
  );
}

export function resolveLoungeDataDir() {
  const forced = process.env.JUICY_DATA_DIR?.trim();
  if (forced) return forced;
  if (isServerless()) return join(tmpdir(), "juicy-lounge-data");
  const legacy = legacyCwdData();
  if (hasLegacy(legacy)) return legacy;
  return join(defaultClientHome(), "lounge");
}

export function resolvePgliteDir() {
  const forced = process.env.PGLITE_DATA_DIR?.trim();
  if (forced) return forced;
  if (isServerless()) return null;
  const legacy = join(legacyCwdData(), "pglite");
  if (existsSync(legacy)) return legacy;
  return join(defaultClientHome(), "pglite");
}

export function loungeHomeInfo() {
  return {
    home: defaultClientHome(),
    lounge: resolveLoungeDataDir(),
    pglite: resolvePgliteDir(),
    legacyCwd: legacyCwdData(),
    electron: Boolean(electronRoot()),
    serverless: isServerless(),
  };
}

export function ensureLoungeHome() {
  const info = loungeHomeInfo();
  if (info.serverless) return info;
  mkdirSync(info.lounge, { recursive: true });
  if (info.pglite) mkdirSync(info.pglite, { recursive: true });
  mkdirSync(info.home, { recursive: true });
  const readme = join(info.home, "README.txt");
  if (!existsSync(readme)) {
    writeFileSync(
      readme,
      "Juicy Creator OS — local database\n\nlounge/   JSON warehouse\npglite/   embedded Postgres\n\nThe app reads and writes this folder. Copy it to back up.\n",
      "utf8",
    );
  }
  return info;
}

