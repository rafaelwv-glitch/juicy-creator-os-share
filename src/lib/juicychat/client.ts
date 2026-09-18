import {
  createJuicySecretKey,
  decryptResponsePayload,
  encryptRequestPayload,
} from "./crypto";
import { mergeCookies, type JuicySession } from "./session";
import type { JuicyApiResult } from "./types";
import { GOOGLE_CLIENT_ID as GOOGLE_CLIENT_ID_CONST } from "./constants";

const BASE = "https://www.juicychat.ai";
const APP_VERSION = "0.1.67";

/** JuicyChat's own fallback when Turnstile can't render in the browser. */
export const CF_UNSUPPORTED_TOKEN = "browser-unsupported-cf-turnstile";

/** Re-export for server modules that already import from client. */
export const GOOGLE_CLIENT_ID = GOOGLE_CLIENT_ID_CONST;

export type JuicyClientOptions = {
  cookie?: string;
  secretKey?: string;
  distinctId?: string;
};

export class JuicyClient {
  cookie: string;
  secretKey: string;
  distinctId: string;

  constructor(opts: JuicyClientOptions = {}) {
    this.cookie = opts.cookie ?? "";
    this.secretKey = opts.secretKey ?? createJuicySecretKey();
    this.distinctId =
      opts.distinctId ??
      `19f${Date.now().toString(16)}${Math.random().toString(16).slice(2, 10)}`;
  }

  static fromSession(session: JuicySession | null | undefined) {
    if (!session) return new JuicyClient();
    return new JuicyClient({
      cookie: session.cookie,
      secretKey: session.secretKey,
      distinctId: session.distinctId,
    });
  }

  private headers(extra: Record<string, string> = {}): HeadersInit {
    const h: Record<string, string> = {
      "content-type": "application/json",
      Accept: "application/json, text/plain, */*",
      SecretKey: this.secretKey,
      client: "pc",
      system: "windows64",
      platformType: "web",
      appVersion: APP_VERSION,
      language: "en",
      nsfw: "1",
      voucher: "null",
      utm_source: "null",
      offsetnumber: "0",
      navigatorlang: "en-US",
      distinctId: this.distinctId,
      Origin: BASE,
      Referer: `${BASE}/`,
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      ...extra,
    };
    if (this.cookie) h.Cookie = this.cookie;
    return h;
  }

  private absorbSetCookie(res: Response) {
    const setCookies =
      typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
    if (setCookies.length) {
      this.cookie = mergeCookies(this.cookie, setCookies);
    }
  }

  async post<T = unknown>(path: string, data: unknown = {}): Promise<JuicyApiResult<T>> {
    const body = JSON.stringify({
      requestData: encryptRequestPayload(JSON.stringify(data ?? {})),
    });
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: this.headers(),
      body,
      redirect: "manual",
    });
    this.absorbSetCookie(res);
    const text = await res.text();
    return this.parseBody<T>(text);
  }

  async get<T = unknown>(path: string): Promise<JuicyApiResult<T>> {
    const res = await fetch(`${BASE}${path}`, {
      method: "GET",
      headers: this.headers(),
      redirect: "manual",
    });
    this.absorbSetCookie(res);
    const text = await res.text();
    return this.parseBody<T>(text);
  }

  private parseBody<T>(text: string): JuicyApiResult<T> {
    try {
      const json = JSON.parse(text) as { responseData?: string } & JuicyApiResult<T>;
      if (json.responseData) {
        return JSON.parse(decryptResponsePayload(json.responseData)) as JuicyApiResult<T>;
      }
      return json as JuicyApiResult<T>;
    } catch {
      throw new Error(`JuicyChat API parse failed: ${text.slice(0, 180)}`);
    }
  }

  async requestMagicLinkEmail(
    emailAddress: string,
    cfToken?: string,
  ): Promise<{ ok: boolean; message: string }> {
    const email = emailAddress.trim().toLowerCase();
    if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(email)) {
      return { ok: false, message: "Enter a valid email address." };
    }
    const token = (cfToken && cfToken.trim()) || CF_UNSUPPORTED_TOKEN;
    const result = await this.post<boolean | null>("/yume/api/login/v1/sendRegisterUserEmail", {
      emailAddress: email,
      cfToken: token,
    });
    if (result.success || result.code === "200" || result.data === true) {
      return {
        ok: true,
        message: `Magic link sent to ${email}. Check inbox/spam, then paste the Sign-in link.`,
      };
    }
    return {
      ok: false,
      message: result.msg || `Could not send magic link (code ${result.code || "unknown"}).`,
    };
  }

  async redeemMagicLink(url: string): Promise<{
    ok: boolean;
    message: string;
    finalUrl?: string;
    user?: { userId?: string; userName?: string; userNo?: string };
  }> {
    let target = url.trim();
    if (/^[a-f0-9]{16,64}$/i.test(target)) {
      target = `${BASE}/yume/api/emailLoginBack?param=${target}`;
    }
    if (!target.includes("emailLoginBack")) {
      const match = target.match(/https?:\/\/[^\s"'<>]*emailLoginBack\?param=[a-f0-9]+/i);
      if (match) target = match[0];
    }
    if (!target.includes("emailLoginBack")) {
      const match = url.match(/emailLoginBack\?param=([a-f0-9]+)/i);
      if (match) target = `${BASE}/yume/api/emailLoginBack?param=${match[1]}`;
    }
    if (!target.includes("emailLoginBack")) {
      return {
        ok: false,
        message:
          "Not a JuicyChat magic login link. Paste the full Sign-in URL (or just the param=… token).",
      };
    }

    const res = await fetch(target, {
      method: "GET",
      headers: this.headers({
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      }),
      redirect: "manual",
    });
    this.absorbSetCookie(res);

    let hops = 0;
    let location = res.headers.get("location");
    let finalUrl = target;
    let lastStatus = res.status;
    while (location && hops < 5) {
      const next = location.startsWith("http") ? location : `${BASE}${location}`;
      finalUrl = next;
      const hop = await fetch(next, {
        method: "GET",
        headers: this.headers({
          Accept: "text/html,application/xhtml+xml",
          Referer: finalUrl,
        }),
        redirect: "manual",
      });
      this.absorbSetCookie(hop);
      lastStatus = hop.status;
      location = hop.headers.get("location");
      hops++;
    }

    if (!this.cookie.includes("yume_voucher")) {
      return {
        ok: false,
        message: `Magic link did not set a session cookie (HTTP ${lastStatus}). Link may be expired — request a new one.`,
        finalUrl,
      };
    }

    const me = await this.get<Record<string, unknown> | null>("/yume/api/user/v1/getUserInfo");
    const user = me.data && (me.data as { userId?: string }).userId
      ? (me.data as { userId?: string; userName?: string; userNo?: string })
      : undefined;
    if (user?.userId) {
      const name = user.userName || "account";
      return { ok: true, message: `Logged in as @${name}.`, finalUrl, user };
    }
    if (this.cookie.includes("yume_voucher")) {
      return {
        ok: true,
        message: "Session cookie saved. Pulling lounge…",
        finalUrl,
      };
    }
    return {
      ok: false,
      message:
        "Magic link opened but no session was created (link may be expired or already used). Request a new one.",
      finalUrl,
    };
  }

  async sendEmailCode(emailAddress: string): Promise<{ ok: boolean; message: string }> {
    const email = emailAddress.trim().toLowerCase();
    if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(email)) {
      return { ok: false, message: "Enter a valid email address." };
    }
    const result = await this.post<boolean | null>("/yume/api/login/v1/sendLoginUserCodeByEmail", {
      emailAddress: email,
    });
    if (result.success || result.code === "200" || result.data === true) {
      return { ok: true, message: `Login code sent to ${email}. Check inbox/spam.` };
    }
    return {
      ok: false,
      message: result.msg || `Could not send login code (code ${result.code || "unknown"}).`,
    };
  }

  async loginWithEmailCode(
    emailAddress: string,
    emailCode: string,
  ): Promise<{ ok: boolean; message: string; user?: Record<string, unknown> }> {
    const email = emailAddress.trim().toLowerCase();
    const code = emailCode.trim();
    if (!email || !code) {
      return { ok: false, message: "Email and code are required." };
    }
    const result = await this.post<Record<string, unknown>>("/yume/api/login/v1/appUserLogin", {
      emailAddress: email,
      emailCode: code,
      loginType: "email",
      googleEmail: "",
      googleName: "",
      googlePicture: "",
      discordCode: "",
    });
    if (!result.success && result.code !== "200") {
      return { ok: false, message: result.msg || "Email code login failed." };
    }
    const data = (result.data || {}) as Record<string, unknown>;
    const voucher = typeof data.voucher === "string" ? data.voucher : "";
    if (voucher) {
      this.importCookie(`yume_voucher=${voucher}`);
    }
    const me = await this.get<Record<string, unknown> | null>("/yume/api/user/v1/getUserInfo");
    if (me.data && (me.data as { userId?: string }).userId) {
      const name = (me.data as { userName?: string }).userName || "account";
      return { ok: true, message: `Logged in as @${name}.`, user: me.data as Record<string, unknown> };
    }
    if (this.cookie.includes("yume_voucher")) {
      return { ok: true, message: "Session cookie saved.", user: data };
    }
    return { ok: false, message: result.msg || "Email code did not create a session." };
  }

  async passwordLogin(userNo: string, password: string) {
    const result = await this.post<Record<string, unknown>>("/yume/api/login/v1/userPasswordLogin", {
      userNo: userNo.trim(),
      password,
    });
    if (!result.success && result.code !== "200") {
      return { ok: false as const, message: result.msg || "Login failed", result };
    }
    const me = await this.get<Record<string, unknown> | null>("/yume/api/user/v1/getUserInfo");
    if (me.data && (me.data as { userId?: string }).userId) {
      return { ok: true as const, message: "Logged in.", user: me.data, result };
    }
    return {
      ok: Boolean(this.cookie),
      message: result.msg || (this.cookie ? "Logged in." : "Login response unclear"),
      result,
      user: me.data,
    };
  }

  async googleSignUp(idToken: string) {
    const token = idToken.trim();
    if (!token) return { ok: false as const, message: "Missing Google id token." };
    const result = await this.post<Record<string, unknown>>("/yume/api/login/v1/googleSignUp", {
      idToken: token,
    });
    if (!result.success && result.code !== "200") {
      return { ok: false as const, message: result.msg || "Google sign-in failed", result };
    }
    const me = await this.get<Record<string, unknown> | null>("/yume/api/user/v1/getUserInfo");
    if (me.data && (me.data as { userId?: string }).userId) {
      return {
        ok: true as const,
        message: `Logged in as @${(me.data as { userName?: string }).userName || "you"}.`,
        user: me.data,
        result,
      };
    }
    if (this.cookie.includes("yume_voucher") || this.cookie.length > 20) {
      return { ok: true as const, message: "Google session saved.", user: me.data, result };
    }
    return {
      ok: false as const,
      message: result.msg || "Google sign-in did not create a session.",
      result,
    };
  }

  /** Import a raw Cookie header (from Android WebView CookieManager). */
  importCookie(cookieHeader: string) {
    const parts = cookieHeader
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean);
    this.cookie = mergeCookies(this.cookie, parts);
  }
}

export {
  DEFAULT_LOUNGE_USER_ID,
  DEFAULT_USER_NO,
  DEFAULT_EMAIL,
} from "./constants";
