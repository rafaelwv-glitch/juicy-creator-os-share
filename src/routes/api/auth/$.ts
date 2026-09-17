import { createFileRoute } from "@tanstack/react-router";
import { auth } from "@/lib/auth/server";
import { hydrateAuthFromDurable, persistAuthToDurable } from "@/lib/auth/auth-durable";
import { hydrateAuthFromVault, withAuthVault } from "@/lib/auth/auth-vault";

let durable: Promise<unknown> | null = null;
function ensureGithubHydrated() {
  durable ??= hydrateAuthFromDurable().catch((e) => {
    console.warn("[auth] github hydrate failed", e);
  });
  return durable;
}

async function handleAuth(request: Request): Promise<Response> {
  await ensureGithubHydrated();
  await hydrateAuthFromVault(request);
  const res = await auth.handler(request);
  try {
    void persistAuthToDurable();
  } catch {
    /* */
  }
  return withAuthVault(request, res);
}

export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: ({ request }) => handleAuth(request),
      POST: ({ request }) => handleAuth(request),
    },
  },
});
