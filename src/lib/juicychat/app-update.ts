/**
 * Browser-safe update helpers. No node: imports.
 * GitHub Releases is the feed. electron-updater applies NSIS + AppImage.
 */

export const APP_REPO_OWNER = "rafaelwv-glitch";
export const APP_REPO_NAME = "juicy-creator-os-share";
export const APP_RELEASES_URL = `https://github.com/${APP_REPO_OWNER}/${APP_REPO_NAME}/releases`;
export const APP_LATEST_API = `https://api.github.com/repos/${APP_REPO_OWNER}/${APP_REPO_NAME}/releases/latest`;

export type UpdateChannel = "nsis" | "portable" | "zip" | "appimage" | "targz" | "src" | "other";

export type ReleaseAsset = {
  name: string;
  url: string;
  size: number;
  channel: UpdateChannel;
};

export type LatestRelease = {
  tag: string;
  version: string;
  name: string;
  notes: string;
  htmlUrl: string;
  publishedAt: string | null;
  assets: ReleaseAsset[];
};

export function stripVersion(raw: string): string {
  return String(raw || "")
    .trim()
    .replace(/^v/i, "")
    .split("+")[0]!
    .split("-")[0]!;
}

export function parseSemver(raw: string): [number, number, number] | null {
  const s = stripVersion(raw);
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(s);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

export function cmpSemver(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa && !pb) return 0;
  if (!pa) return -1;
  if (!pb) return 1;
  for (let i = 0; i < 3; i++) {
    if (pa[i]! !== pb[i]!) return pa[i]! - pb[i]!;
  }
  return 0;
}

export function isNewerRelease(latest: string, current: string): boolean {
  return cmpSemver(latest, current) > 0;
}

export function classifyAsset(name: string): UpdateChannel {
  const n = String(name || "").toLowerCase();
  if (n.includes("setup") && n.endsWith(".exe")) return "nsis";
  if (n.includes("portable") && n.endsWith(".exe")) return "portable";
  if (n.endsWith(".exe")) return "nsis";
  if (n.endsWith(".appimage")) return "appimage";
  if (n.includes("local-src") || n.includes("src.tar")) return "src";
  if (n.endsWith(".tar.gz") || n.endsWith(".tgz")) return "targz";
  if (n.endsWith(".zip")) return "zip";
  return "other";
}

export function preferChannel(platform?: string, portable?: boolean): UpdateChannel {
  const p = (platform || (typeof navigator !== "undefined" ? navigator.platform : "")).toLowerCase();
  if (portable) return p.includes("win") ? "portable" : "appimage";
  if (p.includes("win")) return "nsis";
  if (p.includes("linux") || p.includes("x11")) return "appimage";
  if (p.includes("mac")) return "zip";
  return "appimage";
}

export function pickAsset(
  assets: ReleaseAsset[],
  channel: UpdateChannel,
): ReleaseAsset | null {
  const order: UpdateChannel[] =
    channel === "nsis"
      ? ["nsis", "portable", "zip"]
      : channel === "portable"
        ? ["portable", "nsis", "zip"]
        : channel === "appimage"
          ? ["appimage", "targz", "src"]
          : channel === "targz"
            ? ["targz", "appimage", "src"]
            : channel === "zip"
              ? ["zip", "nsis", "portable"]
              : [channel, "src"];
  for (const c of order) {
    const hit = assets.find((a) => a.channel === c);
    if (hit) return hit;
  }
  return assets[0] || null;
}

export function parseGithubRelease(raw: unknown): LatestRelease | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const tag = String(o.tag_name || o.tag || "").trim();
  if (!tag) return null;
  const assetsIn = Array.isArray(o.assets) ? o.assets : [];
  const assets: ReleaseAsset[] = [];
  for (const a of assetsIn) {
    if (!a || typeof a !== "object") continue;
    const row = a as Record<string, unknown>;
    const name = String(row.name || "");
    const url = String(row.browser_download_url || row.url || "");
    if (!name || !url) continue;
    assets.push({
      name,
      url,
      size: Number(row.size) || 0,
      channel: classifyAsset(name),
    });
  }
  return {
    tag,
    version: stripVersion(tag),
    name: String(o.name || tag),
    notes: String(o.body || "").slice(0, 4000),
    htmlUrl: String(o.html_url || APP_RELEASES_URL),
    publishedAt: typeof o.published_at === "string" ? o.published_at : null,
    assets,
  };
}
