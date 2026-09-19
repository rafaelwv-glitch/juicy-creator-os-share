import { useRef, useState } from "react";
import {
  Database,
  Download,
  FileJson,
  FileText,
  Loader2,
  ShieldOff,
  Upload,
  Trash2,
} from "lucide-react";
import {
  clearAnalyticsData,
  exportDataBackup,
  importDataBackup,
  loadReportBundle,
} from "@/lib/juicychat/actions";
import {
  buildAnalyticsPdf,
  downloadBytes,
  downloadJson,
  stampFilename,
} from "@/lib/juicychat/pdf-report";
import type { GrowthAnalysis, LoungeSnapshot } from "@/lib/juicychat/types";

type Props = {
  snapshot: LoungeSnapshot | null;
  growth: GrowthAnalysis | null;
  accountLabel?: string;
  /** Called after successful import so parent can reload caches */
  onImported?: () => void | Promise<void>;
  className?: string;
};

const WAREHOUSE_CHIPS = [
  "Snapshot",
  "Growth history",
  "Notifications",
  "Insights",
  "Followers",
  "Dashboard",
  "Ranklist",
  "Forensics",
  "Rivals",
  "Rival MRT",
  "Publish jobs",
  "Exposure",
  "Audit-15",
  "Tag maps",
  "Cron schedule",
  "New feed",
];

function warehouseStatus(raw: unknown): string {
  if (!raw || typeof raw !== "object") return "Imported";
  const w = raw as {
    format?: string;
    credentials?: boolean;
    manifest?: {
      bots?: number;
      historyDays?: number;
      events?: number;
      forensicBots?: number;
      rivalCount?: number;
      rivalMrtDays?: number;
      newFeedBots?: number;
      newFeedDays?: number;
      keys?: string[];
    };
    snapshot?: { bots?: unknown[] };
    history?: { days?: unknown[] };
    notifications?: { events?: unknown[] };
    files?: Record<string, unknown>;
  };
  const m = w.manifest;
  const bots = m?.bots ?? w.snapshot?.bots?.length ?? 0;
  const days = m?.historyDays ?? w.history?.days?.length ?? 0;
  const events = m?.events ?? w.notifications?.events?.length ?? 0;
  const forensic = m?.forensicBots ?? 0;
  const mrt = m?.rivalMrtDays ?? 0;
  const rivals = m?.rivalCount ?? 0;
  const newDays = m?.newFeedDays ?? 0;
  const newBots = m?.newFeedBots ?? 0;
  const keys = m?.keys?.length ?? (w.files ? Object.keys(w.files).length : 0);
  const cred = w.credentials === false || w.format === "juicy-lounge-warehouse";
  return `${bots} bots · ${days} history days · ${events} events · ${forensic} forensic bots · ${rivals} rivals · ${mrt} MRT days · ${newBots} New bots · ${newDays} New days · ${keys} files${
    cred ? " · no credentials" : " · session stripped"
  }`;
}

export function DataToolsPanel({
  snapshot,
  growth,
  accountLabel,
  onImported,
  className = "",
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<null | "export" | "import" | "pdf" | "clear">(
    null,
  );
  const [msg, setMsg] = useState<string | null>(null);
  const [ok, setOk] = useState<boolean | null>(null);

  const setStatus = (text: string, success: boolean) => {
    setMsg(text);
    setOk(success);
  };

  const onExport = async () => {
    setBusy("export");
    setMsg(null);
    try {
      const warehouse = (await exportDataBackup()) as {
        format?: string;
        credentials?: boolean;
        manifest?: {
          bots?: number;
          historyDays?: number;
          events?: number;
          forensicBots?: number;
          keys?: string[];
        };
        files?: Record<string, unknown>;
      };
      if (warehouse?.credentials) {
        throw new Error("Warehouse export leaked credentials — aborted.");
      }
      downloadJson(stampFilename("juicy-lounge-warehouse", "json"), warehouse);
      const m = warehouse.manifest;
      setStatus(
        `Warehouse exported · ${m?.bots ?? 0} bots · ${m?.historyDays ?? 0} days · ${m?.events ?? 0} events · ${m?.forensicBots ?? 0} forensic bots · ${m?.keys?.length ?? 0} files · no credentials`,
        true,
      );
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e), false);
    } finally {
      setBusy(null);
    }
  };

  const onImportPick = () => {
    fileRef.current?.click();
  };

  const restoreLocal = async (parsed: unknown) => {
    const res = await importDataBackup({ data: { backup: parsed } });
    setStatus(`Warehouse restored · ${res.message || warehouseStatus(parsed)}`, true);
    if (onImported) await onImported();
  };

  const onImportFile = async (file: File | null) => {
    if (!file) return;
    setBusy("import");
    setMsg(null);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as unknown;
      await restoreLocal(parsed);
    } catch (e) {
      setStatus(
        e instanceof Error ? e.message : `Import failed: ${String(e)}`,
        false,
      );
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const onPdf = async () => {
    setBusy("pdf");
    setMsg(null);
    try {
      const bundle = await loadReportBundle().catch(() => null);
      const bytes = buildAnalyticsPdf({
        snapshot: bundle?.snapshot ?? snapshot,
        growth: bundle?.growth ?? growth,
        timing: bundle?.timing ?? null,
        insights: bundle?.insights ?? null,
        deep: bundle?.deep ?? null,
        publish: bundle?.publish ?? null,
        rivals: bundle?.rivals ?? null,
        forensics: bundle?.forensics ?? null,
        followers: bundle?.followers ?? null,
        economy: bundle?.economy ?? null,
        tagForensics: bundle?.tagForensics ?? null,
        accountLabel:
          accountLabel ||
          bundle?.accountLabel ||
          snapshot?.profile?.userName ||
          snapshot?.profile?.userId ||
          "—",
        lookbackDays: bundle?.lookbackDays ?? 30,
      });
      downloadBytes(
        stampFilename("juicy-lounge-report", "pdf"),
        bytes,
        "application/pdf",
      );
      setStatus("PDF report downloaded · all warehouse insights · no credentials", true);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e), false);
    } finally {
      setBusy(null);
    }
  };

  const onClear = async () => {
    if (
      !confirm(
        "Clear the local data warehouse (snapshot, history, notifications, insights, forensics, ranklist)? Login session is kept.",
      )
    ) {
      return;
    }
    setBusy("clear");
    setMsg(null);
    try {
      await clearAnalyticsData({ data: { keepSession: true } });
      setStatus("Warehouse cache cleared (session kept)", true);
      if (onImported) await onImported();
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e), false);
    } finally {
      setBusy(null);
    }
  };

  const disabled = busy != null;

  return (
    <section
      className={`rounded-xl border border-border bg-surface/90 p-4 sm:p-5 ${className}`}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Database className="size-4 text-primary" />
          <h2 className="text-sm font-semibold">Data warehouse</h2>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-success">
          <ShieldOff className="size-3" />
          No credentials
        </span>
      </div>

      <p className="mb-3 text-xs text-muted">
        Export every gathered signal — snapshot, growth, notifications, insights,
        followers, ranklist, forensics, rivals, publish jobs, audit-15, New-feed
        dated snapshots — as one JSON warehouse.
        The file never includes the JuicyChat cookie or webhook secrets. Re-import
        restores the warehouse. Legacy backups still import; the login session is
        stripped.
      </p>

      <div className="mb-4 flex flex-wrap gap-1.5">
        {WAREHOUSE_CHIPS.map((chip) => (
          <span
            key={chip}
            className="rounded-full border border-border bg-bg px-2 py-0.5 text-[10px] text-muted"
          >
            {chip}
          </span>
        ))}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <button
          type="button"
          onClick={() => void onExport()}
          disabled={disabled}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-fg transition hover:brightness-110 disabled:opacity-55"
        >
          {busy === "export" ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <FileJson className="size-4" />
          )}
          Export warehouse
        </button>

        <button
          type="button"
          onClick={onImportPick}
          disabled={disabled}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-border bg-bg px-4 text-sm font-semibold text-fg transition hover:border-border-strong disabled:opacity-55"
        >
          {busy === "import" ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Upload className="size-4 text-primary" />
          )}
          Import warehouse
        </button>

        <button
          type="button"
          onClick={() => void onPdf()}
          disabled={disabled}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-border bg-bg px-4 text-sm font-semibold text-fg transition hover:border-border-strong disabled:opacity-55"
        >
          {busy === "pdf" ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <FileText className="size-4 text-primary" />
          )}
          PDF report
        </button>

        <button
          type="button"
          onClick={() => void onClear()}
          disabled={disabled}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-danger/30 bg-danger/5 px-4 text-sm font-medium text-danger transition hover:bg-danger/10 disabled:opacity-55"
        >
          {busy === "clear" ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Trash2 className="size-4" />
          )}
          Clear cache
        </button>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => void onImportFile(e.target.files?.[0] ?? null)}
      />

      {msg ? (
        <p className={`mt-3 text-xs ${ok ? "text-success" : "text-danger"}`}>{msg}</p>
      ) : (
        <p className="mt-3 text-[11px] text-muted">
          <Download className="mr-1 inline size-3" />
          Warehouse files restore analytics onto this local database. Session
          cookies stay on this machine.
        </p>
      )}
    </section>
  );
}
