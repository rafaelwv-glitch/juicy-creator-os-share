/**
 * JuicyChat character review → release queue.
 *
 * From juicychat.ai frontend (index bundle):
 *   auditType 10 = Under Review
 *   auditType 15 = Pending release (approved, not live) → Publish now
 *   auditType 20 = Rejected
 *   auditType  0 = live / idle (display may use auditAfterType)
 *
 * Trigger that actually publishes an approved bot:
 *   POST /yume/api/user/v1/character/userPublishCharacter
 *   body: { characterId }
 *   (sets gmtFirstPublish; site toast "Published successfully")
 */
import { JuicyClient } from "./client";
import { scrapeLounge } from "./scrape";
import { loadSession } from "./session";
import type { JuicyBot, LoungeSnapshot } from "./types";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dataPath, ensureDataDir } from "./paths";

export const AUDIT = {
  LIVE: 0,
  UNDER_REVIEW: 10,
  PENDING_RELEASE: 15,
  REJECTED: 20,
} as const;

export type PublishStatus =
  | "pending_release"
  | "under_review"
  | "rejected"
  | "live"
  | "taken_private"
  | "draft";

export type PublishQueueRow = {
  characterId: string;
  characterName: string;
  characterThumb?: string;
  visibility: number | null;
  visibilityLabel: string;
  auditType: number | null;
  auditAfterType: number | null;
  status: PublishStatus;
  statusLabel: string;
  gmtCreate?: string | number;
  gmtFirstPublish?: string | number;
  chats: number;
  canPublish: boolean;
  tags: string[];
  genre: string | null;
  topic: string | null;
  introduction?: string | null;
  rating?: string | null;
};

export type PublishQueue = {
  scrapedAt: string;
  pending: PublishQueueRow[];
  review: PublishQueueRow[];
  rejected: PublishQueueRow[];
  drafts: PublishQueueRow[];
  takenPrivate: PublishQueueRow[];
  liveCount: number;
  total: number;
  warnings: string[];
};

export type PublishResult = {
  characterId: string;
  characterName: string;
  ok: boolean;
  message: string;
};

function visLabel(v: number | null | undefined) {
  if (v === 2) return "public";
  if (v === 1) return "unlisted";
  if (v === 0) return "private";
  return "unknown";
}

export function classifyBot(bot: JuicyBot): PublishStatus {
  const audit = bot.auditType;
  if (audit === AUDIT.UNDER_REVIEW) return "under_review";
  if (audit === AUDIT.PENDING_RELEASE) return "pending_release";
  if (audit === AUDIT.REJECTED) return "rejected";
  const published = bot.gmtFirstPublish != null && bot.gmtFirstPublish !== "";
  if (!published) return "draft";
  if (bot.visibility === 0 || bot.visibility === 1) return "taken_private";
  return "live";
}

function statusLabel(s: PublishStatus): string {
  switch (s) {
    case "pending_release":
      return "Pending release (approved)";
    case "under_review":
      return "Under review";
    case "rejected":
      return "Rejected";
    case "live":
      return "Live";
    case "taken_private":
      return "Was published · now private/unlisted";
    default:
      return "Draft (not submitted / not approved)";
  }
}

export function toQueueRow(bot: JuicyBot): PublishQueueRow {
  const status = classifyBot(bot);
  return {
    characterId: bot.characterId,
    characterName: bot.characterName,
    characterThumb: bot.characterThumb,
    visibility: bot.visibility ?? null,
    visibilityLabel: visLabel(bot.visibility),
    auditType: bot.auditType ?? null,
    auditAfterType: bot.auditAfterType ?? null,
    status,
    statusLabel: statusLabel(status),
    gmtCreate: bot.gmtCreate,
    gmtFirstPublish: bot.gmtFirstPublish,
    chats: bot.chatCount || 0,
    canPublish: status === "pending_release",
    tags: (bot.characterTags || []).map(String).filter(Boolean),
    genre: (bot.characterTags && bot.characterTags[0]) || null,
    topic: String(bot.introduction || bot.personality || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 280) || null,
    introduction: bot.introduction ? String(bot.introduction).slice(0, 280) : null,
    rating: bot.rating != null ? String(bot.rating) : null,
  };
}

export function buildQueue(bots: JuicyBot[], scrapedAt?: string): PublishQueue {
  const rows = bots.map(toQueueRow);
  return {
    scrapedAt: scrapedAt || new Date().toISOString(),
    pending: rows.filter((r) => r.status === "pending_release"),
    review: rows.filter((r) => r.status === "under_review"),
    rejected: rows.filter((r) => r.status === "rejected"),
    drafts: rows.filter((r) => r.status === "draft"),
    takenPrivate: rows.filter((r) => r.status === "taken_private"),
    liveCount: rows.filter((r) => r.status === "live").length,
    total: rows.length,
    warnings: [],
  };
}

function loadSnapshotFile(): LoungeSnapshot | null {
  try {
    const p = dataPath("last-snapshot.json");
    if (!existsSync(p)) return null;
    return JSON.parse(readFileSync(p, "utf8")) as LoungeSnapshot;
  } catch {
    return null;
  }
}

export function loadPublishQueueCached(): PublishQueue {
  const snap = loadSnapshotFile();
  if (!snap?.bots) {
    return buildQueue([]);
  }
  return buildQueue(snap.bots, snap.scrapedAt);
}

export async function refreshPublishQueue(): Promise<PublishQueue> {
  const session = loadSession();
  const userId = session?.userId || "";
  if (!userId) {
    const cached = loadPublishQueueCached();
    cached.warnings = ["Not logged in — connect JuicyChat first."];
    return cached;
  }
  const snap = await scrapeLounge({ userId, forceAuth: true });
  try {
    ensureDataDir();
    writeFileSync(dataPath("last-snapshot.json"), JSON.stringify(snap), "utf8");
  } catch {
    /* */
  }
  const q = buildQueue(snap.bots || [], snap.scrapedAt);
  q.warnings = snap.warnings || [];
  return q;
}

export async function publishCharacters(
  characterIds: string[],
): Promise<{ results: PublishResult[]; queue: PublishQueue }> {
  const session = loadSession();
  if (!session?.cookie) throw new Error("Not logged in — connect JuicyChat first.");
  const client = JuicyClient.fromSession(session);
  const snap = loadSnapshotFile();
  const byId = new Map((snap?.bots || []).map((b) => [b.characterId, b]));
  const results: PublishResult[] = [];

  for (const id of characterIds) {
    const bot = byId.get(id);
    const name = bot?.characterName || id;
    try {
      const r = await client.post<unknown>("/yume/api/user/v1/character/userPublishCharacter", {
        characterId: id,
      });
      const ok = Boolean(r.success || r.code === "200");
      results.push({
        characterId: id,
        characterName: name,
        ok,
        message: ok ? "Published" : String(r.msg || r.code || "failed"),
      });
    } catch (e) {
      results.push({
        characterId: id,
        characterName: name,
        ok: false,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const queue = await refreshPublishQueue();
  return { results, queue };
}
