/**
 * Comment pulse from every stored source — live comment-page samples,
 * bot-detail commentCount, and named comment notifications.
 * Pure: no fs. Cron/light scrapes skip getCommentPage; this still fills the panel.
 */
import type { BotEnrichment, CommentPulse } from "./deep-signals";
import type { JuicyBot } from "./types";

export type CommentPulseComment = {
  characterId?: string;
  characterName?: string;
  kind?: string;
  senderId?: string;
  senderName?: string;
  ts?: number;
};

export type DeriveCommentPulseInput = {
  pulse?: CommentPulse[] | null;
  enrichment?: BotEnrichment[] | null;
  comments?: CommentPulseComment[] | null;
  bots?: Array<Pick<JuicyBot, "characterId" | "characterName">> | null;
  limit?: number;
};

type Acc = {
  characterId: string;
  characterName: string;
  commentsFetched: number;
  approxTotal: number | null;
  likesOnComments: number;
  senders: Set<string>;
};

function takeMax(a: number | null | undefined, b: number | null | undefined): number | null {
  const nums = [a, b].filter((n): n is number => typeof n === "number" && Number.isFinite(n));
  if (!nums.length) return null;
  return Math.max(...nums);
}

/**
 * Merge comment-page samples, enrichment totals, and named notification
 * comments by characterId. Never drops a richer number for a poorer one.
 */
export function deriveCommentPulse(input: DeriveCommentPulseInput): CommentPulse[] {
  const map = new Map<string, Acc>();

  const upsert = (
    id: string | undefined,
    patch: {
      characterName?: string;
      commentsFetched?: number;
      approxTotal?: number | null;
      likesOnComments?: number;
      senderKey?: string;
    },
  ) => {
    const characterId = String(id || "").trim();
    if (!characterId || characterId === "unknown") return;
    let row = map.get(characterId);
    if (!row) {
      row = {
        characterId,
        characterName: patch.characterName || "Untitled",
        commentsFetched: 0,
        approxTotal: null,
        likesOnComments: 0,
        senders: new Set(),
      };
      map.set(characterId, row);
    }
    if (patch.characterName && patch.characterName !== "Untitled" && patch.characterName !== "Unknown") {
      row.characterName = patch.characterName;
    }
    if (typeof patch.commentsFetched === "number" && patch.commentsFetched > row.commentsFetched) {
      row.commentsFetched = patch.commentsFetched;
    }
    row.approxTotal = takeMax(row.approxTotal, patch.approxTotal);
    if (typeof patch.likesOnComments === "number" && patch.likesOnComments > row.likesOnComments) {
      row.likesOnComments = patch.likesOnComments;
    }
    if (patch.senderKey) row.senders.add(patch.senderKey);
  };

  for (const p of input.pulse || []) {
    upsert(p.characterId, {
      characterName: p.characterName,
      commentsFetched: p.commentsFetched,
      approxTotal: p.approxTotal,
      likesOnComments: p.likesOnComments,
    });
  }

  for (const e of input.enrichment || []) {
    if (e.commentCount == null && e.commentSample == null) continue;
    upsert(e.characterId, {
      characterName: e.characterName,
      commentsFetched: e.commentSample ?? 0,
      approxTotal: e.commentCount ?? e.commentSample ?? null,
    });
  }

  const notifByBot = new Map<string, { name: string; n: number; senders: Set<string> }>();
  for (const ev of input.comments || []) {
    if (ev.kind && ev.kind !== "comment") continue;
    const id = String(ev.characterId || "").trim();
    if (!id || id === "unknown") continue;
    let cur = notifByBot.get(id);
    if (!cur) {
      cur = { name: ev.characterName || "", n: 0, senders: new Set() };
      notifByBot.set(id, cur);
    }
    cur.n += 1;
    if (ev.characterName) cur.name = ev.characterName;
    const sender = ev.senderId || ev.senderName;
    if (sender) cur.senders.add(String(sender));
  }
  for (const [id, v] of notifByBot) {
    upsert(id, {
      characterName: v.name,
      commentsFetched: v.n,
      approxTotal: v.n,
    });
    const row = map.get(id);
    if (row) for (const s of v.senders) row.senders.add(s);
  }

  for (const b of input.bots || []) {
    const row = map.get(b.characterId);
    if (row && b.characterName) row.characterName = b.characterName;
  }

  const out: CommentPulse[] = [];
  for (const row of map.values()) {
    const total = row.approxTotal ?? row.commentsFetched;
    if (!(total > 0 || row.likesOnComments > 0)) continue;
    if (row.approxTotal == null && row.commentsFetched > 0) row.approxTotal = row.commentsFetched;
    out.push({
      characterId: row.characterId,
      characterName: row.characterName,
      commentsFetched: row.commentsFetched,
      approxTotal: row.approxTotal,
      likesOnComments: row.likesOnComments,
      uniqueSenders: row.senders.size || undefined,
    });
  }

  out.sort(
    (a, b) =>
      (b.approxTotal ?? b.commentsFetched) - (a.approxTotal ?? a.commentsFetched) ||
      b.commentsFetched - a.commentsFetched ||
      b.likesOnComments - a.likesOnComments,
  );
  return out.slice(0, input.limit ?? 16);
}

export function recentComments<T extends { kind?: string; ts?: number }>(
  comments: T[] | null | undefined,
  limit = 10,
): T[] {
  const list = (comments || []).filter((c) => !c.kind || c.kind === "comment");
  return [...list].sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0)).slice(0, limit);
}
