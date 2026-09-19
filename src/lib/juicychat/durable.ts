/**
 * Isomorphic middleware: hydrate THIS account's lounge files around a server fn.
 * Forwards the live-preview bearer (partitioned iframe cookies can't carry the
 * session) and the Android companion device token.
 *
 * Shareable clone: app OAuth is off (`VITE_AUTH_ENABLED` ≠ true). Without a
 * session or device token, fall back to a per-browser store id so visitors do
 * not share `dev-user`. File PGLite is the durable warehouse.
 */
import { createMiddleware } from "@tanstack/react-start";

export const durableMiddleware = createMiddleware({ type: "function" })
  .client(async ({ next }) => {
    const { getBearerToken } = await import("@/lib/auth/client");
    const { captureDeviceFromLocation, getDeviceToken } = await import("@/lib/auth/device-client");
    const { getBrowserStoreId } = await import("./browser-store");
    const { isBrowserPulling, scheduleRememberBrowserCache } = await import("./browser-flag");
    captureDeviceFromLocation();
    const result = await next({
      sendContext: {
        bearerToken: getBearerToken() ?? undefined,
        deviceToken: getDeviceToken() ?? undefined,
        browserStoreId: getBrowserStoreId() ?? undefined,
      },
    });
    if (!isBrowserPulling()) scheduleRememberBrowserCache();
    return result;
  })
  .server(async ({ next, context }) => {
    const { getSessionUser, UnauthorizedError, DEV_USER_ID, authConfigured } = await import(
      "@/lib/auth/verify.server"
    );
    const { getRequest } = await import("@tanstack/react-start/server");
    const { userIdFromDeviceToken, DEVICE_HEADER } = await import("./identity");
    const { sanitizeBrowserStoreId, loungeUserIdFromBrowser, BROWSER_HEADER } = await import(
      "./browser-store"
    );
    const ctx = context as { bearerToken?: string; deviceToken?: string; browserStoreId?: string };
    const sessionId = (await getSessionUser(ctx.bearerToken))?.id ?? null;
    const req = getRequest();
    const header = req?.headers.get(DEVICE_HEADER) || req?.headers.get("X-Lounge-Device") || "";
    let bodyToken = "";
    let bodyBrowser = "";
    try {
      const copy = req?.clone();
      const text = copy ? await copy.text() : "";
      if (text) {
        const parsed = JSON.parse(text) as { deviceToken?: string; browserStoreId?: string };
        if (typeof parsed?.deviceToken === "string") bodyToken = parsed.deviceToken;
        if (typeof parsed?.browserStoreId === "string") bodyBrowser = parsed.browserStoreId;
      }
    } catch {
      /* not JSON */
    }
    const deviceId = await userIdFromDeviceToken(ctx.deviceToken || header || bodyToken);
    const browserId = sanitizeBrowserStoreId(
      ctx.browserStoreId || req?.headers.get(BROWSER_HEADER) || bodyBrowser,
    );
    const browserUser = browserId ? loungeUserIdFromBrowser(browserId) : null;
    let userId = sessionId || deviceId || browserUser;
    if (sessionId && deviceId && sessionId !== deviceId) {
      const { pickUserWithData } = await import("./user-kv");
      userId = (await pickUserWithData([sessionId, deviceId])) || sessionId;
    }
    if (!userId && !authConfigured) userId = DEV_USER_ID;
    if (!userId) throw new UnauthorizedError();
    const { hydrateLoungeVault, applyLoungeVaultCookie } = await import("./lounge-vault");
    hydrateLoungeVault(req);
    const { withUserStore } = await import("./user-kv");
    return withUserStore(userId, async () => {
      const result = await next();
      await applyLoungeVaultCookie();
      return result;
    });
  });
