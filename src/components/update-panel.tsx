import { useCallback, useEffect, useState } from "react";
import { Download, Loader2, RefreshCw, RotateCw } from "lucide-react";
import { checkAppUpdate } from "@/lib/juicychat/actions";
import { APP_RELEASES_URL, isNewerRelease } from "@/lib/juicychat/app-update";
import { formatWhen } from "@/lib/juicychat/format";

type Asset = { name: string; url: string; size: number; channel: string };

type View = {
  current: string;
  latest: string | null;
  newer: boolean;
  tag: string | null;
  name: string | null;
  notes: string;
  htmlUrl: string;
  publishedAt: string | null;
  asset: Asset | null;
  assets: Asset[];
  channel: string;
  error: string | null;
};

type DesktopPayload = {
  state?: string;
  version?: string;
  percent?: number;
  message?: string;
};

function desktopApi() {
  if (typeof window === "undefined") return null;
  return (
    window as Window & {
      juicyDesktop?: {
        isDesktop: boolean;
        checkUpdate: () => Promise<unknown>;
        installUpdate: () => Promise<unknown>;
        onUpdate: (cb: (p: DesktopPayload) => void) => () => void;
      };
    }
  ).juicyDesktop;
}

function sizeMb(n: number) {
  if (!n) return "";
  return `${(n / 1_048_576).toFixed(n >= 50_000_000 ? 0 : 1)} MB`;
}

export function UpdatePanel({ className = "" }: { className?: string }) {
  const [view, setView] = useState<View | null>(null);
  const [busy, setBusy] = useState(false);
  const [desk, setDesk] = useState<DesktopPayload | null>(null);
  const isDesk = Boolean(desktopApi()?.isDesktop);

  const reload = useCallback(async (force = false) => {
    setBusy(true);
    try {
      const v = (await checkAppUpdate({
        data: {
          platform: typeof navigator !== "undefined" ? navigator.platform : "",
          portable: Boolean(
            typeof navigator !== "undefined" && /portable/i.test(navigator.userAgent),
          ),
          force,
        },
      })) as View;
      setView(v);
      if (isDesk) {
        try {
          await desktopApi()?.checkUpdate();
        } catch {
          /* GitHub check is enough */
        }
      }
    } catch (e) {
      setView((cur) => ({
        current: cur?.current || "—",
        latest: null,
        newer: false,
        tag: null,
        name: null,
        notes: "",
        htmlUrl: APP_RELEASES_URL,
        publishedAt: null,
        asset: null,
        assets: [],
        channel: "other",
        error: e instanceof Error ? e.message : String(e),
      }));
    } finally {
      setBusy(false);
    }
  }, [isDesk]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    const api = desktopApi();
    if (!api?.onUpdate) return;
    return api.onUpdate((p) => setDesk(p));
  }, []);

  const onInstall = async () => {
    setBusy(true);
    try {
      await desktopApi()?.installUpdate();
    } catch (e) {
      setDesk({
        state: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(false);
    }
  };

  const ready = desk?.state === "ready";
  const downloading = desk?.state === "downloading";
  const newer = Boolean(
    view?.latest && !view.error && isNewerRelease(view.latest, view.current || "0.0.0"),
  );

  return (
    <section className={`rounded-xl border border-border bg-surface/80 p-4 sm:p-5 ${className}`}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-start gap-2">
          <Download className="mt-0.5 size-4 text-primary" />
          <div>
            <h2 className="text-sm font-semibold">App updates</h2>
            <p className="mt-0.5 max-w-xl text-[12px] text-muted">
              Checks GitHub for a newer desktop or local build. Installed Windows setup and Linux
              AppImage can apply the file and restart. Portable, zip, and source still download
              the matching package. Lounge data stays in its folder.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void reload(true)}
          disabled={busy}
          className="inline-flex h-11 items-center gap-2 rounded-xl border border-border bg-bg px-3 text-xs font-semibold disabled:opacity-60"
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
          Check for update
        </button>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <div className="rounded-lg border border-border bg-bg/40 px-3 py-2">
          <div className="text-[10px] uppercase tracking-wide text-faint">This build</div>
          <div className="mt-0.5 font-mono text-sm font-semibold">{view?.current || "—"}</div>
        </div>
        <div className="rounded-lg border border-border bg-bg/40 px-3 py-2">
          <div className="text-[10px] uppercase tracking-wide text-faint">Latest</div>
          <div className="mt-0.5 font-mono text-sm font-semibold">
            {view?.latest ? `v${view.latest}` : busy ? "…" : "—"}
          </div>
        </div>
        <div className="rounded-lg border border-border bg-bg/40 px-3 py-2">
          <div className="text-[10px] uppercase tracking-wide text-faint">Status</div>
          <div className="mt-0.5 text-sm font-semibold">
            {view?.error
              ? "Could not check"
              : ready
                ? "Restart to apply"
                : downloading
                  ? `Downloading ${Math.round(desk?.percent || 0)}%`
                  : newer
                    ? "Update available"
                    : view
                      ? "Up to date"
                      : "—"}
          </div>
        </div>
      </div>

      {view?.error ? <p className="mt-3 text-xs text-danger">{view.error}</p> : null}
      {desk?.state === "error" && desk.message ? (
        <p className="mt-2 text-xs text-danger">{desk.message}</p>
      ) : null}

      {newer ? (
        <div className="mt-3 rounded-xl border border-primary/30 bg-primary/5 p-3">
          <p className="text-sm font-semibold">{view.name || view.tag}</p>
          {view.publishedAt ? (
            <p className="mt-0.5 text-[11px] text-faint">Published {formatWhen(view.publishedAt)}</p>
          ) : null}
          {view.notes ? (
            <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap font-sans text-[12px] text-muted">
              {view.notes.split("\n").slice(0, 12).join("\n")}
            </pre>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            {ready ? (
              <button
                type="button"
                onClick={() => void onInstall()}
                className="inline-flex h-11 items-center gap-2 rounded-xl bg-primary px-3 text-sm font-semibold text-primary-fg"
              >
                <RotateCw className="size-4" />
                Restart to update
              </button>
            ) : null}
            {view.asset ? (
              <a
                href={view.asset.url}
                className="inline-flex h-11 items-center gap-2 rounded-xl border border-primary/40 bg-primary/15 px-3 text-sm font-semibold text-primary"
              >
                <Download className="size-4" />
                {view.asset.name}
                {view.asset.size ? ` · ${sizeMb(view.asset.size)}` : ""}
              </a>
            ) : null}
            <a
              href={view.htmlUrl || APP_RELEASES_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-11 items-center rounded-xl border border-border px-3 text-sm font-medium text-muted hover:text-fg"
            >
              All packages
            </a>
          </div>
        </div>
      ) : (
        <p className="mt-3 text-[12px] text-faint">
          Releases:{" "}
          <a href={APP_RELEASES_URL} className="text-primary hover:underline" target="_blank" rel="noreferrer">
            {APP_RELEASES_URL.replace("https://", "")}
          </a>
          {isDesk ? " · this desktop build can apply setup / AppImage silently." : ""}
        </p>
      )}
    </section>
  );
}
