/**
 * Origin-private IndexedDB for JuicyChat session + warehouse.
 * Survives Vercel cold starts. Never shared across visitors.
 * Keep this file free of node:fs / server-only imports.
 */

export const BROWSER_CACHE_FORMAT = "juicy-lounge-browser-cache" as const;
export const BROWSER_CACHE_VERSION = "1.0.0";
export const BROWSER_ID_KEY = "jl_browser_store_id";
export const BROWSER_SESSION_KEY = "jl_browser_session";
export const BROWSER_RIVALS_KEY = "jl_browser_rivals";
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
  rivalCount: number;
};

export type GzipEnvelope = {
  encoding: "gzip-base64";
  payload: string;
};

export type BrowserBundleIntegrity = {
  hasSession: boolean;
  sessionUserId: string | null;
  sessionUserName: string | null;
  keys: string[];
  keyCount: number;
  rivalIds: string[];
  rivalCount: number;
  live: boolean;
  sampleWarehouse: boolean;
};

type RivalsFileShape = {
  rivals?: Array<{ userId?: string; mrtLog?: unknown[]; history?: unknown[]; mrt?: unknown }>;
  alumni?: Array<{ userId?: string; mrtLog?: unknown[]; history?: unknown[]; mrt?: unknown }>;
};

export function sampleishWarehouse(w: BrowserWarehouse | null | undefined): boolean {
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

function rivalFile(w: BrowserWarehouse | null | undefined): RivalsFileShape | undefined {
  const raw = w?.files?.["rivals-track.json"];
  if (!raw || typeof raw !== "object") return undefined;
  return raw as RivalsFileShape;
}

export function warehouseHasLiveRivals(w: BrowserWarehouse | null | undefined): boolean {
  const f = rivalFile(w);
  return (
    (Array.isArray(f?.rivals) && f.rivals.length > 0) ||
    (Array.isArray(f?.alumni) && f.alumni.length > 0)
  );
}

export function rivalSignal(v: unknown): number {
  if (!v || typeof v !== "object") return 0;
  const f = v as RivalsFileShape;
  let n = 0;
  for (const r of [...(f.rivals || []), ...(f.alumni || [])]) {
    n += 1;
    n += Array.isArray(r.mrtLog) ? r.mrtLog.length : 0;
    n += Array.isArray(r.history) ? r.history.length : 0;
    if (r.mrt) n += 2;
  }
  return n;
}

export function sessionLooksLive(s: BrowserSession | null | undefined): boolean {
  return Boolean(s?.cookie && s.cookie.length > 8);
}

export function isLiveBrowserBundle(b: BrowserCacheBundle | null | undefined): boolean {
  if (!b) return false;
  if (sessionLooksLive(b.session)) return true;
  if (warehouseHasLiveRivals(b.warehouse)) return true;
  if (b.warehouse && !sampleishWarehouse(b.warehouse)) {
    const bots = Number(b.warehouse.manifest?.bots ?? 0);
    const keys = Object.keys(b.warehouse.files || {}).length;
    return bots > 0 || keys > 0;
  }
  return false;
}

/** Merge incoming isolate dump onto durable IDB without dropping login or pins. */
export function mergeBrowserBundles(
  existing: BrowserCacheBundle | null | undefined,
  incoming: BrowserCacheBundle,
): BrowserCacheBundle {
  const session = sessionLooksLive(incoming.session)
    ? incoming.session
    : sessionLooksLive(existing?.session)
      ? existing!.session
      : incoming.session || existing?.session || null;

  const inFiles = { ...(incoming.warehouse?.files || {}) };
  const exFiles = { ...(existing?.warehouse?.files || {}) };
  const files: Record<string, unknown> = { ...exFiles };

  for (const [key, value] of Object.entries(inFiles)) {
    if (value == null) continue;
    if (key === "rivals-track.json") {
      const incomingSignal = rivalSignal(value);
      const existingSignal = rivalSignal(exFiles[key]);
      if (incomingSignal === 0 && existingSignal > 0) {
        // Present-but-empty is a real unpin. Absent key is handled by the loop.
        // Poorer non-empty (partial sample strip) keeps the richer pins.
        const incomingIds = Array.isArray((value as RivalsFileShape).rivals)
          ? (value as RivalsFileShape).rivals!.length
          : 0;
        if (incomingIds === 0 && Array.isArray((value as RivalsFileShape).rivals)) {
          files[key] = value;
        }
        continue;
      }
    }
    if (key === "last-snapshot.json" || key === "creator-dashboard.json") {
      const incomingSample = sampleishWarehouse({
        files: { [key]: value },
        account: incoming.warehouse?.account,
      });
      const existingLive =
        Boolean(exFiles[key]) &&
        !sampleishWarehouse({
          files: { [key]: exFiles[key] },
          account: existing?.warehouse?.account,
        });
      if (incomingSample && existingLive) continue;
    }
    files[key] = value;
  }

  if (!("rivals-track.json" in inFiles) && exFiles["rivals-track.json"]) {
    files["rivals-track.json"] = exFiles["rivals-track.json"];
  }
  if (!("juicy-session.json" in inFiles) && exFiles["juicy-session.json"] && sessionLooksLive(session)) {
    files["juicy-session.json"] = exFiles["juicy-session.json"];
  } else if (sessionLooksLive(session)) {
    files["juicy-session.json"] = session;
  }

  const incomingSample = sampleishWarehouse(incoming.warehouse);
  const existingLiveWh = Boolean(existing?.warehouse) && !sampleishWarehouse(existing?.warehouse);
  const account =
    incomingSample && existingLiveWh
      ? existing!.warehouse!.account
      : incoming.warehouse?.account || existing?.warehouse?.account || null;

  const warehouse: BrowserWarehouse | null =
    incoming.warehouse || existing?.warehouse
      ? {
          ...(existing?.warehouse || {}),
          ...(incoming.warehouse || {}),
          account,
          files,
          manifest: {
            ...(incoming.warehouse?.manifest || existing?.warehouse?.manifest || {}),
            keys: Object.keys(files).sort(),
            bots:
              Number(
                (files["last-snapshot.json"] as { bots?: unknown[] } | undefined)?.bots?.length ??
                  incoming.warehouse?.manifest?.bots ??
                  existing?.warehouse?.manifest?.bots ??
                  0,
              ) || 0,
          },
        }
      : null;

  return {
    format: BROWSER_CACHE_FORMAT,
    version: BROWSER_CACHE_VERSION,
    savedAt: incoming.savedAt || existing?.savedAt || new Date().toISOString(),
    persistGranted: Boolean(incoming.persistGranted || existing?.persistGranted),
    session,
    warehouse,
  };
}

export function browserBundleIntegrity(b: BrowserCacheBundle | null | undefined): BrowserBundleIntegrity {
  const files = b?.warehouse?.files || {};
  const keys = Object.keys(files).sort();
  const rivals = rivalFile(b?.warehouse);
  const rivalIds = [...(rivals?.rivals || []), ...(rivals?.alumni || [])]
    .map((r) => String(r.userId || ""))
    .filter(Boolean);
  return {
    hasSession: sessionLooksLive(b?.session),
    sessionUserId: b?.session?.userId || null,
    sessionUserName: b?.session?.userName || null,
    keys,
    keyCount: keys.length,
    rivalIds,
    rivalCount: rivals?.rivals?.length ?? 0,
    live: isLiveBrowserBundle(b),
    sampleWarehouse: sampleishWarehouse(b?.warehouse),
  };
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

function readJsonStorage<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeJsonStorage(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    if (value == null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota / private mode */
  }
}

function persistLocalFallbacks(bundle: BrowserCacheBundle): void {
  if (sessionLooksLive(bundle.session)) writeJsonStorage(BROWSER_SESSION_KEY, bundle.session);
  const rivals = bundle.warehouse?.files?.["rivals-track.json"];
  if (rivals) writeJsonStorage(BROWSER_RIVALS_KEY, rivals);
}

function overlayLocalFallbacks(bundle: BrowserCacheBundle | null): BrowserCacheBundle | null {
  const session = readJsonStorage<BrowserSession>(BROWSER_SESSION_KEY);
  const rivals = readJsonStorage<unknown>(BROWSER_RIVALS_KEY);
  if (!session && !rivals) return bundle;
  const base: BrowserCacheBundle = bundle || {
    format: BROWSER_CACHE_FORMAT,
    version: BROWSER_CACHE_VERSION,
    savedAt: new Date().toISOString(),
    session: null,
    warehouse: null,
  };
  const files = { ...(base.warehouse?.files || {}) };
  if (!files["rivals-track.json"] && rivals) files["rivals-track.json"] = rivals;
  const nextSession = sessionLooksLive(base.session)
    ? base.session
    : sessionLooksLive(session)
      ? session
      : base.session;
  if (sessionLooksLive(nextSession) && !files["juicy-session.json"]) {
    files["juicy-session.json"] = nextSession;
  }
  return {
    ...base,
    session: nextSession,
    warehouse: Object.keys(files).length
      ? {
          ...(base.warehouse || {}),
          files,
          manifest: { ...base.warehouse?.manifest, keys: Object.keys(files).sort() },
        }
      : base.warehouse,
  };
}

export async function loadBrowserBundle(): Promise<BrowserCacheBundle | null> {
  if (typeof window === "undefined" || typeof indexedDB === "undefined") return null;
  try {
    const raw = await idbGet<BrowserCacheBundle>(BUNDLE_KEY);
    const fromIdb = raw && raw.format === BROWSER_CACHE_FORMAT ? raw : null;
    return overlayLocalFallbacks(fromIdb);
  } catch {
    return overlayLocalFallbacks(null);
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
  let existing: BrowserCacheBundle | null = null;
  try {
    const raw = await idbGet<BrowserCacheBundle>(BUNDLE_KEY);
    existing = raw && raw.format === BROWSER_CACHE_FORMAT ? raw : null;
  } catch {
    existing = null;
  }
  existing = overlayLocalFallbacks(existing);
  const next = mergeBrowserBundles(existing, bundle);
  if (!isLiveBrowserBundle(next)) return false;
  const persistGranted = await requestBrowserPersist();
  const saved: BrowserCacheBundle = {
    ...next,
    format: BROWSER_CACHE_FORMAT,
    version: BROWSER_CACHE_VERSION,
    savedAt: next.savedAt || new Date().toISOString(),
    persistGranted,
  };
  persistLocalFallbacks(saved);
  try {
    await idbSet(BUNDLE_KEY, saved);
    return true;
  } catch {
    try {
      const slim: BrowserCacheBundle = {
        ...saved,
        warehouse: saved.warehouse ? slimWarehouse(saved.warehouse, true) : null,
      };
      await idbSet(BUNDLE_KEY, slim);
      persistLocalFallbacks(slim);
      return true;
    } catch {
      return sessionLooksLive(saved.session) || warehouseHasLiveRivals(saved.warehouse);
    }
  }
}

export async function clearBrowserBundle(): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    if (typeof indexedDB !== "undefined") await idbDel(BUNDLE_KEY);
  } catch {
    /* */
  }
  try {
    window.localStorage.removeItem(BROWSER_SESSION_KEY);
    window.localStorage.removeItem(BROWSER_RIVALS_KEY);
  } catch {
    /* */
  }
}

export function readBrowserMeta(bundle: BrowserCacheBundle | null): BrowserCacheMeta {
  const w = bundle?.warehouse;
  const snap = w?.files?.["last-snapshot.json"] as
    | { bots?: unknown[]; userId?: string; profile?: { userId?: string; userName?: string } }
    | undefined;
  const rivals = rivalFile(w);
  return {
    savedAt: bundle?.savedAt || null,
    live: isLiveBrowserBundle(bundle),
    hasSession: sessionLooksLive(bundle?.session),
    bots: Number(w?.manifest?.bots ?? snap?.bots?.length ?? 0),
    userId: w?.account?.userId || snap?.profile?.userId || snap?.userId || bundle?.session?.userId || null,
    userName: w?.account?.userName || snap?.profile?.userName || bundle?.session?.userName || null,
    persistGranted: Boolean(bundle?.persistGranted),
    keys: w?.manifest?.keys?.length ?? Object.keys(w?.files || {}).length,
    rivalCount: rivals?.rivals?.length ?? 0,
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
