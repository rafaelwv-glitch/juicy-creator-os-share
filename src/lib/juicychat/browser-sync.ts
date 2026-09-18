/**
 * Client boot + write-through: IndexedDB is durable; the serverless isolate is not.
 */
import {
  clearBrowserBundle,
  getBrowserStoreId,
  gunzipEnvelope,
  gzipJsonToEnvelope,
  isLiveBrowserBundle,
  loadBrowserBundle,
  mergeBrowserBundles,
  readBrowserMeta,
  requestBrowserPersist,
  saveBrowserBundle,
  sessionLooksLive,
  warehouseHasLiveRivals,
  type BrowserCacheBundle,
  type BrowserCacheMeta,
  type BrowserWarehouse,
  type GzipEnvelope,
} from "./browser-store";
import {
  beginBrowserPull,
  endBrowserPull,
  setBrowserRememberScheduler,
} from "./browser-flag";
import {
  exportBrowserBundle,
  getBrowserCacheStatus,
  hydrateBrowserWarehouse,
} from "./actions";

const MAX_CHUNK = 2_800_000;

let bootPromise: Promise<BrowserCacheMeta | null> | null = null;
let rememberTimer: number | null = null;

type ServerStatus = {
  sample?: boolean;
  hasWarehouse?: boolean;
  hasSession?: boolean;
  hasRivals?: boolean;
  bots?: number;
  userId?: string | null;
  userName?: string | null;
  scrapedAt?: string | null;
  keys?: number;
  rivalCount?: number;
};

function fileEntries(w: BrowserWarehouse | null): Array<[string, unknown]> {
  if (!w?.files) return [];
  return Object.entries(w.files).filter(([, v]) => v != null);
}

async function hydrateChunks(bundle: BrowserCacheBundle): Promise<void> {
  const files = fileEntries(bundle.warehouse);
  if (!files.length && bundle.session) {
    const env = await gzipJsonToEnvelope({
      replace: false,
      session: bundle.session,
      files: sessionLooksLive(bundle.session) ? { "juicy-session.json": bundle.session } : {},
    });
    await hydrateBrowserWarehouse({ data: env });
    return;
  }
  let batch: Record<string, unknown> = {};
  let size = 0;
  let first = true;
  const flush = async () => {
    if (!Object.keys(batch).length && !first) return;
    const env = await gzipJsonToEnvelope({
      replace: first,
      session: first ? bundle.session : null,
      files: batch,
    });
    await hydrateBrowserWarehouse({ data: env });
    first = false;
    batch = {};
    size = 0;
  };
  for (const [key, value] of files) {
    const piece = JSON.stringify(value).length;
    if (size + piece > MAX_CHUNK && Object.keys(batch).length) await flush();
    batch[key] = value;
    size += piece;
  }
  await flush();
}

async function pullServerBundle(): Promise<BrowserCacheBundle | null> {
  const raw = (await exportBrowserBundle()) as GzipEnvelope | BrowserCacheBundle;
  const bundle = await gunzipEnvelope<BrowserCacheBundle>(raw);
  if (!bundle || bundle.format !== "juicy-lounge-browser-cache") return null;
  return bundle;
}

function serverNeedsHydrate(status: ServerStatus, local: BrowserCacheBundle | null): boolean {
  const serverEmpty = !status.hasWarehouse || status.sample;
  const serverNoSession = !status.hasSession;
  const serverNoRivals = !status.hasRivals;
  if (!local) return false;
  if (sessionLooksLive(local.session) && serverNoSession) return true;
  if (warehouseHasLiveRivals(local.warehouse) && serverNoRivals) return true;
  if (isLiveBrowserBundle(local) && serverEmpty) return true;
  return false;
}

async function syncOnce(): Promise<BrowserCacheMeta | null> {
  if (typeof window === "undefined") return null;
  getBrowserStoreId();
  await requestBrowserPersist();
  beginBrowserPull();
  try {
    const local = await loadBrowserBundle();
    const localLive = isLiveBrowserBundle(local);
    let status: ServerStatus = {};
    try {
      status = (await getBrowserCacheStatus()) as ServerStatus;
    } catch {
      status = {};
    }

    if (localLive && serverNeedsHydrate(status, local)) {
      await hydrateChunks(local!);
    } else if (status.hasWarehouse && !status.sample) {
      const remote = await pullServerBundle();
      if (remote) {
        const merged = mergeBrowserBundles(local, remote);
        if (isLiveBrowserBundle(merged)) await saveBrowserBundle(merged);
      }
    } else if (localLive && local) {
      await saveBrowserBundle(local);
    }
    return readBrowserMeta(await loadBrowserBundle());
  } finally {
    endBrowserPull();
  }
}

/** One-shot per tab: restore this browser's lounge onto the current isolate. */
export function browserCacheReady(): Promise<BrowserCacheMeta | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  if (!bootPromise) bootPromise = syncOnce().catch(() => null);
  return bootPromise;
}

export async function rememberBrowserCache(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  beginBrowserPull();
  try {
    const local = await loadBrowserBundle();
    const remote = await pullServerBundle();
    if (!remote) {
      if (local && isLiveBrowserBundle(local)) return saveBrowserBundle(local);
      return false;
    }
    const merged = mergeBrowserBundles(local, remote);
    if (!isLiveBrowserBundle(merged)) return false;
    return saveBrowserBundle(merged);
  } catch {
    return false;
  } finally {
    endBrowserPull();
  }
}

function scheduleRemember() {
  if (typeof window === "undefined") return;
  if (rememberTimer != null) window.clearTimeout(rememberTimer);
  rememberTimer = window.setTimeout(() => {
    rememberTimer = null;
    void rememberBrowserCache();
  }, 250);
}

function flushRemember() {
  if (typeof window === "undefined") return;
  if (rememberTimer != null) {
    window.clearTimeout(rememberTimer);
    rememberTimer = null;
  }
  void rememberBrowserCache();
}

if (typeof window !== "undefined") {
  setBrowserRememberScheduler(scheduleRemember, flushRemember);
  window.addEventListener("pagehide", () => flushRemember());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushRemember();
  });
}

export async function forgetBrowserCache(): Promise<void> {
  bootPromise = null;
  await clearBrowserBundle();
}

export { loadBrowserBundle, readBrowserMeta };
export type { BrowserCacheMeta };
