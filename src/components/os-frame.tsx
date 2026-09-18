import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Loader2, Smartphone, Sparkles, Zap } from "lucide-react";
import {
  getScrapeStatus,
  getCloudLoungeStatus,
  loadCreatorDashboard,
} from "@/lib/juicychat/actions";
import { postCloudRefresh } from "@/lib/juicychat/cloud-refresh";
import { DesktopNavLinks, MobileNav } from "@/components/mobile-nav";
import { UserButton } from "@/lib/auth/gates";
import { isCompanion } from "@/lib/auth/device-client";
import { DbStatusIndicator, type PersistHealth } from "@/components/db-status";
import type { CreatorDashboard } from "@/lib/juicychat/dashboard";
import { formatWhen, humanizeConnectError } from "@/lib/juicychat/format";

type ClockJob = {
  id: string;
  characterId: string;
  characterName: string;
  fireAtMs: number;
  status: string;
};

type AuthStatus = Awaited<ReturnType<typeof getScrapeStatus>>;

export function useOsSession() {
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [dash, setDash] = useState<CreatorDashboard | null>(null);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [ok, setOk] = useState<boolean | null>(null);
  const [companion, setCompanion] = useState(false);
  const [persist, setPersist] = useState<PersistHealth | null>(null);
  const [jobs, setJobs] = useState<ClockJob[]>([]);

  const reloadAuth = useCallback(async () => {
    const s = await getScrapeStatus();
    setAuth(s);
    return s;
  }, []);

  const reloadDash = useCallback(async () => {
    const d = (await loadCreatorDashboard()) as CreatorDashboard;
    setDash(d);
    return d;
  }, []);

  useEffect(() => {
    setCompanion(isCompanion());
    void (async () => {
      try {
        await reloadAuth();
        await reloadDash();
        try {
          const s = await getCloudLoungeStatus();
          setPersist((s as { persist?: PersistHealth }).persist || null);
          const j = (s as { jobs?: ClockJob[] }).jobs;
          if (Array.isArray(j)) setJobs(j);
        } catch {
          /* */
        }
      } catch (e) {
        setMsg(humanizeConnectError(e));
        setOk(false);
      }
    })();
  }, [reloadAuth, reloadDash]);

  const onCloudRefresh = async () => {
    setBusy(true);
    setPhase("Complete scrape — lounge, ranks, discovery feeds, tags, comments, rivals…");
    setMsg(null);
    try {
      const res = await postCloudRefresh();
      if (res.dashboard) setDash(res.dashboard as CreatorDashboard);
      else await reloadDash();
      await reloadAuth();
      if (res.persist) setPersist(res.persist as PersistHealth);
      else {
        try {
          const s = await getCloudLoungeStatus();
          setPersist((s as { persist?: PersistHealth }).persist || null);
          const j = (s as { jobs?: ClockJob[] }).jobs;
          if (Array.isArray(j)) setJobs(j);
        } catch {
          /* */
        }
      }
      setMsg(res.message);
      setOk(res.ok);
    } catch (e) {
      try {
        await reloadDash();
        await reloadAuth();
      } catch {
        /* */
      }
      setMsg(humanizeConnectError(e));
      setOk(false);
    } finally {
      setBusy(false);
      setPhase("");
    }
  };

  const profile = dash?.snapshot?.profile;
  const sampleSnap =
    dash?.snapshot?.userId === "sample-juicy-user" || profile?.userName === "SampleCreator";
  const displayName =
    (!sampleSnap && profile?.userName) || auth?.user?.userName || auth?.email || "Creator";
  const sourceOn = Boolean(auth?.authenticated);

  return {
    auth,
    dash,
    setDash,
    busy,
    phase,
    msg,
    ok,
    companion,
    persist,
    jobs,
    reloadAuth,
    reloadDash,
    onCloudRefresh,
    displayName,
    sourceOn,
  };
}

export type OsTab = "summary" | "lounge" | "config";

export function OsTabs({ current }: { current: OsTab }) {
  const tab = (to: "/" | "/lounge" | "/config", id: OsTab, label: string, hint: string) => {
    const active = current === id;
    return (
      <Link
        to={to}
        className={`flex min-w-0 flex-1 flex-col rounded-xl px-3 py-2 text-left transition ${
          active ? "bg-elevated text-fg shadow-sm" : "text-muted hover:text-fg"
        }`}
      >
        <span className="text-sm font-semibold">{label}</span>
        <span className="truncate text-[11px] text-faint">{hint}</span>
      </Link>
    );
  };
  return (
    <div className="mb-6 grid grid-cols-3 gap-1 rounded-2xl border border-border bg-surface/80 p-1">
      {tab("/", "summary", "Quick summary", "Heat · clock · engine vs comedy")}
      {tab("/lounge", "lounge", "Lounge", "Full dashboard, ranks, yield")}
      {tab("/config", "config", "Config", "Schedule, sources, accounts")}
    </div>
  );
}

export function OsFrame({
  tab,
  session,
  children,
}: {
  tab: OsTab;
  session: ReturnType<typeof useOsSession>;
  children: ReactNode;
}) {
  const {
    dash,
    busy,
    phase,
    msg,
    ok,
    companion,
    persist,
    onCloudRefresh,
    displayName,
    sourceOn,
  } = session;

  return (
    <div className="min-h-[calc(100dvh-var(--grok-banner-h,0px))] bg-bg pb-28 text-fg md:pb-12">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -left-24 top-0 h-72 w-72 rounded-full bg-primary/15 blur-3xl" />
        <div className="absolute right-0 top-40 h-80 w-80 rounded-full bg-accent/10 blur-3xl" />
      </div>

      <div className="relative mx-auto max-w-6xl overflow-x-hidden px-4 pt-5 sm:px-6 sm:pt-8">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface/80 px-2.5 py-0.5 text-[11px] font-medium text-muted">
            <Sparkles className="size-3 text-primary" />
            Cloud OS
            {companion ? " · phone" : ""}
          </div>
          <DesktopNavLinks />
          <UserButton />
        </div>

        <header className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
              <span className="text-muted">@</span>
              {displayName}
            </h1>
            <p className="mt-1 max-w-xl text-sm text-muted">
              {tab === "summary"
                ? "What printed, what's on a clock, and whether the spike is new or old."
                : tab === "config"
                  ? "Schedule, sources, warehouse, and account wiring."
                  : "Full lounge — growth, ranks, yield, exposure."}
              {dash?.scrapedAt ? (
                <span className="text-faint"> · Updated {formatWhen(dash.scrapedAt)}</span>
              ) : null}
            </p>
            <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
              <span
                className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 ${
                  sourceOn ? "border-success/30 text-success" : "border-danger/30 text-danger"
                }`}
              >
                <span className={`size-1.5 rounded-full ${sourceOn ? "bg-success" : "bg-danger"}`} />
                JuicyChat {sourceOn ? "connected" : "needed"}
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-muted">
                <span className={`size-1.5 rounded-full ${companion ? "bg-success" : "bg-faint"}`} />
                {companion ? "Phone linked" : "Web"}
              </span>
              <DbStatusIndicator persist={persist} />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void onCloudRefresh()}
              className="inline-flex h-11 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-fg disabled:opacity-55"
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Zap className="size-4" />}
              Refresh all
            </button>
            {!companion ? (
              <Link
                to="/android"
                className="inline-flex h-11 items-center gap-2 rounded-xl border border-border bg-surface px-4 text-sm font-semibold"
              >
                <Smartphone className="size-4" />
                App
              </Link>
            ) : null}
          </div>
        </header>

        {busy && phase ? (
          <div className="mb-4 flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/10 px-3 py-2 text-xs text-primary">
            <Loader2 className="size-3.5 animate-spin" />
            {phase}
          </div>
        ) : null}
        {msg ? (
          <p className={`mb-4 text-xs ${ok ? "text-success" : "text-danger"}`}>{msg}</p>
        ) : null}

        <OsTabs current={tab} />
        {children}
      </div>
      <MobileNav />
    </div>
  );
}
