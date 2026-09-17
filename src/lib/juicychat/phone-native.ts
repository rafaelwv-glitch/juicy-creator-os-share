/** Android WebView bridge + local phone session (JuicyChat cookie, not Better Auth). */

export type PhoneSession = {
  cookie: string;
  userId?: string;
  userName?: string;
  userNo?: string;
  email?: string;
  source?: string;
  loggedInAt?: string;
};

export type NativePublishJob = {
  id: string;
  characterId: string;
  characterName: string;
  fireAtMs: number;
  status: string;
  result?: string;
  createdAtMs?: number;
  resultAtMs?: number;
};

export type JuicyNativeBridge = {
  startGoogleLogin: () => void;
  cancelGoogleLogin: () => void;
  saveSessionForWidget: (cookie: string, userId: string, userName: string) => void;
  clearSession?: () => void;
  hasPublishScheduler: () => boolean;
  schedulePublish: (characterId: string, characterName: string, fireAtMs: number) => string;
  cancelPublish: (jobId: string) => string;
  listPublishJobs: () => string;
  canScheduleExactAlarms: () => boolean;
  requestBackgroundPermissions: () => void;
  publishNow?: (characterId: string) => string;
  openImportPicker?: () => void;
  uploadBackupToCloud?: (json: string) => string;
  getCloudUrl?: () => string;
};

const SESSION_KEY = "jl_phone_session";
const WEB_JOBS_KEY = "jl_phone_web_jobs";

declare global {
  interface Window {
    JuicyNative?: JuicyNativeBridge;
    __jlApplyGoogleCookie?: (cookie: string) => void;
    __jlPublishResult?: (payload: { ok?: boolean; message?: string; characterId?: string }) => void;
  }
}

export function getJuicyNative(): JuicyNativeBridge | null {
  if (typeof window === "undefined") return null;
  const n = window.JuicyNative;
  return n && typeof n.saveSessionForWidget === "function" ? n : null;
}

export function isNativePhone(): boolean {
  return Boolean(getJuicyNative());
}

export function loadPhoneSession(): PhoneSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PhoneSession;
    if (!parsed?.cookie || parsed.cookie.length < 8) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function persistPhoneSession(session: PhoneSession | null) {
  if (typeof window === "undefined") return;
  try {
    if (!session?.cookie) window.localStorage.removeItem(SESSION_KEY);
    else window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    /* */
  }
  const native = getJuicyNative();
  if (!native) return;
  try {
    if (session?.cookie) {
      native.saveSessionForWidget(session.cookie, session.userId || "", session.userName || "");
    } else if (typeof native.clearSession === "function") {
      native.clearSession();
    } else {
      native.saveSessionForWidget("", "", "");
    }
  } catch {
    /* */
  }
}

export function listNativeJobs(): NativePublishJob[] {
  const native = getJuicyNative();
  if (native) {
    try {
      const raw = native.listPublishJobs();
      const arr = JSON.parse(raw || "[]") as NativePublishJob[];
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(WEB_JOBS_KEY);
    const arr = JSON.parse(raw || "[]") as NativePublishJob[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function scheduleNativeJob(
  characterId: string,
  characterName: string,
  fireAtMs: number,
): NativePublishJob | null {
  const native = getJuicyNative();
  if (native) {
    try {
      const raw = native.schedulePublish(characterId, characterName, fireAtMs);
      const job = JSON.parse(raw || "{}") as NativePublishJob;
      return job?.id ? job : null;
    } catch {
      return null;
    }
  }
  const job: NativePublishJob = {
    id: `web-${Date.now().toString(36)}`,
    characterId,
    characterName,
    fireAtMs,
    status: "preview-only",
    createdAtMs: Date.now(),
  };
  const next = [
    ...listNativeJobs().filter((j) => j.characterId !== characterId || j.status === "done"),
    job,
  ];
  try {
    window.localStorage.setItem(WEB_JOBS_KEY, JSON.stringify(next));
  } catch {
    /* */
  }
  return job;
}

export function cancelNativeJob(jobId: string) {
  const native = getJuicyNative();
  if (native) {
    try {
      native.cancelPublish(jobId);
    } catch {
      /* */
    }
    return;
  }
  try {
    const next = listNativeJobs().filter((j) => j.id !== jobId);
    window.localStorage.setItem(WEB_JOBS_KEY, JSON.stringify(next));
  } catch {
    /* */
  }
}