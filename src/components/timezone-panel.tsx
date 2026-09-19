import { useCallback, useEffect, useMemo, useState } from "react";
import { Globe, Loader2 } from "lucide-react";
import { getTimezoneSettings, saveTimezoneSettings } from "@/lib/juicychat/actions";
import { rememberBrowserCache } from "@/lib/juicychat/browser-sync";
import {
  clockInZone,
  detectHostTimezone,
  listTimeZones,
  offsetLabel,
  rememberTimezone,
  timezoneCity,
  type TimezoneMode,
} from "@/lib/juicychat/timezone";

type Payload = {
  timezone: string;
  mode: TimezoneMode | string;
  detected: string;
  manualTimezone: string | null;
  updatedAt: string | null;
  zones?: string[];
};

function groupedZones(zones: string[]) {
  const map = new Map<string, string[]>();
  for (const z of zones) {
    const region = z.includes("/") ? z.split("/")[0]! : "Other";
    const list = map.get(region) || [];
    list.push(z);
    map.set(region, list);
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

export function TimezonePanel({ className = "" }: { className?: string }) {
  const [view, setView] = useState<Payload | null>(null);
  const [mode, setMode] = useState<TimezoneMode>("auto");
  const [picked, setPicked] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [ok, setOk] = useState<boolean | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const apply = useCallback((v: Payload) => {
    const nextMode: TimezoneMode = v.mode === "manual" ? "manual" : "auto";
    setView(v);
    setMode(nextMode);
    setPicked(v.manualTimezone || v.timezone || v.detected || detectHostTimezone());
    rememberTimezone({
      mode: nextMode,
      timezone: v.timezone,
      detected: v.detected,
    });
  }, []);

  const reload = useCallback(async () => {
    const v = (await getTimezoneSettings()) as Payload;
    apply(v);
    return v;
  }, [apply]);

  useEffect(() => {
    void reload().catch((e) => {
      setMsg(e instanceof Error ? e.message : String(e));
      setOk(false);
    });
  }, [reload]);

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(t);
  }, []);

  const zones = useMemo(() => {
    const fromServer = Array.isArray(view?.zones) ? view!.zones! : [];
    const base = fromServer.length > 8 ? fromServer : listTimeZones();
    const set = new Set(base);
    if (view?.detected) set.add(view.detected);
    if (view?.timezone) set.add(view.timezone);
    if (picked) set.add(picked);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [view, picked]);

  const groups = useMemo(() => groupedZones(zones), [zones]);
  const active = mode === "manual" ? picked || view?.timezone || detectHostTimezone() : view?.detected || detectHostTimezone();
  const off = offsetLabel(active, now);
  const city = timezoneCity(active);

  const onSave = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const v = (await saveTimezoneSettings({
        data: {
          mode,
          timezone: mode === "manual" ? picked : view?.detected || detectHostTimezone(),
        },
      })) as Payload;
      apply(v);
      setMsg(
        v.mode === "manual"
          ? `Lounge clock is ${v.timezone}. Scrape jobs, heatmaps, and reports use this zone.`
          : `Auto · ${v.timezone} on this computer.`,
      );
      setOk(true);
      window.dispatchEvent(new CustomEvent("jl-timezone-changed", { detail: v }));
      void rememberBrowserCache();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
      setOk(false);
    } finally {
      setBusy(false);
    }
  };

  if (!view) {
    return (
      <section className={`rounded-xl border border-border bg-surface/80 p-4 sm:p-5 ${className}`}>
        <div className="flex items-center gap-2 text-sm text-muted">
          {msg ? null : <Loader2 className="size-4 animate-spin" />}
          {msg ? <span className="text-danger">{msg}</span> : "Loading timezone…"}
        </div>
      </section>
    );
  }

  return (
    <section className={`rounded-xl border border-primary/30 bg-primary/5 p-4 sm:p-5 ${className}`}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <Globe className="mt-0.5 size-4 text-primary" />
          <div>
            <h2 className="text-sm font-semibold">Lounge timezone</h2>
            <p className="mt-0.5 max-w-xl text-[12px] text-muted">
              Scrape clocks, calendar days, timing heatmaps, and reports share one IANA zone.
              Auto follows this computer. Pick a zone if you are on a hosted preview (often UTC).
            </p>
          </div>
        </div>
        <div className="rounded-lg border border-border bg-bg/60 px-3 py-2 text-right">
          <div className="font-mono text-lg font-semibold tabular-nums">{clockInZone(active, now)}</div>
          <div className="text-[11px] text-muted">
            {city}
            {off ? ` · ${off}` : ""}
          </div>
        </div>
      </div>

      <div className="mb-3 grid gap-1 rounded-xl border border-border bg-bg/40 p-1 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => setMode("auto")}
          className={`rounded-lg px-3 py-2 text-left text-xs font-semibold ${
            mode === "auto" ? "bg-elevated text-fg shadow-sm" : "text-muted"
          }`}
        >
          Auto
          <span className="mt-0.5 block font-normal text-[11px] text-faint">
            This computer · {view.detected}
          </span>
        </button>
        <button
          type="button"
          onClick={() => {
            setMode("manual");
            if (!picked) setPicked(view.detected);
          }}
          className={`rounded-lg px-3 py-2 text-left text-xs font-semibold ${
            mode === "manual" ? "bg-elevated text-fg shadow-sm" : "text-muted"
          }`}
        >
          Manual
          <span className="mt-0.5 block font-normal text-[11px] text-faint">Any IANA city</span>
        </button>
      </div>

      <label className="mb-3 block">
        <span className="text-[11px] font-medium text-muted">Zone</span>
        <select
          value={mode === "manual" ? picked : view.detected}
          disabled={mode !== "manual"}
          onChange={(e) => {
            setMode("manual");
            setPicked(e.target.value);
          }}
          className="mt-1 h-10 w-full rounded-lg border border-border bg-bg px-3 text-sm disabled:opacity-60"
        >
          {groups.map(([region, list]) => (
            <optgroup key={region} label={region}>
              {list.map((z) => (
                <option key={z} value={z}>
                  {z.replace(/_/g, " ")}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] text-faint">
          Historical YYYY-MM-DD rows stay as stored. New scrapes and heatmaps use {active}.
        </p>
        <button
          type="button"
          onClick={() => void onSave()}
          disabled={busy}
          className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-3 text-sm font-semibold text-primary-fg disabled:opacity-60"
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : null}
          Save timezone
        </button>
      </div>

      {msg ? (
        <p className={`mt-3 text-xs ${ok ? "text-success" : "text-danger"}`}>{msg}</p>
      ) : null}
    </section>
  );
}
