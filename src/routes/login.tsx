import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Loader2, Lock, Smartphone } from "lucide-react";
import {
  GROK_PROVIDERS,
  authClient,
  authEnabled,
  captureSessionToken,
  getBearerToken,
  signIn,
} from "@/lib/auth/client";
import { SignedIn, SignedOut, UserButton } from "@/lib/auth/gates";
import { PublicDbBadge } from "@/components/db-status";

export const Route = createFileRoute("/login")({ component: Login });

function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"in" | "up" | "forgot">("in");
  const [busy, setBusy] = useState(false);
  const [oauthBusy, setOauthBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [oauthOff, setOauthOff] = useState(false);
  const [ephemeral, setEphemeral] = useState(false);

  useEffect(() => {
    void fetch("/api/health", { cache: "no-store" })
      .then((r) => r.json())
      .then((h: { db?: string; grokClient?: string; databaseUrl?: boolean }) => {
        if (h.db === "pglite" || h.databaseUrl === false) setEphemeral(true);
        if (h.grokClient === "preview-blocked" || h.grokClient === "preview") setOauthOff(true);
      })
      .catch(() => undefined);
  }, []);

  const goDashboard = () => {
    window.location.assign("/");
  };

  const onOAuth = (providerId: string) => {
    setErr(null);
    setOauthBusy(providerId);
    // signIn opens the Google pop-up (or full-page redirects) and navigates
    // home itself on success. Do NOT assign "/" here — that was wiping the
    // Google navigation after ~2s on Vercel.
    void signIn(providerId, { callbackURL: "/", errorCallbackURL: "/login" }).catch((e) => {
      const raw = e instanceof Error ? e.message : String(e);
      setErr(
        /popup|pop-up|window was closed/i.test(raw)
          ? "Pop-up blocked or closed. Allow pop-ups for this site, then try Google / X again."
          : raw || "Google / X sign-in failed. Finish in the pop-up, or use email below.",
      );
      setOauthBusy(null);
    });
  };

  const onEmail = async () => {
    setBusy(true);
    setErr(null);
    setInfo(null);
    const emailNorm = email.trim().toLowerCase();
    try {
      if (mode === "forgot") {
        const { error } = await authClient.requestPasswordReset({
          email: emailNorm,
          redirectTo: "/reset-password",
        });
        if (error) throw new Error(error.message || "Could not start password reset");
        setMode("in");
        setInfo(
          "If that email has an account, a reset was issued. Signed in on desktop? Open Lounge password on the dashboard — that always works without email.",
        );
        return;
      }
      if (mode === "up") {
        const { data, error } = await authClient.signUp.email({
          email: emailNorm,
          password,
          name: emailNorm.split("@")[0] || "Creator",
        });
        if (error) {
          const msg = error.message || "Could not create the account";
          if (/already exists|already registered|USER_ALREADY/i.test(msg)) {
            throw new Error("That email already has an account — switch to Sign in.");
          }
          if (/invalid origin/i.test(msg)) {
            throw new Error(`This preview origin is blocked for accounts (${window.location.origin}).`);
          }
          throw new Error(msg);
        }
        if (!getBearerToken()) {
          captureSessionToken((data as { token?: string } | null)?.token);
        }
      } else {
        const { data, error } = await authClient.signIn.email({ email: emailNorm, password });
        if (error) {
          const msg = error.message || "Email or password is wrong";
          if (/invalid origin/i.test(msg)) {
            throw new Error(`This preview origin is blocked for accounts (${window.location.origin}).`);
          }
          throw new Error(
            `${msg}. Use Forgot password, or set a new password from the desktop session (Lounge password).`,
          );
        }
        if (!getBearerToken()) {
          captureSessionToken((data as { token?: string } | null)?.token);
        }
      }
      if (!getBearerToken()) {
        throw new Error("Account created, but the session did not stick. Retry sign-in.");
      }
      goDashboard();
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
            Account-bound dashboard
          </div>
          <h1 className="font-[Syne] text-xl font-extrabold text-fg">Juicy Lounge</h1>
          <p className="text-sm text-muted">
            Sign in once. This is the only account. Android pairs with a code — it never logs
            into JuicyChat. Scrapes and Grok reports run on Vercel.
          </p>
          <div className="pt-2">
            <PublicDbBadge />
          </div>
        </div>

        <SignedIn>
          <div className="space-y-3 rounded-xl border border-success/30 bg-success/10 p-3">
            <UserButton />
            <Link
              to="/"
              className="block rounded-lg bg-primary px-4 py-2.5 text-center text-sm font-semibold text-primary-fg"
            >
              Open dashboard
            </Link>
          </div>
        </SignedIn>

        <SignedOut>
          {!authEnabled ? (
            <div className="space-y-3 rounded-xl border border-border bg-bg/60 p-3 text-sm text-muted">
              <p>
                App accounts (Google / X / email) are <strong className="text-fg">off</strong> on
                this shareable deploy. That is intentional.
              </p>
              <p>
                Connect JuicyChat from the dashboard with a magic link, email code, or password —
                not this page.
              </p>
              <Link
                to="/"
                className="block rounded-lg bg-primary px-4 py-2.5 text-center text-sm font-semibold text-primary-fg"
              >
                Open dashboard
              </Link>
            </div>
          ) : (
            <>
              {oauthOff ? (
                <p className="rounded-xl border border-border bg-bg/60 px-3 py-2 text-[12px] text-muted">
                  Google / X is not available on this host (broker: Invalid redirect URI). Use
                  email below.
                </p>
              ) : (
              <div className="space-y-2">
                {GROK_PROVIDERS.map((p) => (
                  <button
                    key={p.providerId}
                    type="button"
                    disabled={Boolean(oauthBusy) || busy}
                    onClick={() => onOAuth(p.providerId)}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-bg px-4 py-2.5 text-sm font-semibold text-fg transition hover:border-border-strong disabled:opacity-55"
                  >
                    {oauthBusy === p.providerId ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : p.providerId === "grok-google" ? (
                      <GoogleMark />
                    ) : (
                      <XMark />
                    )}
                    Continue with {p.label}
                  </button>
                ))}
              </div>
              )}
              {ephemeral ? (
                <p className="text-[12px] text-warning">
                  Preview database only — this host has no Neon URL. Accounts reset when the
                  server restarts. Use file-backed PGLite (the default) on your laptop.
                </p>
              ) : null}
              {oauthBusy ? (
                <p className="text-xs text-primary">
                  A Google / X window should have opened. Keep it open until it closes itself —
                  this page waits here and will not bounce you back.
                </p>
              ) : null}
              {err ? <p className="text-xs text-danger">{err}</p> : null}
              {info ? <p className="text-xs text-success">{info}</p> : null}

              <div className="relative text-center text-[11px] uppercase tracking-wide text-faint">
                <span className="bg-surface px-2">or email</span>
              </div>

              <form
                className="space-y-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void onEmail();
                }}
              >
                <input
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="you@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-11 w-full rounded-xl border border-border bg-bg px-3 text-sm"
                />
                {mode !== "forgot" ? (
                  <input
                    type="password"
                    required
                    minLength={8}
                    autoComplete={mode === "up" ? "new-password" : "current-password"}
                    placeholder="Password (8+ chars)"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="h-11 w-full rounded-xl border border-border bg-bg px-3 text-sm"
                  />
                ) : null}
                <button
                  type="submit"
                  disabled={busy || Boolean(oauthBusy)}
                  className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-fg disabled:opacity-55"
                >
                  {busy ? <Loader2 className="size-4 animate-spin" /> : null}
                  {mode === "up" ? "Create account" : mode === "forgot" ? "Send reset link" : "Sign in"}
                </button>
              </form>
              <div className="flex flex-col gap-1">
                {mode === "in" ? (
                  <button
                    type="button"
                    className="w-full text-center text-xs text-muted hover:text-fg"
                    onClick={() => {
                      setMode("forgot");
                      setErr(null);
                    }}
                  >
                    Forgot password?
                  </button>
                ) : null}
                <button
                  type="button"
                  className="w-full text-center text-xs text-muted hover:text-fg"
                  onClick={() => {
                    setMode((m) => (m === "in" || m === "forgot" ? "up" : "in"));
                    setErr(null);
                  }}
                >
                  {mode === "up" ? "Have an account? Sign in" : "Need an account? Create one"}
                </button>
              </div>
            </>
          )}
        </SignedOut>

        <ol className="space-y-2 rounded-xl border border-border bg-bg/40 p-3 text-[11px] text-muted">
          <li>
            <span className="font-semibold text-fg">1. Lounge login</span> — Google, X, or email.
          </li>
          <li>
            <span className="font-semibold text-fg">2. Android companion</span> — pair the phone
            from the dashboard so JuicyChat credentials live on this account.
          </li>
        </ol>

        <p className="flex items-start gap-2 text-[11px] text-muted">
          <Smartphone className="mt-0.5 size-3.5 shrink-0" />
          JuicyChat session cookies are AES-GCM sealed in Postgres, keyed to this lounge user.
        </p>
      </div>
    </main>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M12 10.2v3.6h5.1c-.2 1.2-.9 2.3-1.9 3l3.1 2.4c1.8-1.7 2.9-4.1 2.9-7 0-.7-.1-1.3-.2-1.9H12z"
      />
      <path
        fill="#34A853"
        d="M6.6 13.7a6.9 6.9 0 0 1 0-3.4L3.3 7.8a10 10 0 0 0 0 8.4l3.3-2.5z"
      />
      <path
        fill="#4A90E2"
        d="M12 22c2.7 0 5-.9 6.7-2.4l-3.1-2.4c-.9.6-2 .9-3.6.9a6.9 6.9 0 0 1-6.5-4.4l-3.3 2.5A11.5 11.5 0 0 0 12 22z"
      />
      <path
        fill="#FBBC05"
        d="M12 5.9c1.5 0 2.8.5 3.8 1.5l2.8-2.8C16.9 2.9 14.7 2 12 2A11.5 11.5 0 0 0 5.5 5.4l3.3 2.5A6.9 6.9 0 0 1 12 5.9z"
      />
    </svg>
  );
}

function XMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-4 fill-current" aria-hidden="true">
      <path d="M18.2 2H21l-6.6 7.5L22 22h-6.2l-4.9-6.4L5.3 22H2.5l7-8L2 2h6.3l4.4 5.8L18.2 2zm-1.1 18h1.7L7 3.9H5.2L17.1 20z" />
    </svg>
  );
}
