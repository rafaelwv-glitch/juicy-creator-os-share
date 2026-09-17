import { getDeviceToken } from "@/lib/auth/device-client";
import type { CreatorDashboard } from "./dashboard";

export type CloudRefreshResult = {
  ok: boolean;
  message: string;
  code?: string;
  bots?: number;
  followers?: number;
  publishFired?: number;
  sources?: Record<string, { ok: boolean; detail?: unknown; error?: string }>;
  dashboard?: CreatorDashboard;
  persist?: Record<string, unknown>;
};

/** Same-origin REST pull — cookies + device token. Do not use a server fn here. */
export async function postCloudRefresh(): Promise<CloudRefreshResult> {
  const token = getDeviceToken();
  const headers = new Headers({ "content-type": "application/json", accept: "application/json" });
  if (token) headers.set("x-lounge-device", token);
  const res = await fetch("/api/lounge/refresh", {
    method: "POST",
    credentials: "include",
    headers,
    body: JSON.stringify(token ? { deviceToken: token } : {}),
  });
  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    message?: string;
    error?: string;
    code?: string;
    details?: {
      bots?: number;
      followers?: number;
      publishFired?: number;
      sources?: CloudRefreshResult["sources"];
    };
    dashboard?: CreatorDashboard;
    persist?: Record<string, unknown>;
  };
  const message = data.message || data.error || (res.ok ? "Pulled" : `HTTP ${res.status}`);
  if (res.status === 401) {
    throw new Error(
      data.error && data.error !== "Unauthorized"
        ? data.error
        : "Unauthorized — sign in on this browser, or re-pair the app so the device token is sent.",
    );
  }
  return {
    ok: Boolean(data.ok),
    message,
    code: data.code,
    bots: Number(data.details?.bots ?? 0),
    followers: Number(data.details?.followers ?? 0),
    publishFired: Number(data.details?.publishFired ?? 0),
    sources: data.details?.sources,
    dashboard: data.dashboard,
    persist: data.persist,
  };
}