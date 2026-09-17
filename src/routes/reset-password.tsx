import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Loader2, Lock } from "lucide-react";
import { authClient } from "@/lib/auth/client";

export const Route = createFileRoute("/reset-password")({ component: ResetPassword });

function ResetPassword() {
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    try {
      const q = new URLSearchParams(window.location.search);
      setToken(q.get("token") || "");
      if (q.get("error") === "INVALID_TOKEN") setErr("This reset link is invalid or expired.");
    } catch {
      /* */
    }
  }, []);

  const onSubmit = async () => {
    setErr(null);
    if (!token) {
      setErr("Missing reset token. Request a new link from the login page.");
      return;
    }
    if (password.length < 8) {
      setErr("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setErr("The two passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      const { error } = await authClient.resetPassword({ newPassword: password, token });
      if (error) throw new Error(error.message || "Could not reset password");
      setDone(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="grid min-h-[calc(100dvh-var(--grok-banner-h,0px))] place-items-center p-6">
      <div className="w-full max-w-md space-y-5 rounded-2xl border border-border bg-surface p-6 shadow-xl">
        <div className="space-y-1">
          <div className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-0.5 text-[11px] font-medium text-primary">
            <Lock className="size-3" />
            Password reset
          </div>
          <h1 className="font-[Syne] text-xl font-extrabold text-fg">Set a new password</h1>
          <p className="text-sm text-muted">This link works once, for one hour.</p>
        </div>
        {done ? (
          <div className="space-y-3">
            <p className="text-sm text-success">Password updated. Sign in on this phone with the new password.</p>
            <Link
              to="/login"
              className="block rounded-xl bg-primary px-4 py-2.5 text-center text-sm font-semibold text-primary-fg"
            >
              Go to sign in
            </Link>
          </div>
        ) : (
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              void onSubmit();
            }}
          >
            <input
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              placeholder="New password (8+ chars)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-11 w-full rounded-xl border border-border bg-bg px-3 text-sm"
            />
            <input
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              placeholder="Confirm new password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="h-11 w-full rounded-xl border border-border bg-bg px-3 text-sm"
            />
            {err ? <p className="text-xs text-danger">{err}</p> : null}
            <button
              type="submit"
              disabled={busy}
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-fg disabled:opacity-55"
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}
              Save password
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
