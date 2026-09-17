import { genericOAuthClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { GROK_PROVIDERS } from "./providers";

export const authClient = createAuthClient({
  plugins: [genericOAuthClient()],
  fetchOptions: {
    onRequest(ctx) {
      const token = getBearerToken();
      if (token) ctx.headers.set("Authorization", `Bearer ${token}`);
      return ctx;
    },
    onSuccess(ctx) {
      // Prefer the signed `set-auth-token` header (token.signature). The JSON
      // body only has the unsigned id — storing that overwrites a working
      // bearer and live-preview email login silently bounces back to /login.
      try {
        const header = ctx.response.headers.get("set-auth-token");
        if (header) setBearerToken(header);
      } catch {
        /* */
      }
    },
  },
});

export const authEnabled = import.meta.env.VITE_AUTH_ENABLED === "true";

export { GROK_PROVIDERS };

const BEARER_KEY = "grok-auth.bearer-token";
const POPUP_STORAGE_KEY = "grok-auth-popup-result";
const POPUP_CHANNEL = "grok-auth-popup";
/** Opener saw a cookie session from the popup; do not send this as Bearer. */
const COOKIE_SENTINEL = "__jl_cookie_session__";

export function getBearerToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(BEARER_KEY);
  } catch {
    return null;
  }
}

export function setBearerToken(token: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (token) window.sessionStorage.setItem(BEARER_KEY, token);
    else window.sessionStorage.removeItem(BEARER_KEY);
  } catch {
    /* */
  }
}

/** Keep the longer (signed) token if we already have one. */
export function captureSessionToken(token: string | null | undefined): void {
  if (!token || token.length < 8) return;
  const existing = getBearerToken();
  if (existing && existing.length >= token.length) return;
  setBearerToken(token);
}

function oauthMode(): "popup" | "redirect" {
  if (typeof window === "undefined") return "popup";
  try {
    const q = new URLSearchParams(window.location.search).get("oauth");
    if (q === "redirect") return "redirect";
  } catch {
    /* */
  }
  return "popup";
}

type PopupMessage = { source: "grok-auth-popup"; token: string | null; error?: string };

export async function signIn(
  providerId: string,
  opts: { callbackURL?: string; errorCallbackURL?: string } = {},
): Promise<void> {
  const callbackURL = opts.callbackURL ?? "/";
  const errorCallbackURL = opts.errorCallbackURL ?? "/login";

  // Never await before window.open — the popup must spawn on the user gesture.
  setBearerToken(null);

  const mode = oauthMode();
  if (mode === "popup") {
    const handoffId = crypto.randomUUID();
    const popup = openSignInPopup(providerId, handoffId);
    if (popup) {
      const token = await waitForPopupToken(popup, handoffId);
      if (token && token !== COOKIE_SENTINEL) setBearerToken(token);
      window.location.assign(callbackURL);
      return;
    }
    // Pop-up blocked (or window.open returned null). Fall through to redirect.
  }

  const { data, error } = await authClient.signIn.oauth2({
    providerId,
    callbackURL,
    errorCallbackURL,
  });
  if (error) {
    throw new Error(error.message || `Google / X sign-in failed (${error.status ?? "?"})`);
  }
  if (data?.url) {
    window.location.assign(data.url);
    // Hang so callers cannot assign("/") and wipe the Google navigation.
    await new Promise<void>(() => {});
    return;
  }
  throw new Error("Google / X did not return a sign-in URL. Try email below.");
}

function openSignInPopup(providerId: string, handoffId: string): Window | null {
  const origin = window.location.origin;
  const url = `${origin}/auth/popup?providerId=${encodeURIComponent(providerId)}&handoff=${encodeURIComponent(handoffId)}`;
  const popup = window.open(
    url,
    "jl-oauth-signin",
    "popup=yes,width=520,height=720,scrollbars=yes,resizable=yes",
  );
  try {
    popup?.focus();
  } catch {
    /* */
  }
  return popup;
}

function readPopupPayload(raw: unknown): PopupMessage | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as PopupMessage;
  if (data.source !== "grok-auth-popup") return null;
  return data;
}

function waitForPopupToken(popup: Window, handoffId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const origin = window.location.origin;
    let settled = false;
    let bc: BroadcastChannel | null = null;
    let closeHits = 0;
    let sessionPolls = 0;

    const settle = (msg: { token?: string | null; error?: string }) => {
      if (settled) return;
      if (!msg.token && !msg.error) return;
      settled = true;
      cleanup();
      try {
        localStorage.removeItem(POPUP_STORAGE_KEY);
      } catch {
        /* */
      }
      if (msg.token) {
        resolve(msg.token);
        return;
      }
      reject(
        new Error(
          msg.error || "Sign-in was cancelled. Keep the Google window open until it finishes.",
        ),
      );
    };

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== origin) return;
      const data = readPopupPayload(event.data);
      if (data) settle(data);
    };

    const consumeStorage = () => {
      try {
        const raw = localStorage.getItem(POPUP_STORAGE_KEY);
        if (!raw) return;
        const data = readPopupPayload(JSON.parse(raw));
        if (data) settle(data);
      } catch {
        /* */
      }
    };

    const pollServer = async () => {
      try {
        const r = await fetch(`/auth/popup/handoff?id=${encodeURIComponent(handoffId)}`, {
          cache: "no-store",
        });
        if (!r.ok) return;
        const j = (await r.json()) as {
          pending?: boolean;
          token?: string | null;
          error?: string;
          source?: string;
        };
        if (j.pending) return;
        settle({ token: j.token ?? null, error: j.error });
      } catch {
        /* */
      }
    };

    const pollDom = () => {
      try {
        const el = popup.document.getElementById("grok-auth-popup-msg");
        const text = el?.textContent;
        if (!text) return;
        const data = readPopupPayload(JSON.parse(text));
        if (data) settle(data);
      } catch {
        /* still on Google */
      }
    };

    const pollSession = async () => {
      sessionPolls += 1;
      // Skip the first couple of ticks so a stale cookie cannot "succeed"
      // before Google has even loaded.
      if (sessionPolls < 4) return;
      try {
        const r = await fetch("/api/auth/get-session", {
          cache: "no-store",
          credentials: "include",
        });
        if (!r.ok) return;
        const j = (await r.json()) as { user?: { id?: string } | null };
        if (j?.user?.id) settle({ token: getBearerToken() || COOKIE_SENTINEL });
      } catch {
        /* */
      }
    };

    const pollClosed = () => {
      try {
        if (!popup.closed) {
          closeHits = 0;
          return;
        }
      } catch {
        closeHits += 1;
      }
      closeHits += 1;
      // Browsers flicker `closed` during the 302 to Google — require a streak.
      if (closeHits >= 4) {
        settle({
          token: null,
          error: "Sign-in window was closed before Google finished. Try again, or use email.",
        });
      }
    };

    function cleanup() {
      window.clearInterval(timer);
      window.clearTimeout(timeout);
      window.removeEventListener("message", onMessage);
      window.removeEventListener("storage", onStorage);
      try {
        bc?.close();
      } catch {
        /* */
      }
    }

    function onStorage(event: StorageEvent) {
      if (event.key !== POPUP_STORAGE_KEY || !event.newValue) return;
      try {
        const data = readPopupPayload(JSON.parse(event.newValue));
        if (data) settle(data);
      } catch {
        /* */
      }
    }

    try {
      localStorage.removeItem(POPUP_STORAGE_KEY);
    } catch {
      /* */
    }
    try {
      bc = new BroadcastChannel(POPUP_CHANNEL);
      bc.onmessage = (event) => {
        const data = readPopupPayload(event.data);
        if (data) settle(data);
      };
    } catch {
      bc = null;
    }

    window.addEventListener("message", onMessage);
    window.addEventListener("storage", onStorage);
    const timer = window.setInterval(() => {
      consumeStorage();
      pollDom();
      pollClosed();
      void pollServer();
      void pollSession();
    }, 400);
    const timeout = window.setTimeout(() => {
      settle({
        token: null,
        error: "Google sign-in timed out. Complete it in the pop-up, or use email below.",
      });
    }, 180000);

    consumeStorage();
    void pollServer();
  });
}

export async function signOut(redirectTo = "/login"): Promise<void> {
  try {
    await authClient.signOut();
  } finally {
    setBearerToken(null);
  }
  window.location.assign(redirectTo);
}
