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
  readBrowserMeta,
  requestBrowserPersist,
  saveBrowserBundle,
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
  bots?: number;
  userId?: string | null;
  userName?: string | null;
  scrapedAt?: string | null;
  keys?: number;
};

function fileEntries(w: BrowserWarehouse | null): Array<[string, unknown]> {
  if (!w?.files) return [];
  return Object.entries(w.files).filter(([, v]) => v != null);
}

async function hydrateChunks(bundle: BrowserCacheBundle): Promise<void> {
  const files = fileEntries(bundle.warehouse);
  if (!files.length && bundle.session) {
    const env = await gzipJsonToEnvelope({
      replace: true,
      session: bundle.session,
      files: {},
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
    const serverEmpty = !status.hasWarehouse || status.sample;
    const serverNoSession = !status.hasSession;

    if (localLive && (serverEmpty || (local?.session && serverNoSession))) {
      await hydrateChunks(local!);
    } else if (status.hasWarehouse && !status.sample) {
      const remote = await pullServerBundle();
      if (isLiveBrowserBundle(remote) && remote) await saveBrowserBundle(remote);
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
    const remote = await pullServerBundle();
    if (!isLiveBrowserBundle(remote) || !remote) return false;
    return saveBrowserBundle(remote);
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
  }, 900);
}

if (typeof window !== "undefined") {
  setBrowserRememberScheduler(scheduleRemember);
}

export async function forgetBrowserCache(): Promise<void> {
  bootPromise = null;
  await clearBrowserBundle();
}

export { loadBrowserBundle, readBrowserMeta };
export type { BrowserCacheMeta };
