#!/usr/bin/env node
/**
 * Semver + GitHub asset picker. No live GitHub call required.
 */
import { createServer } from "vite";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  const vite = await createServer({
    root,
    configFile: false,
    cacheDir: join(root, "node_modules/.vite-smoke-update"),
    server: { middlewareMode: true },
    appType: "custom",
    logLevel: "error",
    resolve: { alias: { "@": join(root, "src") } },
  });
  try {
    const mod = await vite.ssrLoadModule("/src/lib/juicychat/app-update.ts");
    assert(mod.isNewerRelease("1.3.0", "1.2.0"), "1.3 > 1.2");
    assert(!mod.isNewerRelease("1.2.0", "1.2.0"), "same is not newer");
    assert(!mod.isNewerRelease("1.1.9", "1.2.0"), "older is not newer");
    assert(mod.stripVersion("v1.3.0") === "1.3.0", "strip v");
    const assets = [
      { name: "Juicy-Creator-OS-1.3.0-win-x64-setup.exe", url: "https://ex/setup.exe", size: 10, channel: mod.classifyAsset("Juicy-Creator-OS-1.3.0-win-x64-setup.exe") },
      { name: "Juicy-Creator-OS-1.3.0-win-x64-portable.exe", url: "https://ex/p.exe", size: 10, channel: mod.classifyAsset("Juicy-Creator-OS-1.3.0-win-x64-portable.exe") },
      { name: "Juicy-Creator-OS-1.3.0-linux-x86_64.AppImage", url: "https://ex/a.AppImage", size: 10, channel: mod.classifyAsset("Juicy-Creator-OS-1.3.0-linux-x86_64.AppImage") },
      { name: "Juicy-Creator-OS-1.3.0-linux-x64.tar.gz", url: "https://ex/t.tar.gz", size: 10, channel: mod.classifyAsset("Juicy-Creator-OS-1.3.0-linux-x64.tar.gz") },
    ];
    assert(assets[0].channel === "nsis", "setup is nsis");
    assert(assets[1].channel === "portable", "portable");
    assert(assets[2].channel === "appimage", "appimage");
    assert(mod.pickAsset(assets, "nsis")?.name.includes("setup"), "win prefers setup");
    assert(mod.pickAsset(assets, "appimage")?.name.includes("AppImage"), "linux prefers AppImage");
    const parsed = mod.parseGithubRelease({
      tag_name: "v1.3.0",
      name: "v1.3.0",
      html_url: "https://github.com/rafaelwv-glitch/juicy-creator-os-share/releases/tag/v1.3.0",
      assets: assets.map((a) => ({ name: a.name, browser_download_url: a.url, size: a.size })),
    });
    assert(parsed?.version === "1.3.0", "parse version");
    assert(parsed.assets.length === 4, "parse assets");
    console.log("SMOKE APP UPDATE OK", { nsis: mod.pickAsset(assets, "nsis").name });
    await vite.close().catch(() => {});
  } catch (e) {
    await vite.close().catch(() => {});
    throw e;
  }
}

main().catch((e) => {
  console.error("SMOKE APP UPDATE FAIL", e);
  process.exit(1);
});
