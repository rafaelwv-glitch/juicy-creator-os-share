/**
 * Keeps dist/ as the self-contained Capacitor web app.
 * Does NOT overwrite app.js / index.html with a dead bootstrap page.
 */
import { writeFileSync, existsSync, cpSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const dist = join(root, "dist");
if (!existsSync(join(dist, "index.html")) || !existsSync(join(dist, "app.js"))) {
  console.error("[android] dist/index.html + app.js required (self-contained app)");
  process.exit(1);
}
if (existsSync(join(root, "public/icons"))) {
  cpSync(join(root, "public/icons"), join(dist, "icons"), { recursive: true });
}
if (existsSync(join(root, "public/manifest.webmanifest"))) {
  cpSync(join(root, "public/manifest.webmanifest"), join(dist, "manifest.webmanifest"));
}
for (const name of ["widget-refresh.html", "widget-refresh.js"]) {
  const src = join(root, "public", name);
  if (existsSync(src)) cpSync(src, join(dist, name));
}
if (existsSync(join(dist, "seed"))) {
  // already in dist
}
const cloudUrl =
  (process.env.CAP_SERVER_URL ||
    (process.env.VITE_PUBLIC_HOSTNAME
      ? `https://${process.env.VITE_PUBLIC_HOSTNAME}`
      : "https://juicy-creator-os.vercel.app")).replace(/\/$/, "");
const phoneUrl = cloudUrl.endsWith("/phone") ? cloudUrl : `${cloudUrl}/phone`;
const capJson = {
  appId: "ai.juicylounge.analytics",
  appName: "Juicy Lounge",
  webDir: "dist",
  android: { allowMixedContent: true, backgroundColor: "#0a0b14" },
  plugins: {
    CapacitorHttp: { enabled: true },
    SplashScreen: {
      launchShowDuration: 0,
      launchAutoHide: true,
      backgroundColor: "#0a0b14",
      showSpinner: false,
      splashFullScreen: false,
      splashImmersive: false,
    },
    StatusBar: { style: "DARK", backgroundColor: "#0a0b14" },
  },
  server: {
    url: phoneUrl,
    androidScheme: "https",
    allowNavigation: [
      "www.juicychat.ai",
      "juicychat.ai",
      "accounts.google.com",
      "oauth.yandex.com",
      "discord.com",
      "*.vercel.app",
      "juicy-creator-os.vercel.app",
    ],
  },
};
writeFileSync(join(root, "capacitor.config.json"), JSON.stringify(capJson, null, 2));

writeFileSync(
  join(dist, "cloud.json"),
  JSON.stringify({ url: cloudUrl, pullTimes: ["05:00", "23:55"], timezone: "Europe/Madrid" }, null, 2),
);
console.log("[android] self-contained dist ready (CapacitorHttp enabled, cloudUrl=" + (cloudUrl || "unset") + ")");
