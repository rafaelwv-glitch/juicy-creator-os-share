import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "./middleware";

export const setSignedInPassword = createServerFn({ method: "POST" })
  .validator((input: { newPassword: string; currentPassword?: string }) => input)
  .middleware([authMiddleware])
  .handler(async ({ data }) => {
    const { getRequest } = await import("@tanstack/react-start/server");
    const { auth } = await import("./server");
    const { getSessionUser } = await import("./verify.server");
    const { clearPendingReset, loadPendingReset } = await import("./password-reset-store");
    const newPassword = String(data.newPassword || "");
    if (newPassword.length < 8) throw new Error("Password must be at least 8 characters");
    const headers = getRequest().headers;
    const current = String(data.currentPassword || "");
    if (current) {
      try {
        await auth.api.changePassword({
          body: {
            newPassword,
            currentPassword: current,
            revokeOtherSessions: false,
          },
          headers,
        });
        return { ok: true, mode: "changed" as const };
      } catch (e) {
        throw new Error(e instanceof Error ? e.message : "Current password is wrong");
      }
    }
    const user = await getSessionUser();
    if (!user?.email) throw new Error("This account has no email");
    await auth.api.requestPasswordReset({
      body: { email: user.email, redirectTo: "/reset-password" },
      headers,
    });
    const pending = await loadPendingReset(user.email);
    if (!pending?.token) throw new Error("Could not issue a reset token");
    await auth.api.resetPassword({
      body: { newPassword, token: pending.token },
    });
    await clearPendingReset(user.email);
    return { ok: true, mode: "reset" as const };
  });

export const issuePasswordResetLink = createServerFn({ method: "POST" })
  .validator(() => ({}))
  .middleware([authMiddleware])
  .handler(async () => {
    const { getRequest } = await import("@tanstack/react-start/server");
    const { auth } = await import("./server");
    const { getSessionUser } = await import("./verify.server");
    const { loadPendingReset } = await import("./password-reset-store");
    const user = await getSessionUser();
    if (!user?.email) throw new Error("This account has no email");
    await auth.api.requestPasswordReset({
      body: { email: user.email, redirectTo: "/reset-password" },
      headers: getRequest().headers,
    });
    const pending = await loadPendingReset(user.email);
    if (!pending?.url) throw new Error("Could not issue a reset link");
    return { ok: true, url: pending.url, email: user.email };
  });
