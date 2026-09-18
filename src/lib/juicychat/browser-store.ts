/**
 * Origin-private IndexedDB for JuicyChat session + warehouse.
 * Survives Vercel cold starts. Never shared across visitors.
 * Keep this file free of node:fs / server-only imports.
 */

export const BROWSER_CACHE_FORMAT = "juicy-lounge-browser-cache" as const;
export const BROWSER_CACHE_VERSION = "1.0.0";
export const BROWSER_ID_KEY = "jl_browser_store_id";
export const BROWSER_HEADER = "x-lounge-browser";

const DB_NAME = "juicy-lounge-browser";
const DB_VERSION = 1;
const STORE = "kv";
const BUNDLE_KEY = "bundle";

export type BrowserWarehouse = {
  format?: string;
  version?: string;
  exportedAt?: string;
  timezone?: string;
  credentials?: false;
  account?: { userId?: string; userName?: string; userNo?: string } | null;
  manifest?: {
    bots?: number;
    keys?: string[];
    [k: string]: unknown;
  };
  files?: Record<string, unknown>;
};

export type BrowserSession = {
  cookie: string;
  secretKey?: string;
  distinctId?: string;
  userId?: string;
  userName?: string;
  userNo?: string;
  email?: string;
  loggedInAt?: string;
  source?: string;
};

export type BrowserCacheBundle = {
  format: typeof BROWSER_CACHE_FORMAT;
  version: string;
  savedAt: string;
  persistGranted?: boolean;
  session: BrowserSession | null;
  warehouse: BrowserWarehouse | null;
};

export type BrowserCacheMeta = {
  savedAt: string | null;
  live: boolean;
  hasSession: boolean;
  bots: number;
  userId: string | null;
  userName: string | null;
  persistGranted: boolean;
  keys: number;
};

export type GzipEnvelope = {
  encoding: "gzip-base64";
  payload: string;
};

function sampleishWarehouse(w: BrowserWarehouse | null | undefined): boolean {
  if (!w) return false;
  const id = String(w.account?.userId || "");
  const name = String(w.account?.userName || "");
  if (id === "sample-juicy-user" || id.toLowerCase().startsWith("sample-")) return true;
  if (name === "SampleCreator") return true;
  const snap = w.files?.["last-snapshot.json"] as
    | { userId?: string; profile?: { userId?: string; userName?: string } }
    | undefined;
  const sid = String(snap?.userId || snap?.profile?.userId || "");
  const sname = String(snap?.profile?.userName || "");
  return sid === "sample-juicy-user" || sname === "SampleCreator";
}

export function isLiveBrowserBundle(b: BrowserCacheBundle | null | undefined): boolean {
  if (!b) return false;
  if (b.session?.cookie && b.session.cookie.length > 8) return true;
  if (b.warehouse && !sampleishWarehouse(b.warehouse)) {
    const bots = Number(b.warehouse.manifest?.bots ?? 0);
    const keys = Object.keys(b.warehouse.files || {}).length;
    return bots > 0 || keys > 0;
  }
  return false;
}

export function sanitizeBrowserStoreId(raw: unknown): string | null {
  const s = String(raw || "").trim();
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(s)) return null;
  return s;
}

export function loungeUserIdFromBrowser(id: string): string {
  return `browser-${id}`;
}

export function getBrowserStoreId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const existing = sanitizeBrowserStoreId(window.localStorage.getItem(BROWSER_ID_KEY));
    if (existing) return existing;
    const id =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID().replace(/-/g, "").slice(0, 32)
        : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 14)}`;
    const safe = sanitizeBrowserStoreId(id) || id.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32);
    window.localStorage.setItem(BROWSER_ID_KEY, safe);
    return safe;
  } catch {
    return null;
  }
}

export function withBrowserHeaders(init?: HeadersInit): Headers {
  const headers = new Headers(init);
  const id = getBrowserStoreId();
  if (id) headers.set(BROWSER_HEADER, id);
  return headers;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("indexedDB open failed"));
  });
}

function idbGet<T>(key: string): Promise<T | undefined> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readonly");
        const req = tx.objectStore(STORE).get(key);
        req.onsuccess = () => resolve(req.result as T | undefined);
        req.onerror = () => reject(req.error);
        tx.oncomplete = () => db.close();
      }),
  );
}

function idbSet(key: string, value: unknown): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(value, key);
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      }),
  );
}

function idbDel(key: string): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).delete(key);
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      }),
  );
}

export async function loadBrowserBundle(): Promise<BrowserCacheBundle | null> {
  if (typeof window === "undefined" || typeof indexedDB === "undefined") return null;
  try {
    const raw = await idbGet<BrowserCacheBundle>(BUNDLE_KEY);
    if (!raw || raw.format !== BROWSER_CACHE_FORMAT) return null;
    return raw;
  } catch {
    return null;
  }
}

function slimWarehouse(w: BrowserWarehouse, dropHeavy: boolean): BrowserWarehouse {
  if (!dropHeavy) return w;
  const files = { ...(w.files || {}) };
  delete files["bot-forensics.json"];
  delete files["notification-events.json"];
  delete files["creator-ranklist.json"];
  return {
    ...w,
    files,
    manifest: { ...w.manifest, keys: Object.keys(files).sort() },
  };
}

export async function saveBrowserBundle(bundle: BrowserCacheBundle): Promise<boolean> {
  if (typeof window === "undefined" || typeof indexedDB === "undefined") return false;
  if (!isLiveBrowserBundle(bundle)) return false;
  const persistGranted = await requestBrowserPersist();
  const next: BrowserCacheBundle = {
    ...bundle,
    format: BROWSER_CACHE_FORMAT,
    version: BROWSER_CACHE_VERSION,
    savedAt: bundle.savedAt || new Date().toISOString(),
    persistGranted,
  };
  try {
    await idbSet(BUNDLE_KEY, next);
    return true;
  } catch {
    try {
      const slim: BrowserCacheBundle = {
        ...next,
        warehouse: next.warehouse ? slimWarehouse(next.warehouse, true) : null,
      };
      await idbSet(BUNDLE_KEY, slim);
      return true;
    } catch {
      return false;
    }
  }
}

export async function clearBrowserBundle(): Promise<void> {
  if (typeof window === "undefined" || typeof indexedDB === "undefined") return;
  try {
    await idbDel(BUNDLE_KEY);
  } catch {
    /* */
  }
}

export function readBrowserMeta(bundle: BrowserCacheBundle | null): BrowserCacheMeta {
  const w = bundle?.warehouse;
  const snap = w?.files?.["last-snapshot.json"] as
    | { bots?: unknown[]; userId?: string; profile?: { userId?: string; userName?: string } }
    | undefined;
  return {
    savedAt: bundle?.savedAt || null,
    live: isLiveBrowserBundle(bundle),
    hasSession: Boolean(bundle?.session?.cookie && bundle.session.cookie.length > 8),
    bots: Number(w?.manifest?.bots ?? snap?.bots?.length ?? 0),
    userId: w?.account?.userId || snap?.profile?.userId || snap?.userId || bundle?.session?.userId || null,
    userName: w?.account?.userName || snap?.profile?.userName || bundle?.session?.userName || null,
    persistGranted: Boolean(bundle?.persistGranted),
    keys: w?.manifest?.keys?.length ?? Object.keys(w?.files || {}).length,
  };
}

export async function requestBrowserPersist(): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.storage?.persist) return false;
  try {
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

function bytesToB64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function gzipJsonToEnvelope(value: unknown): Promise<GzipEnvelope> {
  const json = JSON.stringify(value);
  const raw = new TextEncoder().encode(json);
  if (typeof CompressionStream === "undefined") {
    return { encoding: "gzip-base64", payload: bytesToB64(raw) };
  }
  const stream = new Blob([raw as BlobPart]).stream().pipeThrough(new CompressionStream("gzip"));
  const buf = await new Response(stream).arrayBuffer();
  return { encoding: "gzip-base64", payload: bytesToB64(new Uint8Array(buf)) };
}

export async function gunzipEnvelope<T>(env: GzipEnvelope | T): Promise<T> {
  if (!env || typeof env !== "object" || !("encoding" in (env as GzipEnvelope))) {
    return env as T;
  }
  const boxed = env as GzipEnvelope;
  if (boxed.encoding !== "gzip-base64" || typeof boxed.payload !== "string") return env as T;
  const bytes = b64ToBytes(boxed.payload);
  if (typeof DecompressionStream === "undefined") {
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  }
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip"));
  const text = await new Response(stream).text();
  return JSON.parse(text) as T;
}
