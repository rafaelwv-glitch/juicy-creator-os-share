/**
 * Optional GitHub JSON backup. Disabled on this shareable clone so it never
 * reads or writes the private original `lounge-data` branch.
 */
import { existsSync, writeFileSync } from "node:fs";
import { collectBackup } from "./backup";
import { applyBackup } from "./backup";
import { openJson, sealJson } from "./secret-box";
import { dataPath, ensureDataDir } from "./paths";

const OWNER = "rafaelwv-glitch";
const REPO = "juicy-creator-os";
const BRANCH = "lounge-data";

function token(): string {
  return "";
}

async function gh(path: string, init?: RequestInit) {
  const t = token();
  if (!t) return null;
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${t}`,
      "x-github-api-version": "2022-11-28",
      ...(init?.headers || {}),
    },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    console.warn("[github-kv]", res.status, await res.text().catch(() => ""));
    return null;
  }
  return res.json() as Promise<Record<string, unknown>>;
}

export async function pullUserBackupFromGitHub(userId: string): Promise<boolean> {
  const file = await gh(
    `/repos/${OWNER}/${REPO}/contents/users/${encodeURIComponent(userId)}/backup.json?ref=${BRANCH}`,
  );
  const content = typeof file?.content === "string" ? file.content : "";
  if (!content) return false;
  try {
    const json = JSON.parse(Buffer.from(content.replace(/\n/g, ""), "base64").toString("utf8"));
    if (json?.session) json.session = openJson(json.session);
    applyBackup(json);
    return true;
  } catch (e) {
    console.warn("[github-kv] parse failed", e);
    return false;
  }
}

export async function pullLatestReportSnapshot(): Promise<boolean> {
  const file = await gh(`/repos/${OWNER}/${REPO}/contents/reports/latest.json`);
  const content = typeof file?.content === "string" ? file.content : "";
  if (!content) return false;
  try {
    if (existsSync(dataPath("creator-dashboard.json"))) return false;
    const report = JSON.parse(Buffer.from(content.replace(/\n/g, ""), "base64").toString("utf8")) as {
      generatedAt?: string;
      creator?: { userId?: string; userName?: string };
      kpis?: unknown;
    };
    ensureDataDir();
    const dash = {
      scrapedAt: report.generatedAt || new Date().toISOString(),
      snapshot: {
        authenticated: true,
        userId: report.creator?.userId || "",
        profile: { userId: report.creator?.userId, userName: report.creator?.userName },
        bots: [],
        source: "cache",
      },
      growth: { kpis: report.kpis || null },
      deep: null,
      insights: null,
      timing: null,
      publish: null,
      rivals: { file: { rivals: [] }, compare: null },
      warnings: ["Recovered from GitHub reports/latest.json — run Refresh in cloud for a live scrape."],
      source: "cache",
    };
    writeFileSync(dataPath("creator-dashboard.json"), JSON.stringify(dash), "utf8");
    return true;
  } catch (e) {
    console.warn("[github-kv] latest report parse failed", e);
    return false;
  }
}

export async function pushUserBackupToGitHub(userId: string): Promise<void> {
  const t = token();
  if (!t || !userId) return;
  const { loadSession } = await import("./session");
  if (!loadSession()?.cookie) {
    // Never overwrite a durable GitHub backup with a session-less snapshot
    // from a cold Vercel isolate that failed to hydrate.
    return;
  }
  const backup = collectBackup({ includeSession: true }) as Record<string, unknown>;
  if (backup.session) backup.session = sealJson(backup.session);
  const body = JSON.stringify(backup, null, 2);
  const path = `users/${userId}/backup.json`;
  const existing = await gh(
    `/repos/${OWNER}/${REPO}/contents/${path}?ref=${BRANCH}`,
  );
  const sha = typeof existing?.sha === "string" ? existing.sha : undefined;
  await gh(`/repos/${OWNER}/${REPO}/contents/${path}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      message: `chore(lounge-data): user ${userId.slice(0, 8)} [skip vercel]`,
      content: Buffer.from(body, "utf8").toString("base64"),
      branch: BRANCH,
      sha,
    }),
  });
}
