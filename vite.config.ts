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

// Local-only: `0.0.0.0:8080` is the laptop / preview contract.
// Nitro is gated to `build` so `vite dev` stays a single port.
// Production build uses the Node server preset — never Vercel.
export default defineConfig(({ command }) => ({
  server: {
    host: "0.0.0.0",
    port: 8080,
    strictPort: true,
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
        "**/.output/**",
      ],
    },
  },
  resolve: { tsconfigPaths: true },
  plugins: [
    pgliteBootstrapPlugin(),
    apkMimePlugin(),
    authPopupPlugin(),
    tailwindcss(),
    tanstackStart(),
    ...(command === "build"
      ? [
          nitro({
            preset: "node-server",
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
