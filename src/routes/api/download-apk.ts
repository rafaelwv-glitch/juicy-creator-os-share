import { createFileRoute } from "@tanstack/react-router";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";

const APK_NAME = "juicy-lounge-debug.apk";
const MIME = "application/vnd.android.package-archive";

/**
 * Streams the debug APK with correct Android MIME type.
 * Raw static .apk files can be sniffed as ZIP by browsers — this route forces
 * the package-archive type. Falls back to the static public URL on serverless
 * when the binary isn't readable from the function FS.
 */
export const Route = createFileRoute("/api/download-apk")({
  server: {
    handlers: {
      GET: async () => {
        const cwd = process.cwd();
        const candidates = [
          join(cwd, "public/downloads", APK_NAME),
          join(cwd, "downloads", APK_NAME),
          join(cwd, "artifacts", APK_NAME),
          join(cwd, "android/app/build/outputs/apk/debug/app-debug.apk"),
          join(cwd, ".vercel/output/static/downloads", APK_NAME),
          // Nitro / Vercel function bundle layouts
          join(cwd, "public", "downloads", APK_NAME),
          join("/var/task/public/downloads", APK_NAME),
          join("/var/task/.vercel/output/static/downloads", APK_NAME),
        ];

        for (const path of candidates) {
          try {
            await access(path);
            const body = await readFile(path);
            const bytes = new Uint8Array(body);
            return new Response(bytes, {
              status: 200,
              headers: {
                "content-type": MIME,
                "content-length": String(bytes.byteLength),
                "content-disposition": `attachment; filename="${APK_NAME}"; filename*=UTF-8''${APK_NAME}`,
                "cache-control": "public, max-age=300",
                "x-content-type-options": "nosniff",
              },
            });
          } catch {
            /* try next */
          }
        }

        // Static asset is deployed with the site — redirect so the download still works
        // even when the serverless function cannot read the APK from disk.
        return new Response(null, {
          status: 302,
          headers: {
            location: `/downloads/${APK_NAME}?download=1`,
            "cache-control": "no-store",
          },
        });
      },
    },
  },
});
