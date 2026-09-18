import { useState } from "react";
import { KeyRound, Loader2, Mail } from "lucide-react";
import {
  loginWithCookie,
  loginWithMagicLink,
  loginWithPassword,
  logoutJuicy,
  requestMagicLink,
} from "@/lib/juicychat/actions";
import { humanizeConnectError } from "@/lib/juicychat/format";

type Auth = {
  authenticated?: boolean;
  user?: { userName?: string; userId?: string } | null;
  email?: string;
  userNo?: string;
};

export function ConnectSourcePanel({
  auth,
  onChange,
  onConnected,
}: {
  auth: Auth | null;
  onChange: () => Promise<unknown>;
  onConnected?: () => Promise<unknown>;
}) {
  const [open, setOpen] = useState(!auth?.authenticated);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [ok, setOk] = useState<boolean | null>(null);
  const [email, setEmail] = useState(auth?.email || "");
  const [magic, setMagic] = useState("");
  const [userNo, setUserNo] = useState(auth?.userNo || "");
  const [password, setPassword] = useState("");
  const [cookie, setCookie] = useState("");

  const run = async (fn: () => Promise<void>, success: string, pull = false) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      if (pull && onConnected) await onConnected();
      else await onChange();
      setMsg(success);
      setOk(true);
    } catch (e) {
      setMsg(humanizeConnectError(e));
      setOk(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-xl border border-border bg-surface/80 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className={`inline-block size-2 rounded-full ${auth?.authenticated ? "bg-success" : "bg-danger"}`}
          />
          <h2 className="text-sm font-semibold">JuicyChat source</h2>
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-[11px] font-semibold"
        >
          <KeyRound className="size-3" />
          {auth?.authenticated ? "Manage" : "Connect once"}
        </button>
      </div>
      <p className="mt-1 text-xs text-muted">
        {auth?.authenticated
          ? `Cloud scrapes as @${auth.user?.userName || auth.user?.userId || "saved"}. This is a data source, not a second app login.`
          : "Connect JuicyChat once on this dashboard. Android never logs into JuicyChat — Vercel holds the session."}
      </p>
      {open ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <label className="text-[11px] text-muted">Magic link</label>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-10 w-full rounded-xl border border-border bg-bg px-3 text-sm"
              placeholder="you@email.com"
            />
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const r = await requestMagicLink({ data: { email } });
                  if (!r.ok) throw new Error(r.message);
                }, "Magic link sent")
              }
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-xs font-semibold"
            >
              {busy ? <Loader2 className="size-3 animate-spin" /> : <Mail className="size-3" />}
              Send link
            </button>
            <input
              value={magic}
              onChange={(e) => setMagic(e.target.value)}
              className="h-10 w-full rounded-xl border border-border bg-bg px-3 text-sm"
              placeholder="Paste sign-in link"
            />
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const r = await loginWithMagicLink({ data: { link: magic, email } });
                  if (!r.ok) throw new Error(r.message);
                }, "JuicyChat connected — pulling lounge", true)
              }
              className="h-9 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-fg"
            >
              Connect link
            </button>
          </div>
          <div className="space-y-2">
            <label className="text-[11px] text-muted">Password</label>
            <input
              value={userNo}
              onChange={(e) => setUserNo(e.target.value)}
              className="h-10 w-full rounded-xl border border-border bg-bg px-3 text-sm"
              placeholder="User no"
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-10 w-full rounded-xl border border-border bg-bg px-3 text-sm"
              placeholder="Password"
            />
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const r = await loginWithPassword({ data: { userNo, password, email } });
                  if (!r.ok) throw new Error(r.message);
                }, "JuicyChat connected — pulling lounge", true)
              }
              className="h-9 rounded-lg border border-border px-3 text-xs font-semibold"
            >
              Connect password
            </button>
            <input
              value={cookie}
              onChange={(e) => setCookie(e.target.value)}
              className="h-10 w-full rounded-xl border border-border bg-bg px-3 text-sm"
              placeholder="Cookie import (optional)"
            />
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const r = await loginWithCookie({ data: { cookie, email } });
                  if (!r.ok) throw new Error(r.message);
                }, "Cookie saved — pulling lounge", true)
              }
              className="h-9 rounded-lg border border-border px-3 text-xs font-semibold"
            >
              Import cookie
            </button>
            {auth?.authenticated ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void run(async () => void (await logoutJuicy()), "Source disconnected")}
                className="h-9 rounded-lg border border-danger/40 px-3 text-xs font-semibold text-danger"
              >
                Disconnect source
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
      {msg ? <p className={`mt-2 text-xs ${ok ? "text-success" : "text-danger"}`}>{msg}</p> : null}
    </section>
  );
}
