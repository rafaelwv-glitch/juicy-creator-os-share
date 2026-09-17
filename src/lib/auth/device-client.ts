/** Android companion device token — lives in localStorage, never a JuicyChat cookie. */

const KEY = "jl_device_token";

export function getDeviceToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const v = window.localStorage.getItem(KEY);
    return v && v.trim() ? v.trim() : null;
  } catch {
    return null;
  }
}

export function setDeviceToken(token: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (token && token.trim()) window.localStorage.setItem(KEY, token.trim());
    else window.localStorage.removeItem(KEY);
  } catch {
    /* */
  }
}

/** Capture `#device=` from the Android WebView without sending it to the server. */
export function captureDeviceFromLocation(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const hash = window.location.hash || "";
    const m = /(?:^|#|&)device=([^&]+)/.exec(hash);
    if (m?.[1]) {
      const token = decodeURIComponent(m[1]);
      setDeviceToken(token);
      const clean = hash
        .replace(/^[?#]/, "")
        .split("&")
        .filter((p) => !p.startsWith("device="))
        .join("&");
      const next = `${window.location.pathname}${window.location.search}${clean ? `#${clean}` : ""}`;
      window.history.replaceState(null, "", next);
      return token;
    }
  } catch {
    /* */
  }
  return getDeviceToken();
}

export function isCompanion(): boolean {
  if (typeof window === "undefined") return false;
  if (getDeviceToken()) return true;
  try {
    return new URLSearchParams(window.location.search).get("companion") === "1";
  } catch {
    return false;
  }
}

let fetchPatched = false;
export function installDeviceFetch(): void {
  if (typeof window === "undefined" || fetchPatched) return;
  const orig = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const token = getDeviceToken();
    if (!token) return orig(input, init);
    const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
    if (!headers.has("x-lounge-device")) headers.set("x-lounge-device", token);
    return orig(input, { ...init, headers });
  };
  fetchPatched = true;
}

if (typeof window !== "undefined") {
  captureDeviceFromLocation();
  installDeviceFetch();
}


