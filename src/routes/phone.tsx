import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import {
  AlarmClock,
  CheckCircle2,
  Clock,
  KeyRound,
  Loader2,
  LogOut,
  Mail,
  RefreshCw,
  Rocket,
  ShieldAlert,
  Smartphone,
} from "lucide-react";
import { formatWhen } from "@/lib/juicychat/format";
import type { PublishQueue, PublishQueueRow, PublishResult } from "@/lib/juicychat/publish-bots";
import type { PhoneAuthResult, PhoneSessionPayload } from "@/lib/juicychat/phone-auth";
import {
  cancelNativeJob,
  getJuicyNative,
  isNativePhone,
  listNativeJobs,
  loadPhoneSession,
  persistPhoneSession,
  scheduleNativeJob,
  type NativePublishJob,
  type PhoneSession,
} from "@/lib/juicychat/phone-native";

export const Route = createFileRoute("/phone")({ component: PhonePublisher });

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function toLocalInput(ms: number) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function defaultFireMs() {
  const d = new Date();
  d.setSeconds(0, 0);
  d.setMinutes(0);
  d.setHours(d.getHours() + 1);
  return d.getTime();
}

async function phonePost<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as T;
  return json;
}

function PhonePublisher() {
  const [native, setNative] = useState(false);
  const [session, setSession] = useState<PhoneSession | null>(null);
  const [ready, setReady] = useState(false);
  const [canExact, setCanExact] = useState(true);

  useEffect(() => {
    const n = isNativePhone();
    setNative(n);
    const stored = loadPhoneSession();
    setSession(stored);
    if (n) {
      try {
        setCanExact(Boolean(getJuicyNative()?.canScheduleExactAlarms()));
      } catch {
        setCanExact(true);
      }
      try {
        getJuicyNative()?.requestBackgroundPermissions();
      } catch {
        /* */
      }
    }
    setReady(true);
  }, []);

  const applySession = useCallback((next: PhoneSession | null) => {
    persistPhoneSession(next);
    setSession(next);
  }, []);

  if (!ready) {
    return (
      <div className="grid min-h-[70dvh] place-items-center text-muted">
        <Loader2 className="size-5 animate-spin text-primary" />
      </div>
    );
  }

  return session?.cookie ? (
    <QueueScreen
      session={session}
      native={native}
      canExact={canExact}
      onLogout={() => applySession(null)}
      onSession={applySession}
      onExactRefresh={() => {
        try {
          setCanExact(Boolean(getJuicyNative()?.canScheduleExactAlarms()));
        } catch {
          /* */
        }
      }}
    />
  ) : (
    <LoginScreen native={native} onSession={applySession} />
  );
}

function LoginScreen({
  native,
  onSession,
}: {
  native: boolean;
  onSession: (s: PhoneSession) => void;
}) {
  const [tab, setTab] = useState<"password" | "magic" | "cookie">("password");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [ok, setOk] = useState<boolean | null>(null);
  const [email, setEmail] = useState("");
  const [userNo, setUserNo] = useState("");
  const [password, setPassword] = useState("");
  const [link, setLink] = useState("");
  const [cookie, setCookie] = useState("");

  const finish = (r: PhoneAuthResult) => {
    setOk(r.ok);
    setMsg(r.message);
    if (r.ok && r.session?.cookie) onSession(toPhoneSession(r.session));
  };

  useEffect(() => {
    window.__jlApplyGoogleCookie = (c: string) => {
      void (async () => {
        setBusy(true);
        setMsg(null);
        try {
          const r = await phonePost<PhoneAuthResult>("/api/phone/session", {
            action: "google-cookie",
            cookie: c,
          });
          finish(r);
        } catch (e) {
          setOk(false);
          setMsg(e instanceof Error ? e.message : String(e));
        } finally {
          setBusy(false);
        }
      })();
    };
    const hash = window.location.hash || "";
    const m = /google_cookie=([^&]+)/.exec(hash);
    if (m?.[1]) {
      const c = decodeURIComponent(m[1]);
      window.history.replaceState(null, "", window.location.pathname);
      window.__jlApplyGoogleCookie(c);
    }
    return () => {
      delete window.__jlApplyGoogleCookie;
    };
    // finish closes over onSession; re-bind once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onSession]);

  const run = async (body: Record<string, unknown>) => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await phonePost<PhoneAuthResult>("/api/phone/session", body);
      finish(r);
    } catch (e) {
      setOk(false);
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto min-h-[calc(100dvh-var(--grok-banner-h,0px))] max-w-md px-4 pb-10 pt-8">
      <div className="mb-6 flex items-start gap-3">
        <img src="/icons/icon-192.png" alt="" className="size-14 rounded-2xl ring-2 ring-border" />
        <div>
          <div className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2 py-0.5 text-[11px] font-medium text-muted">
            <Smartphone className="size-3 text-primary" />
            Android · v12 · on-device
          </div>
          <h1 className="font-display mt-1 text-2xl font-bold tracking-tight">Publisher</h1>
          <p className="text-sm text-muted">
            Sign in to JuicyChat. Pending bots stay on this phone until the alarm fires.
          </p>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-3 gap-1 rounded-xl border border-border bg-surface p-1">
        {(
          [
            ["password", "Password"],
            ["magic", "Magic link"],
            ["cookie", "Cookie"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`h-9 rounded-lg text-xs font-semibold ${
              tab === id ? "bg-primary text-primary-fg" : "text-muted"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <section className="rounded-2xl border border-border bg-surface/90 p-4">
        {tab === "password" ? (
          <div className="space-y-2">
            <label className="text-[11px] text-muted">User number</label>
            <input
              value={userNo}
              onChange={(e) => setUserNo(e.target.value)}
              className="h-11 w-full rounded-xl border border-border bg-bg px-3 text-sm"
              placeholder="User no"
              autoComplete="username"
            />
            <label className="text-[11px] text-muted">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-11 w-full rounded-xl border border-border bg-bg px-3 text-sm"
              placeholder="Password"
              autoComplete="current-password"
            />
            <button
              type="button"
              disabled={busy || !userNo || !password}
              onClick={() => void run({ action: "password", userNo, password, email })}
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-bold text-primary-fg disabled:opacity-50"
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
              Sign in
            </button>
          </div>
        ) : null}

        {tab === "magic" ? (
          <div className="space-y-2">
            <label className="text-[11px] text-muted">Email</label>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-11 w-full rounded-xl border border-border bg-bg px-3 text-sm"
              placeholder="you@email.com"
              inputMode="email"
            />
            <button
              type="button"
              disabled={busy || !email}
              onClick={() => void run({ action: "magic-send", email })}
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-border text-sm font-semibold disabled:opacity-50"
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Mail className="size-4" />}
              Send magic link
            </button>
            <input
              value={link}
              onChange={(e) => setLink(e.target.value)}
              className="h-11 w-full rounded-xl border border-border bg-bg px-3 text-sm"
              placeholder="Paste the Sign-in URL"
            />
            <button
              type="button"
              disabled={busy || !link}
              onClick={() => void run({ action: "magic-redeem", link, email })}
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-bold text-primary-fg disabled:opacity-50"
            >
              Redeem link
            </button>
          </div>
        ) : null}

        {tab === "cookie" ? (
          <div className="space-y-2">
            <p className="text-xs text-muted">
              Paste the JuicyChat cookie header if you already captured <code>yume_voucher</code>.
            </p>
            <textarea
              value={cookie}
              onChange={(e) => setCookie(e.target.value)}
              className="min-h-24 w-full rounded-xl border border-border bg-bg px-3 py-2 text-xs"
              placeholder="yume_voucher=…"
            />
            <button
              type="button"
              disabled={busy || cookie.trim().length < 8}
              onClick={() => void run({ action: "cookie", cookie })}
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-bold text-primary-fg disabled:opacity-50"
            >
              Import cookie
            </button>
          </div>
        ) : null}

        {native ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              try {
                getJuicyNative()?.startGoogleLogin();
              } catch (e) {
                setOk(false);
                setMsg(e instanceof Error ? e.message : String(e));
              }
            }}
            className="mt-3 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-border text-sm font-semibold"
          >
            Continue with Google
          </button>
        ) : (
          <p className="mt-3 text-[11px] text-muted">
            Google overlay is on the APK. On the web use password, magic link, or cookie.
          </p>
        )}
      </section>

      {msg ? (
        <p className={`mt-3 text-sm ${ok ? "text-success" : "text-danger"}`}>{msg}</p>
      ) : null}

      <p className="mt-6 text-center text-[11px] text-muted">
        Analytics stay on the web lounge. This phone only signs into JuicyChat, pulls pending
        releases, and fires them locally.
        {" · "}
        <Link to="/android" className="text-primary">
          Get the APK
        </Link>
      </p>
    </div>
  );
}

function toPhoneSession(s: PhoneSessionPayload): PhoneSession {
  return {
    cookie: s.cookie,
    userId: s.userId,
    userName: s.userName,
    userNo: s.userNo,
    email: s.email,
    source: s.source,
    loggedInAt: s.loggedInAt,
  };
}

function QueueScreen({
  session,
  native,
  canExact,
  onLogout,
  onSession,
  onExactRefresh,
}: {
  session: PhoneSession;
  native: boolean;
  canExact: boolean;
  onLogout: () => void;
  onSession: (s: PhoneSession) => void;
  onExactRefresh: () => void;
}) {
  const [q, setQ] = useState<PublishQueue | null>(null);
  const [jobs, setJobs] = useState<NativePublishJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [ok, setOk] = useState<boolean | null>(null);
  const [whenById, setWhenById] = useState<Record<string, string>>({});

  const reloadJobs = useCallback(() => {
    setJobs(listNativeJobs());
  }, []);

  const pull = useCallback(async () => {
    setLoading(true);
    setMsg(null);
    try {
      const r = await phonePost<{
        ok: boolean;
        message?: string;
        queue: PublishQueue;
        session?: PhoneSessionPayload;
      }>("/api/phone/queue", { cookie: session.cookie });
      if (r.session?.cookie) onSession(toPhoneSession(r.session));
      setQ(r.queue);
      if (!r.ok) {
        setOk(false);
        setMsg(r.message || "Could not load pending bots.");
        if (/expired|not logged|session missing/i.test(r.message || "")) onLogout();
      } else {
        setOk(true);
        setMsg(null);
      }
      reloadJobs();
    } catch (e) {
      setOk(false);
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [onLogout, onSession, reloadJobs, session.cookie]);

  useEffect(() => {
    void pull();
  }, [pull]);

  useEffect(() => {
    window.__jlPublishResult = (payload) => {
      setBusyId(null);
      setOk(Boolean(payload?.ok));
      setMsg(payload?.message || (payload?.ok ? "Published" : "Publish failed"));
      void pull();
    };
    return () => {
      delete window.__jlPublishResult;
    };
  }, [pull]);

  const defaultWhen = useMemo(() => toLocalInput(defaultFireMs()), []);

  const onPublishNow = async (row: PublishQueueRow) => {
    setBusyId(row.characterId);
    setMsg(null);
    const nativeBridge = getJuicyNative();
    if (nativeBridge?.publishNow) {
      try {
        nativeBridge.publishNow(row.characterId);
        setMsg("Publishing on this phone…");
        return;
      } catch (e) {
        setOk(false);
        setMsg(e instanceof Error ? e.message : String(e));
        setBusyId(null);
        return;
      }
    }
    try {
      const r = await phonePost<{
        ok: boolean;
        message?: string;
        results: PublishResult[];
        queue: PublishQueue;
        session?: PhoneSessionPayload;
      }>("/api/phone/publish", {
        cookie: session.cookie,
        characterIds: [row.characterId],
      });
      if (r.session?.cookie) onSession(toPhoneSession(r.session));
      setQ(r.queue);
      const one = r.results?.[0];
      setOk(Boolean(one?.ok ?? r.ok));
      setMsg(one?.message || (r.ok ? "Published" : "Publish failed"));
    } catch (e) {
      setOk(false);
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  const onSchedule = (row: PublishQueueRow) => {
    const local = whenById[row.characterId] || defaultWhen;
    const ms = new Date(local).getTime();
    if (!Number.isFinite(ms) || ms < Date.now() - 5_000) {
      setOk(false);
      setMsg("Pick a future time.");
      return;
    }
    const job = scheduleNativeJob(row.characterId, row.characterName, ms);
    reloadJobs();
    if (!job) {
      setOk(false);
      setMsg("Could not schedule.");
      return;
    }
    setOk(true);
    setMsg(
      native
        ? `Scheduled ${row.characterName} for ${formatWhen(new Date(ms).toISOString())} (this phone).`
        : `Saved ${row.characterName} for ${formatWhen(new Date(ms).toISOString())}. Install the APK so the alarm actually fires.`,
    );
    if (native) {
      try {
        getJuicyNative()?.requestBackgroundPermissions();
      } catch {
        /* */
      }
    }
  };

  const pending = q?.pending || [];
  const review = q?.review || [];

  return (
    <div className="mx-auto min-h-[calc(100dvh-var(--grok-banner-h,0px))] max-w-lg px-4 pb-16 pt-6">
      <header className="mb-4 flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted">
            JuicyChat · {native ? "on this phone" : "preview"}
          </div>
          <h1 className="font-display text-2xl font-bold">
            @{session.userName || session.userId || "account"}
          </h1>
          <p className="text-xs text-muted">
            {pending.length} pending release
            {pending.length === 1 ? "" : "s"}
            {review.length ? ` · ${review.length} in review` : ""}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void pull()}
            className="grid size-10 place-items-center rounded-xl border border-border"
            aria-label="Refresh"
          >
            <RefreshCw className={`size-4 ${loading ? "animate-spin text-primary" : ""}`} />
          </button>
          <button
            type="button"
            onClick={onLogout}
            className="grid size-10 place-items-center rounded-xl border border-border"
            aria-label="Sign out"
          >
            <LogOut className="size-4" />
          </button>
        </div>
      </header>

      {native && !canExact ? (
        <button
          type="button"
          onClick={() => {
            try {
              getJuicyNative()?.requestBackgroundPermissions();
            } catch {
              /* */
            }
            onExactRefresh();
          }}
          className="mb-4 flex w-full items-start gap-2 rounded-2xl border border-warning/40 bg-warning/10 px-3 py-3 text-left text-xs text-warning"
        >
          <ShieldAlert className="mt-0.5 size-4 shrink-0" />
          Allow exact alarms and ignore battery optimizations so a scheduled release still fires
          with the app closed.
        </button>
      ) : null}

      {!native ? (
        <p className="mb-4 rounded-2xl border border-border bg-surface px-3 py-3 text-xs text-muted">
          This is the phone publisher. Publish-now works here. Scheduled release only fires from
          the APK (exact alarm + headless JuicyChat call).
        </p>
      ) : null}

      {msg ? (
        <p className={`mb-3 text-sm ${ok ? "text-success" : "text-danger"}`}>{msg}</p>
      ) : null}

      <section className="mb-5 rounded-2xl border border-border bg-surface/90 p-4">
        <div className="mb-3 flex items-center gap-2">
          <Rocket className="size-4 text-primary" />
          <h2 className="text-sm font-semibold">Pending release</h2>
          <span className="ml-auto text-[11px] text-muted">auditType 15</span>
        </div>
        {loading && !q ? (
          <div className="flex items-center gap-2 text-sm text-muted">
            <Loader2 className="size-4 animate-spin" /> Pulling bots…
          </div>
        ) : pending.length === 0 ? (
          <p className="text-sm text-muted">Nothing waiting. Approved bots land here.</p>
        ) : (
          <ul className="divide-y divide-border/70">
            {pending.map((row) => (
              <li key={row.characterId} className="py-3">
                <div className="flex items-center gap-3">
                  {row.characterThumb ? (
                    <img src={row.characterThumb} alt="" className="size-12 rounded-xl object-cover" />
                  ) : (
                    <div className="size-12 rounded-xl bg-elevated" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">{row.characterName}</div>
                    <div className="text-[11px] text-muted">
                      {row.chats.toLocaleString()} chats · {row.visibilityLabel}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={busyId === row.characterId}
                    onClick={() => void onPublishNow(row)}
                    className="rounded-lg bg-primary px-2.5 py-1.5 text-xs font-bold text-primary-fg disabled:opacity-50"
                  >
                    {busyId === row.characterId ? "…" : "Publish"}
                  </button>
                </div>
                <form
                  className="mt-2 flex flex-wrap items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    onSchedule(row);
                  }}
                >
                  <input
                    type="datetime-local"
                    value={whenById[row.characterId] || defaultWhen}
                    onChange={(e) =>
                      setWhenById((m) => ({ ...m, [row.characterId]: e.target.value }))
                    }
                    className="h-9 flex-1 rounded-lg border border-border bg-bg px-2 text-xs"
                    required
                  />
                  <button
                    type="submit"
                    className="inline-flex h-9 items-center gap-1 rounded-lg border border-border px-2.5 text-xs font-semibold"
                  >
                    <AlarmClock className="size-3" />
                    Schedule
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>

      {jobs.filter((j) => j.status === "scheduled" || j.status === "preview-only" || j.status === "running").length ? (
        <section className="mb-5 rounded-2xl border border-border bg-surface/90 p-4">
          <div className="mb-3 flex items-center gap-2">
            <Clock className="size-4 text-accent" />
            <h2 className="text-sm font-semibold">Scheduled on this phone</h2>
          </div>
          <ul className="space-y-2">
            {jobs
              .filter((j) => j.status === "scheduled" || j.status === "preview-only" || j.status === "running")
              .sort((a, b) => a.fireAtMs - b.fireAtMs)
              .map((j) => (
                <li key={j.id} className="flex items-center gap-2 text-sm">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{j.characterName || j.characterId}</div>
                    <div className="text-[11px] text-muted">
                      {formatWhen(new Date(j.fireAtMs).toISOString())}
                      {j.status === "preview-only" ? " · preview only" : ""}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      cancelNativeJob(j.id);
                      reloadJobs();
                    }}
                    className="rounded-lg border border-border px-2 py-1 text-[11px] font-semibold"
                  >
                    Cancel
                  </button>
                </li>
              ))}
          </ul>
        </section>
      ) : null}

      {review.length ? (
        <section className="mb-5 rounded-2xl border border-border bg-surface/80 p-4">
          <h2 className="mb-2 text-sm font-semibold">Under review</h2>
          <ul className="space-y-2">
            {review.map((row) => (
              <li key={row.characterId} className="flex items-center gap-3">
                {row.characterThumb ? (
                  <img src={row.characterThumb} alt="" className="size-9 rounded-lg object-cover" />
                ) : (
                  <div className="size-9 rounded-lg bg-elevated" />
                )}
                <div className="min-w-0 flex-1 truncate text-sm">{row.characterName}</div>
                <span className="text-[11px] text-muted">audit 10</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {q && (q.rejected.length || q.drafts.length) ? (
        <p className="text-[11px] text-muted">
          {q.rejected.length ? `${q.rejected.length} rejected` : null}
          {q.rejected.length && q.drafts.length ? " · " : null}
          {q.drafts.length ? `${q.drafts.length} drafts` : null}
          {" · "}
          {q.liveCount} live
        </p>
      ) : null}

      {jobs.some((j) => j.status === "done" || j.status === "failed") ? (
        <section className="mt-5 rounded-2xl border border-border bg-surface/70 p-4">
          <h2 className="mb-2 text-sm font-semibold">Recent</h2>
          <ul className="space-y-1.5 text-xs text-muted">
            {jobs
              .filter((j) => j.status === "done" || j.status === "failed")
              .slice(-6)
              .reverse()
              .map((j) => (
                <li key={j.id} className="flex items-center gap-2">
                  {j.status === "done" ? (
                    <CheckCircle2 className="size-3.5 text-success" />
                  ) : (
                    <ShieldAlert className="size-3.5 text-danger" />
                  )}
                  <span className="truncate">
                    {j.characterName} · {j.result || j.status}
                  </span>
                </li>
              ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}