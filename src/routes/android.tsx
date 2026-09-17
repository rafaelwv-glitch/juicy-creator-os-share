import { useEffect, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import {
  ArrowLeft,
  CheckCircle2,
  Download,
  ExternalLink,
  FileJson,
  RefreshCw,
  Smartphone,
  Sparkles,
} from "lucide-react";
import { MobileNav, DesktopNavLinks } from "@/components/mobile-nav";

export const Route = createFileRoute("/android")({ component: AndroidPage });

const APK_API = "/api/download-apk";
const APK_STATIC = "/downloads/juicy-lounge-debug.apk";
const APK_NAME = "juicy-lounge-debug.apk";

function AndroidPage() {
  const [canInstall, setCanInstall] = useState(false);
  const [deferred, setDeferred] = useState<any>(null);
  const [installed, setInstalled] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [apkOk, setApkOk] = useState<boolean | null>(null);
  const [apkBytes, setApkBytes] = useState<number | null>(null);

  useEffect(() => {
    const mq = window.matchMedia("(display-mode: standalone)");
    setIsStandalone(mq.matches || (navigator as any).standalone === true);

    const onBip = (e: Event) => {
      e.preventDefault();
      setDeferred(e);
      setCanInstall(true);
    };
    window.addEventListener("beforeinstallprompt", onBip);
    window.addEventListener("appinstalled", () => {
      setInstalled(true);
      setCanInstall(false);
      setDeferred(null);
    });
    return () => window.removeEventListener("beforeinstallprompt", onBip);
  }, []);

  const [host, setHost] = useState("");
  useEffect(() => {
    setHost(window.location.origin);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(APK_STATIC, { method: "HEAD", cache: "no-store" });
        if (cancelled) return;
        if (r.ok) {
          setApkOk(true);
          const len = r.headers.get("content-length");
          setApkBytes(len ? Number(len) : null);
          return;
        }
      } catch {
        /* try api */
      }
      try {
        const r2 = await fetch(APK_API, { method: "HEAD", cache: "no-store" });
        if (cancelled) return;
        setApkOk(r2.ok || r2.status === 302);
        const len = r2.headers.get("content-length");
        if (len) setApkBytes(Number(len));
      } catch {
        if (!cancelled) setApkOk(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onInstallPwa = async () => {
    if (!deferred) return;
    deferred.prompt();
    const choice = await deferred.userChoice;
    if (choice?.outcome === "accepted") setInstalled(true);
    setDeferred(null);
    setCanInstall(false);
  };

  const sizeLabel =
    apkBytes && apkBytes > 0
      ? apkBytes >= 1_000_000
        ? `${(apkBytes / 1_000_000).toFixed(0)} MB`
        : `${Math.round(apkBytes / 1000)} KB`
      : null;

  return (
    <div className="min-h-[calc(100dvh-var(--grok-banner-h,0px))] bg-bg pb-24 text-fg md:pb-10">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -left-20 top-10 h-64 w-64 rounded-full bg-primary/25 blur-3xl" />
        <div className="absolute bottom-20 right-0 h-72 w-72 rounded-full bg-accent/10 blur-3xl" />
      </div>

      <div className="relative mx-auto max-w-3xl px-4 pt-6 sm:px-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-muted hover:text-fg"
          >
            <ArrowLeft className="size-3.5" /> Back to lounge
          </Link>
          <DesktopNavLinks />
        </div>

        <div className="mb-6 flex items-start gap-4">
          <img
            src="/icons/icon-192.png"
            alt=""
            className="size-16 rounded-2xl shadow-lg ring-2 ring-border"
          />
          <div>
            <div className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface/80 px-2.5 py-0.5 text-[11px] font-medium text-muted">
              <Smartphone className="size-3 text-primary" />
              Android · v12.0.0
            </div>
            <h1 className="font-display mt-1 text-3xl font-bold tracking-tight">
              Juicy Lounge <span className="text-muted">for Android</span>
            </h1>
            <p className="mt-1 text-sm text-muted">
              Sign in to JuicyChat on the phone, pull pending releases, and fire them with an
              exact alarm. Analytics stay on the web lounge — the APK does not need a Vercel
              account.
            </p>
          </div>
        </div>

        {/* Primary download CTA */}
        <section className="mb-5 rounded-2xl border border-primary/40 bg-primary/10 p-5 shadow-lg shadow-primary/10">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Download className="size-5 text-primary" />
              <h2 className="text-base font-semibold">Download the app</h2>
            </div>
            {apkOk === true && (
              <span className="rounded-full border border-success/30 bg-success/10 px-2.5 py-0.5 text-[11px] font-medium text-success">
                Ready{sizeLabel ? ` · ${sizeLabel}` : ""}
              </span>
            )}
            {apkOk === false && (
              <span className="rounded-full border border-danger/30 bg-danger/10 px-2.5 py-0.5 text-[11px] font-medium text-danger">
                APK missing — rebuild needed
              </span>
            )}
          </div>
          <p className="mb-4 text-xs text-muted">
            Install the debug APK on your phone. Enable “Install unknown apps” for your browser,
            then open the downloaded file.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <a
              href={APK_API}
              download={APK_NAME}
              className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-primary px-5 text-sm font-bold text-primary-fg shadow-md shadow-primary/25 transition hover:brightness-110"
            >
              <Download className="size-4" />
              Download APK
            </a>
            <a
              href={APK_STATIC}
              download={APK_NAME}
              className="inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-border bg-surface px-5 text-sm font-semibold text-fg transition hover:border-border-strong"
            >
              <ExternalLink className="size-4 text-primary" />
              Direct file link
            </a>
          </div>
          <p className="mt-3 text-[11px] text-muted">
            Package <code className="text-accent">ai.juicylounge.analytics</code>
            {" · "}
            file <code className="text-accent">{APK_NAME}</code>
            {" · "}
            must end in <code className="text-accent">.apk</code>
          </p>
        </section>

        <div className="mb-8 flex justify-center">
          <div className="relative w-[min(280px,85vw)] rounded-[2rem] border-[6px] border-[#1c1e3a] bg-[#0a0b14] p-2 shadow-2xl ring-1 ring-border">
            <div className="absolute left-1/2 top-1.5 h-4 w-20 -translate-x-1/2 rounded-full bg-black/80" />
            <div className="overflow-hidden rounded-[1.4rem] bg-gradient-to-b from-[#161836] to-[#0a0b14] px-3 pb-4 pt-8">
              <div className="mb-3 flex items-center gap-2">
                <img src="/icons/icon-48.png" alt="" className="size-8 rounded-lg" />
                <div>
                  <div className="text-xs font-semibold">Juicy Lounge</div>
                  <div className="text-[10px] text-muted">v12 · Publisher</div>
                </div>
              </div>
              <div className="space-y-2">
                <div className="rounded-xl border border-primary/40 bg-primary/15 p-2.5 text-center text-[11px] font-semibold text-primary">
                  Refresh pending
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  <div className="rounded-lg border border-border/80 bg-surface/80 p-2 text-center text-[9px] text-muted">
                    Pending
                  </div>
                  <div className="rounded-lg border border-border/80 bg-surface/80 p-2 text-center text-[9px] text-muted">
                    Schedule
                  </div>
                  <div className="rounded-lg border border-border/80 bg-surface/80 p-2 text-center text-[9px] text-muted">
                    Alarm
                  </div>
                </div>
                <div className="rounded-xl border border-border/80 bg-surface/80 p-2.5">
                  <div className="text-[10px] text-muted">Lookback</div>
                  <div className="text-xs font-semibold">7 · 21 · 60 · 90 days</div>
                </div>
                <div className="flex gap-1.5 text-[9px]">
                  <span className="flex-1 rounded-lg border border-border/80 bg-surface/80 px-1.5 py-1.5 text-center">
                    Warehouse
                  </span>
                  <span className="flex-1 rounded-lg border border-border/80 bg-surface/80 px-1.5 py-1.5 text-center">
                    Import
                  </span>
                  <span className="flex-1 rounded-lg border border-border/80 bg-surface/80 px-1.5 py-1.5 text-center">
                    PDF
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <section className="mb-5 rounded-2xl border border-border bg-surface/90 p-5">
          <div className="mb-3 flex items-center gap-2">
            <Sparkles className="size-4 text-primary" />
            <h2 className="text-sm font-semibold">What’s in v12</h2>
          </div>
          <ul className="space-y-2 text-xs text-muted">
            <li className="flex gap-2">
              <RefreshCw className="mt-0.5 size-3.5 shrink-0 text-primary" />
              <span>
                <strong className="text-fg">JuicyChat login</strong> — password, magic link, Google
                overlay, or cookie. No Vercel lounge account.
              </span>
            </li>
            <li className="flex gap-2">
              <RefreshCw className="mt-0.5 size-3.5 shrink-0 text-primary" />
              <span>
                <strong className="text-fg">Pending bots</strong> — pulls auditType 15 (approved,
                not live)
              </span>
            </li>
            <li className="flex gap-2">
              <FileJson className="mt-0.5 size-3.5 shrink-0 text-primary" />
              <span>
                <strong className="text-fg">On-device schedule</strong> — exact alarm + headless
                publish with the app closed
              </span>
            </li>
            <li className="flex gap-2">
              <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-success" />
              <span>
                <strong className="text-fg">Web lounge unchanged</strong> — analytics, cron, and
                Grok reports stay on Vercel
              </span>
            </li>
          </ul>
        </section>

        <section className="mb-5 rounded-2xl border border-primary/30 bg-primary/10 p-5">
          <h2 className="mb-2 text-sm font-semibold">Try the publisher</h2>
          <p className="mb-3 text-xs text-muted">
            Same sign-in and pending queue in the browser. Scheduled release only fires from the
            APK.
          </p>
          <Link
            to="/phone"
            className="inline-flex h-11 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-fg"
          >
            Open publisher
          </Link>
        </section>

        <section className="mb-5 rounded-2xl border border-border bg-surface/90 p-5">
          <div className="mb-3 flex items-center gap-2">
            <Sparkles className="size-4 text-primary" />
            <h2 className="text-sm font-semibold">Install as PWA (optional)</h2>
          </div>
          <p className="mb-3 text-xs text-muted">
            Prefer the live web app on your home screen
            {host ? ` (${host})` : ""} — or use the native APK above for offline backup/PDF.
          </p>
          {isStandalone || installed ? (
            <p className="text-sm text-success">Already installed / running standalone.</p>
          ) : canInstall ? (
            <button
              type="button"
              onClick={() => void onInstallPwa()}
              className="inline-flex h-11 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-fg"
            >
              Install web app
            </button>
          ) : (
            <p className="text-xs text-muted">
              Browser menu → Install app / Add to Home screen.
            </p>
          )}
        </section>

        <section className="mb-8 rounded-2xl border border-border bg-surface/90 p-5">
          <h2 className="mb-2 text-sm font-semibold">Install steps</h2>
          <ol className="list-decimal space-y-1.5 pl-4 text-xs text-muted">
            <li>
              Tap <strong className="text-fg">Download APK</strong> above.
            </li>
            <li>Open the file from your downloads notification / Files app.</li>
            <li>Allow install from this browser if Android asks.</li>
            <li>Open Juicy Lounge → sign in to JuicyChat → pull pending → schedule.</li>
          </ol>
        </section>
      </div>
      <MobileNav />
    </div>
  );
}
