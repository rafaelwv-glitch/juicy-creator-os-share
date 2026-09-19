/**
 * Fetch the latest GitHub release. Server-only (uses node:fs for version).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  APP_LATEST_API,
  APP_RELEASES_URL,
  isNewerRelease,
  parseGithubRelease,
  pickAsset,
  preferChannel,
  type LatestRelease,
  type ReleaseAsset,
  type UpdateChannel,
} from "./app-update";

export function currentAppVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
      version?: string;
    };
    if (pkg.version) return String(pkg.version);
  } catch {
    /* */
  }
  return "0.0.0";
}

export type AppUpdateView = {
  current: string;
  latest: string | null;
  newer: boolean;
  tag: string | null;
  name: string | null;
  notes: string;
  htmlUrl: string;
  publishedAt: string | null;
  asset: ReleaseAsset | null;
  assets: ReleaseAsset[];
  channel: UpdateChannel;
  error: string | null;
};

let cached: { at: number; release: LatestRelease } | null = null;
const CACHE_MS = 10 * 60 * 1000;

function githubHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "JuicyCreatorOS",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const token = (process.env.GH_TOKEN || process.env.GITHUB_TOKEN || "").trim();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

export async function fetchLatestRelease(force = false): Promise<LatestRelease> {
  if (!force && cached && Date.now() - cached.at < CACHE_MS) return cached.release;
  const res = await fetch(APP_LATEST_API, { headers: githubHeaders() });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`GitHub releases ${res.status}${t ? `: ${t.slice(0, 120)}` : ""}`);
  }
  const parsed = parseGithubRelease(await res.json());
  if (!parsed) throw new Error("GitHub latest release had no tag");
  cached = { at: Date.now(), release: parsed };
  return parsed;
}

export async function checkAppUpdate(opts?: {
  platform?: string;
  portable?: boolean;
  channel?: UpdateChannel;
  force?: boolean;
}): Promise<AppUpdateView> {
  const current = currentAppVersion();
  const channel = opts?.channel || preferChannel(opts?.platform, opts?.portable);
  try {
    const latest = await fetchLatestRelease(Boolean(opts?.force));
    const asset = pickAsset(latest.assets, channel);
    const newer = isNewerRelease(latest.version, current);
    return {
      current,
      latest: latest.version,
      newer,
      tag: latest.tag,
      name: latest.name,
      notes: latest.notes,
      htmlUrl: latest.htmlUrl,
      publishedAt: latest.publishedAt,
      asset,
      assets: latest.assets,
      channel,
      error: null,
    };
  } catch (e) {
    return {
      current,
      latest: null,
      newer: false,
      tag: null,
      name: null,
      notes: "",
      htmlUrl: APP_RELEASES_URL,
      publishedAt: null,
      asset: null,
      assets: [],
      channel,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
