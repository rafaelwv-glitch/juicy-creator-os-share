/**
 * Writable home for local / Electron clients.
 * Vercel stays ephemeral (/tmp + IndexedDB). Do not import from client components.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

export function isServerlessRuntime(): boolean {
  if (typeof process === "undefined") return false;
  return (
    process.env.VERCEL === "1" ||
    process.env.VERCEL === "true" ||
    Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME) ||
    process.env.NETLIFY === "true" ||
    process.cwd() === "/var/task" ||
    process.cwd().startsWith("/var/task/")
  );
}

function electronRoot(): string | null {
  const portable = process.env.PORTABLE_EXECUTABLE_DIR?.trim();
  if (portable) return join(portable, "Juicy Creator OS Data");
  const explicit = process.env.ELECTRON_USER_DATA?.trim();
  if (explicit) return explicit;
  return null;
}

/** Stable per-user folder (not the git checkout, not an AppImage mount). */
export function defaultClientHome(): string {
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

function legacyCwdData(): string {
  try {
    return join(process.cwd(), "data");
  } catch {
    return join(tmpdir(), "juicy-lounge-data");
  }
}

function hasLegacyWarehouse(dir: string): boolean {
  return (
    existsSync(join(dir, "last-snapshot.json")) ||
    existsSync(join(dir, "juicy-session.json")) ||
    existsSync(join(dir, "users")) ||
    existsSync(join(dir, "pglite"))
  );
}

/** JSON warehouse directory (session, snapshots, analytics files). */
export function resolveLoungeDataDir(): string {
  const forced = process.env.JUICY_DATA_DIR?.trim();
  if (forced) return forced;
  if (isServerlessRuntime()) return join(tmpdir(), "juicy-lounge-data");
  const legacy = legacyCwdData();
  if (hasLegacyWarehouse(legacy)) return legacy;
  return join(defaultClientHome(), "lounge");
}

/** File-backed PGLite directory. Undefined on serverless (in-memory). */
export function resolvePgliteDir(): string | undefined {
  if (typeof process === "undefined") return undefined;
  const forced = process.env.PGLITE_DATA_DIR?.trim();
  if (forced) return forced;
  if (isServerlessRuntime()) return undefined;
  const legacy = join(legacyCwdData(), "pglite");
  if (existsSync(legacy)) return legacy;
  return join(defaultClientHome(), "pglite");
}

export type LoungeHomeInfo = {
  home: string;
  lounge: string;
  pglite: string | null;
  legacyCwd: string;
  electron: boolean;
  serverless: boolean;
};

export function loungeHomeInfo(): LoungeHomeInfo {
  return {
    home: defaultClientHome(),
    lounge: resolveLoungeDataDir(),
    pglite: resolvePgliteDir() || null,
    legacyCwd: legacyCwdData(),
    electron: Boolean(electronRoot()),
    serverless: isServerlessRuntime(),
  };
}

const README = `Juicy Creator OS — local database

lounge/   JSON warehouse (JuicyChat session, snapshots, analytics)
pglite/   embedded Postgres (file-backed PGLite)

The app reads and writes this folder on every scrape and login.
Copy the whole folder to back up. Do not commit it to git.
`;

export function ensureLoungeHome(): LoungeHomeInfo {
  const info = loungeHomeInfo();
  if (info.serverless) return info;
  try {
    mkdirSync(info.lounge, { recursive: true });
    if (info.pglite) mkdirSync(info.pglite, { recursive: true });
    mkdirSync(info.home, { recursive: true });
    const readme = join(info.home, "README.txt");
    if (!existsSync(readme)) writeFileSync(readme, README, "utf8");
  } catch {
    /* RO filesystem — callers fall back */
  }
  return info;
}
