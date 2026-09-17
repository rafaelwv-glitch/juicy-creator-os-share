import { createFileRoute } from "@tanstack/react-router";
import { dbSource, localPostgres, pglitePersistent } from "@/lib/db";
import { authConfigured } from "@/lib/auth/server";
import { countAuthUsers } from "@/lib/auth/auth-durable";
import { jsonResponse } from "@/lib/juicychat/http";
import { pingDb } from "@/lib/juicychat/relational";

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async () => {
        const [users, ping] = await Promise.all([countAuthUsers(), pingDb()]);
        return jsonResponse({
          ok: ping.ok,
          db: dbSource,
          databaseUrl: Boolean(process.env.DATABASE_URL?.trim()),
          latencyMs: ping.latencyMs,
          schema: ping.schema === true,
          schemaSolid: ping.schemaSolid === true,
          error: ping.error,
          grokAuth: authConfigured,
          grokClient: process.env.GROK_AUTH_CLIENT_ID?.trim()
            ? "app"
            : process.env.VERCEL_ENV === "production"
              ? "preview-blocked"
              : "preview",
          authUsers: users,
          durable: (dbSource === "neon" && ping.ok) || (pglitePersistent && ping.ok),
          local: localPostgres || pglitePersistent,
        });
      },
    },
  },
});
