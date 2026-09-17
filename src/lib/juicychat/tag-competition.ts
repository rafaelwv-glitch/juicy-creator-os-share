/**
 * Tag competition from every stored source — lounge snapshot tags,
 * last public tag-feed scrape, and tracked rival spaces.
 * Light / cron pulls skip getCharacterListByTag; this still fills the panel.
 */
import type { TagCompetition } from "./deep-signals";
import type { JuicyBot } from "./types";

export type RivalTagBot = {
  characterId: string;
  characterName: string;
  chats: number;
  tags: string[];
  userName?: string;
  userId?: string;
};

export type DeriveTagCompetitionInput = {
  bots?: Array<Pick<JuicyBot, "characterId" | "characterName" | "characterTags" | "chatCount">> | null;
  enrichment?: Array<{ characterId: string; tags?: string[] | null }> | null;
  existing?: TagCompetition[] | null;
  rivalBots?: RivalTagBot[] | null;
  maxTags?: number;
};

function tagKey(t: string) {
  return String(t || "")
    .trim()
    .toLowerCase();
}

function displayTag(t: string) {
  return String(t || "").trim();
}

type MixRow = {
  tag: string;
  bots: number;
  chats: number;
  ownIds: Set<string>;
};

function localMix(
  bots: DeriveTagCompetitionInput["bots"],
  enrichment: DeriveTagCompetitionInput["enrichment"],
): Map<string, MixRow> {
  const map = new Map<string, MixRow>();
  const extra = new Map<string, string[]>();
  for (const e of enrichment || []) {
    if (e.characterId && e.tags?.length) extra.set(e.characterId, e.tags.map(String));
  }
  for (const b of bots || []) {
    const tags = [...(b.characterTags || []), ...(extra.get(b.characterId) || [])];
    const seen = new Set<string>();
    for (const raw of tags) {
      const k = tagKey(raw);
      if (!k || seen.has(k)) continue;
      seen.add(k);
      const cur = map.get(k) || { tag: displayTag(raw), bots: 0, chats: 0, ownIds: new Set() };
      if (displayTag(raw).length > cur.tag.length) cur.tag = displayTag(raw);
      cur.bots += 1;
      cur.chats += b.chatCount ?? 0;
      cur.ownIds.add(b.characterId);
      map.set(k, cur);
    }
  }
  return map;
}

function mergeTop(
  a: TagCompetition["topInTag"],
  b: TagCompetition["topInTag"],
  limit = 6,
): TagCompetition["topInTag"] {
  const map = new Map<string, TagCompetition["topInTag"][number]>();
  for (const row of [...(a || []), ...(b || [])]) {
    const id = String(row.characterId || row.name || "");
    if (!id) continue;
    const prev = map.get(id);
    if (!prev || (row.chats || 0) > (prev.chats || 0)) {
      map.set(id, {
        name: row.name || prev?.name || "—",
        chats: row.chats || 0,
        characterId: row.characterId || prev?.characterId || id,
        from: row.from || prev?.from,
      });
    }
  }
  return [...map.values()].sort((x, y) => y.chats - x.chats).slice(0, limit);
}

export function rivalBotsFromEntries(
  rivals: Array<{
    userId?: string;
    userName?: string;
    lastSnapshot?: { bots?: JuicyBot[] } | null;
  }> | null | undefined,
): RivalTagBot[] {
  const out: RivalTagBot[] = [];
  for (const r of rivals || []) {
    for (const b of r.lastSnapshot?.bots || []) {
      out.push({
        characterId: b.characterId,
        characterName: b.characterName,
        chats: b.chatCount ?? 0,
        tags: (b.characterTags || []).map(String),
        userName: r.userName,
        userId: r.userId,
      });
    }
  }
  return out;
}

/**
 * Merge snapshot tags, last feed scrape, and rival spaces.
 * Never drops a richer feed sample for a poorer local-only row.
 */
export function deriveTagCompetition(input: DeriveTagCompetitionInput): TagCompetition[] {
  const mix = localMix(input.bots, input.enrichment);
  const existing = new Map<string, TagCompetition>();
  for (const row of input.existing || []) {
    const k = tagKey(row.tag);
    if (k) existing.set(k, row);
  }

  const keys = new Set<string>([...mix.keys(), ...existing.keys()]);
  const rows: TagCompetition[] = [];

  for (const k of keys) {
    const local = mix.get(k);
    const prev = existing.get(k);
    const tag = local?.tag || prev?.tag || k;
    const rivalHits = (input.rivalBots || []).filter((b) =>
      (b.tags || []).some((t) => tagKey(t) === k),
    );
    const rivalTop = rivalHits
      .sort((a, b) => b.chats - a.chats)
      .slice(0, 6)
      .map((b) => ({
        name: b.characterName || "—",
        chats: b.chats,
        characterId: b.characterId,
        from: b.userName ? `@${b.userName}` : "rival",
      }));
    const topInTag = mergeTop(prev?.topInTag || [], rivalTop);
    const ownIds = local?.ownIds || new Set<string>();
    let yourBestRank = prev?.yourBestRank ?? null;
    if (yourBestRank == null && ownIds.size && topInTag.length) {
      const idx = topInTag.findIndex((x) => ownIds.has(x.characterId));
      if (idx >= 0) yourBestRank = idx + 1;
    }
    const rivalChats = rivalHits.reduce((s, b) => s + (b.chats || 0), 0);
    rows.push({
      tag,
      yourBots: local?.bots ?? prev?.yourBots ?? 0,
      yourChats: local?.chats ?? prev?.yourChats ?? 0,
      sampleSize: Math.max(prev?.sampleSize ?? 0, topInTag.length),
      topInTag,
      yourBestRank,
      competitionChats: Math.max(prev?.competitionChats ?? 0, rivalChats),
      rivalBots: rivalHits.length,
      rivalChats,
    });
  }

  const limit = input.maxTags ?? 10;
  return rows
    .filter((r) => r.yourBots > 0 || r.topInTag.length > 0)
    .sort((a, b) => b.yourChats - a.yourChats || b.competitionChats - a.competitionChats)
    .slice(0, limit);
}
