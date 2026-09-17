/** Optional defaults — left empty for clean builds (user enters their own). */
export const DEFAULT_LOUNGE_USER_ID = "";
export const DEFAULT_USER_NO = "";
export const DEFAULT_EMAIL = "";
/** Cloudflare Turnstile sitekey used by juicychat.ai login */
export const TURNSTILE_SITE_KEY = "0x4AAAAAABlVjKJdtrV0Ppi0";
/** JuicyChat Google OAuth client ID (used by GIS + android WebView OAuth). */
export const GOOGLE_CLIENT_ID =
  "1050354327719-ugsprd667nr00io299kktkipa89ffi44.apps.googleusercontent.com";

/** Production cloud lounge. Android posts schedules, session, and JSON restores here. */
export const CLOUD_LOUNGE_URL = "https://juicy-creator-os.vercel.app";
export const CLOUD_PULL_TIMEZONE = "Europe/Madrid";
export const CLOUD_PULL_TIMES = ["05:00", "23:55"] as const;
