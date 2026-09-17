import type { Plugin } from "vite";
import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";

/**
 * Finish PGLite bootstrap during dev-server setup (before traffic). Vite awaits
 * async `configureServer` hooks. Production: `src/lib/db` kicks `ensureDbReady`
 * on import.
 */
function pgliteBootstrapPlugin(): Plugin {
  return {
    name: "app-builder:pglite-bootstrap",
    apply: "serve",
    async configureServer(server) {
      try {
        const mod = (await server.ssrLoadModule("/src/lib/db.ts")) as {
          ensureDbReady?: () => Promise<void>;
        };
        if (typeof mod.ensureDbReady === "function") {
          await mod.ensureDbReady();
        }
      } catch (err) {
        console.error("[app-builder] DB bootstrap failed:", err);
        throw err;
      }
    },
  };
}

/**
 * Live-preview OAuth popup — handled HERE so the agent never has to create a
 * `/auth/popup` route (and cannot break it by scaffolding a React page that
 * paints the full app shell in the popup).
 *
 * `signIn` (client.ts) opens `/auth/popup?providerId=…` in a top-level window.
 * This middleware runs before TanStack Start, calls `handleAuthPopupRequest`,
 * and returns the 302 / completion HTML. Deployed apps do not use the popup
 * (full-page OAuth redirect), so `apply: "serve"` is enough.
 */

/**
 * Serve .apk with Android package MIME type.
 * Without this, Vite leaves Content-Type empty; clients sniff ZIP magic and
 * save the file as .zip (unusable for install).
 */
function apkMimePlugin(): Plugin {
  return {
    name: "app-builder:apk-mime",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const raw = req.url ?? "";
        const pathOnly = raw.split("?", 1)[0] ?? "";
        if (!pathOnly.endsWith(".apk") && pathOnly !== "/api/download-apk") {
          next();
          return;
        }
        // Patch writeHead / setHeader so static middleware can't wipe MIME
        const origSetHeader = res.setHeader.bind(res);
        res.setHeader = ((name: string, value: any) => {
          if (String(name).toLowerCase() === "content-type" && pathOnly.endsWith(".apk")) {
            return origSetHeader("Content-Type", "application/vnd.android.package-archive");
          }
          return origSetHeader(name, value);
        }) as typeof res.setHeader;

        if (pathOnly.endsWith(".apk")) {
          res.setHeader(
            "Content-Disposition",
            'attachment; filename="juicy-lounge-debug.apk"',
          );
          res.setHeader("X-Content-Type-Options", "nosniff");
        }
        next();
      });
    },
  };
}

/**
 * Resolve the public origin the browser actually used (live preview is HTTPS on
 * `*.grok-sandbox.com`, proxied to this HTTP server). Without this, OAuth
 * `redirect_uri` becomes `http://localhost:8080/...` and Google login dies
 * after the account picker.
 */
function publicOriginFromReq(req: {
  headers: Record<string, string | string[] | undefined>;
  socket?: { encrypted?: boolean };
}): { host: string; proto: string } {
  const first = (v: string | string[] | undefined) =>
    String(Array.isArray(v) ? v[0] : (v ?? ""))
      .split(",")[0]
      .trim();
  const host =
    first(req.headers["x-forwarded-host"]) ||
    first(req.headers.host) ||
    "localhost:8080";
  const hostName = host.replace(/:\d+$/, "").replace(/^\[(.*)\]$/, "$1");
  const xfProto = first(req.headers["x-forwarded-proto"]).toLowerCase();
  const proto =
    xfProto === "https" || xfProto === "http"
      ? xfProto
      : hostName.endsWith(".grok-sandbox.com") ||
          hostName.endsWith(".grok.me") ||
          hostName.endsWith(".vercel.app") ||
          Boolean(req.socket?.encrypted)
        ? "https"
        : "http";
  return { host, proto };
}

function authPopupPlugin(): Plugin {
  return {
    name: "app-builder:auth-popup",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        try {
          const rawUrl = req.url ?? "";
          const pathOnly = rawUrl.split("?", 1)[0] ?? "";
          const method = (req.method ?? "GET").toUpperCase();

          if (pathOnly.startsWith("/api/auth") || pathOnly.startsWith("/auth/popup")) {
            console.log(
              "[auth]",
              method,
              pathOnly,
              "host=",
              req.headers.host,
              "xfh=",
              req.headers["x-forwarded-host"],
              "origin=",
              req.headers.origin,
            );
          }

          if (pathOnly === "/auth/popup/handoff") {
            const chunks: Buffer[] = [];
            if (method === "POST") {
              await new Promise<void>((resolve) => {
                req.on("data", (c) => chunks.push(c as Buffer));
                req.on("end", () => resolve());
              });
            }
            const { host, proto } = publicOriginFromReq(req);
            const headers = new Headers();
            for (const [key, value] of Object.entries(req.headers)) {
              if (value === undefined) continue;
              if (Array.isArray(value)) for (const v of value) headers.append(key, v);
              else headers.set(key, value);
            }
            const request = new Request(`${proto}://${host}${rawUrl}`, {
              method,
              headers,
              body: method === "POST" ? Buffer.concat(chunks) : undefined,
              // @ts-expect-error Node fetch requires duplex when a body is present
              duplex: method === "POST" ? "half" : undefined,
            });
            const mod = (await server.ssrLoadModule("/src/lib/auth/popup.server.ts")) as {
              handlePopupHandoffRequest: (req: Request) => Promise<Response>;
            };
            const response = await mod.handlePopupHandoffRequest(request);
            res.statusCode = response.status;
            response.headers.forEach((value, key) => res.setHeader(key, value));
            res.end(Buffer.from(await response.arrayBuffer()));
            return;
          }

          if (pathOnly !== "/auth/popup") {
            next();
            return;
          }
          if (method !== "GET") {
            res.statusCode = 405;
            res.setHeader("content-type", "text/plain; charset=utf-8");
            res.end("Method Not Allowed");
            return;
          }

          const { host, proto } = publicOriginFromReq(req);
          const requestHeaders = new Headers();
          for (const [key, value] of Object.entries(req.headers)) {
            if (value === undefined) continue;
            if (Array.isArray(value)) {
              for (const v of value) requestHeaders.append(key, v);
            } else {
              requestHeaders.set(key, value);
            }
          }
          requestHeaders.set("host", host);
          requestHeaders.set("x-forwarded-host", host);
          requestHeaders.set("x-forwarded-proto", proto);

          const request = new Request(`${proto}://${host}${rawUrl}`, {
            method: "GET",
            headers: requestHeaders,
          });

          const mod = (await server.ssrLoadModule("/src/lib/auth/popup.server.ts")) as {
            handleAuthPopupRequest: (req: Request) => Promise<Response>;
          };
          const response = await mod.handleAuthPopupRequest(request);

          res.statusCode = response.status;
          const setCookies =
            typeof response.headers.getSetCookie === "function"
              ? response.headers.getSetCookie()
              : [];
          response.headers.forEach((value, key) => {
            if (key.toLowerCase() === "set-cookie") return;
            res.setHeader(key, value);
          });
          for (const cookie of setCookies) {
            res.appendHeader("set-cookie", cookie);
          }
          const body = Buffer.from(await response.arrayBuffer());
          res.end(body);
        } catch (err) {
          console.error("[app-builder] /auth/popup handler failed:", err);
          if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader("content-type", "text/plain; charset=utf-8");
            res.end("auth popup failed");
          }
        }
      });
    },
  };
}

// `0.0.0.0:8080` is the live-preview contract — don't change host/port.
// Keep `nitro` gated to `build` (the Vercel deploy target): enabled in dev it
// opens a second dev-server port, which breaks the single-port preview.
// The dev server starts once `src/router.tsx` and `src/routes/` exist — see
// AGENTS.md § "First scaffold".
export default defineConfig(({ command }) => ({
  server: {
    host: "0.0.0.0",
    port: 8080,
    strictPort: true,
    // Live preview proxy sends Host: <id>.grok-sandbox.com. Vite 8 blocks
    // unknown hosts by default — that 403'd the Google OAuth popup (step 1).
    allowedHosts: true,
    watch: {
      ignored: [
        "**/.jdk-21/**",
        "**/.android-sdk/**",
        "**/android/**",
        "**/android-web/**",
        "**/juicychat-retrieved/**",
        "**/artifacts/**",
        "**/node_modules/**",
        "**/.vercel/**",
      ],
    },
  },
  resolve: { tsconfigPaths: true },
  plugins: [
    pgliteBootstrapPlugin(),
    // Before tanstackStart so /auth/popup never falls through to the SPA.
    apkMimePlugin(),
    authPopupPlugin(),
    tailwindcss(),
    tanstackStart(),
    ...(command === "build"
      ? [
          nitro({
            preset: "vercel",
            // Scan a dedicated dir so /auth/popup exists on Vercel. Do NOT
            // set serverDir to ./server — that also loads grok-pwa.ts, whose
            // `?raw` HTML import fails the Nitro build.
            serverDir: "./server-auth",
            routeRules: {
              "/downloads/**/*.apk": {
                headers: {
                  "Content-Type": "application/vnd.android.package-archive",
                  "Content-Disposition": 'attachment; filename="juicy-lounge-debug.apk"',
                  "X-Content-Type-Options": "nosniff",
                },
              },
              "/downloads/juicy-lounge-debug.apk": {
                headers: {
                  "Content-Type": "application/vnd.android.package-archive",
                  "Content-Disposition": 'attachment; filename="juicy-lounge-debug.apk"',
                  "X-Content-Type-Options": "nosniff",
                },
              },
            },
          }),
        ]
      : []),
    viteReact(),
  ],
}));
