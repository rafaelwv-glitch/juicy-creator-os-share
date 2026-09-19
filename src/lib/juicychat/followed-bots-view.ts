/**
 * Browser-safe followed-bot helpers. Forensics UI must import this, not the
 * Node scraper (same split as tag-forensics-view).
 */

export const FOLLOWED_BOTS_FILE = "followed-bots.json";
export const MAX_FOLLOWED_BOTS = 40;

export type FollowedBotPoint = {
  date: string;
  scrapedAt: string;
  chats: number;
  likes: number;
  favorites: number;
  comments?: number | null;
  shares?: number | null;
  score10?: number | null;
};

export type FollowedBotIdentity = {
  characterId: string;
  characterName: string;
  characterThumb?: string;
  characterPhoto?: string;
  introduction?: string;
  tags: string[];
  gender?: number;
  rating?: string | number | null;
  userId?: string;
  userName?: string;
  gmtCreate?: string | number;
  gmtFirstPublish?: string | number;
  gmtModified?: string | number;
  visibility?: number | null;
  personality?: string;
  galleryCount?: number;
  memoryCount?: number;
  commentCount?: number | null;
};

export type FollowedBot = {
  characterId: string;
  url: string;
  pinned: boolean;
  addedAt: string;
  lastScrapedAt: string | null;
  lastError?: string | null;
  identity: FollowedBotIdentity;
  latest: FollowedBotPoint | null;
  days: FollowedBotPoint[];
};

export type FollowedBotsFile = {
  version: 1;
  timezone: string;
  bots: FollowedBot[];
};

export type FollowedBotView = FollowedBot & {
  dChats: number | null;
  dLikes: number | null;
  dFavorites: number | null;
  dayCount: number;
};

/** Parse juicychat.ai/chat/{id} or a bare character id. */
export function parseBotLink(input: string): string {
  const s = String(input || "").trim();
  if (!s) return "";
  if (/^\d{6,}$/.test(s)) return s;
  try {
    const u = new URL(s.startsWith("http") ? s : `https://www.juicychat.ai/${s.replace(/^\//, "")}`);
    const m =
      u.pathname.match(/\/chat\/(\d+)/i) ||
      u.pathname.match(/\/character\/(\d+)/i) ||
      u.pathname.match(/\/bot\/(\d+)/i);
    if (m?.[1]) return m[1];
    const q = u.searchParams.get("characterId") || u.searchParams.get("id");
    if (q && /^\d{6,}$/.test(q)) return q;
  } catch {
    /* */
  }
  const m2 = s.match(/\/chat\/(\d+)/i) || s.match(/(\d{15,})/);
  return m2?.[1] || "";
}

export function botChatUrl(characterId: string): string {
  return `https://www.juicychat.ai/chat/${characterId}`;
}

function lastDelta(days: FollowedBotPoint[], key: "chats" | "likes" | "favorites"): number | null {
  if (!days || days.length < 2) return null;
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const a = sorted[sorted.length - 2]!;
  const b = sorted[sorted.length - 1]!;
  return (b[key] ?? 0) - (a[key] ?? 0);
}

export function decorateFollowed(bot: FollowedBot): FollowedBotView {
  const days = [...(bot.days || [])].sort((a, b) => a.date.localeCompare(b.date));
  return {
    ...bot,
    days,
    dChats: lastDelta(days, "chats"),
    dLikes: lastDelta(days, "likes"),
    dFavorites: lastDelta(days, "favorites"),
    dayCount: days.length,
  };
}

export function decorateFollowedList(bots: FollowedBot[]): FollowedBotView[] {
  return [...bots]
    .map(decorateFollowed)
    .sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      const ta = Date.parse(a.lastScrapedAt || a.addedAt) || 0;
      const tb = Date.parse(b.lastScrapedAt || b.addedAt) || 0;
      return tb - ta;
    });
}
