/**
 * Follow public JuicyChat bots by /chat/{id} URL. Warehouse file + daily scrape.
 * Server-only (fs). UI imports types from followed-bots-view.ts.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dataPath, ensureDataDir } from "./paths";
import { JuicyClient } from "./client";
import { loadSession } from "./session";
import { characterFromApi } from "./scrape";
import { dayKey } from "./history";
import { loungeTimezone } from "./timezone-server";
import {
  MAX_FOLLOWED_BOTS,
  botChatUrl,
  parseBotLink,
  type FollowedBot,
  type FollowedBotIdentity,
  type FollowedBotPoint,
  type FollowedBotsFile,
} from "./followed-bots-view";

export {
  FOLLOWED_BOTS_FILE,
  MAX_FOLLOWED_BOTS,
  botChatUrl,
  parseBotLink,
  decorateFollowed,
  decorateFollowedList,
} from "./followed-bots-view";
export type {
  FollowedBot,
  FollowedBotIdentity,
  FollowedBotPoint,
  FollowedBotView,
  FollowedBotsFile,
} from "./followed-bots-view";

const FILE = "followed-bots.json";
const MAX_DAYS = 400;

function emptyFile(): FollowedBotsFile {
  return { version: 1, timezone: loungeTimezone(), bots: [] };
}

export function loadFollowedBots(): FollowedBotsFile {
  try {
    const p = dataPath(FILE);
    if (!existsSync(p)) return emptyFile();
    const raw = JSON.parse(readFileSync(p, "utf8")) as FollowedBotsFile;
    if (!raw || !Array.isArray(raw.bots)) return emptyFile();
    return {
      version: 1,
      timezone: raw.timezone || loungeTimezone(),
      bots: raw.bots.filter((b) => b && b.characterId).slice(0, MAX_FOLLOWED_BOTS),
    };
  } catch {
    return emptyFile();
  }
}

export function saveFollowedBots(file: FollowedBotsFile): FollowedBotsFile {
  ensureDataDir();
  const next: FollowedBotsFile = {
    version: 1,
    timezone: loungeTimezone(),
    bots: (file.bots || []).slice(0, MAX_FOLLOWED_BOTS),
  };
  writeFileSync(dataPath(FILE), JSON.stringify(next), "utf8");
  return next;
}

function asNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function unwrapDetail(data: unknown): Record<string, unknown> | null {
  if (!data || typeof data !== "object") return null;
  const o = data as Record<string, unknown>;
  if (o.character && typeof o.character === "object") return o.character as Record<string, unknown>;
  if (o.characterId) return o;
  return o;
}

function identityFromBot(
  bot: NonNullable<ReturnType<typeof characterFromApi>>,
  extra?: { commentCount?: number | null },
): FollowedBotIdentity {
  return {
    characterId: bot.characterId,
    characterName: bot.characterName,
    characterThumb: bot.characterThumb,
    characterPhoto: bot.characterPhoto,
    introduction: bot.introduction,
    tags: bot.characterTags || [],
    gender: bot.gender,
    rating: bot.rating ?? null,
    userId: bot.userId,
    userName: bot.userName,
    gmtCreate: bot.gmtCreate,
    gmtFirstPublish: bot.gmtFirstPublish,
    gmtModified: bot.gmtModified,
    visibility: bot.visibility ?? null,
    personality: bot.personality,
    galleryCount: bot.galleryCount,
    memoryCount: bot.memoryCount,
    commentCount: extra?.commentCount ?? null,
  };
}

function pointFromBot(
  bot: NonNullable<ReturnType<typeof characterFromApi>>,
  extra?: { commentCount?: number | null },
  scrapedAt = new Date().toISOString(),
): FollowedBotPoint {
  return {
    date: dayKey(scrapedAt),
    scrapedAt,
    chats: bot.chatCount ?? 0,
    likes: bot.likeCount ?? 0,
    favorites: bot.favoriteCount ?? 0,
    comments: extra?.commentCount ?? null,
    shares: bot.shareCount ?? null,
    score10: bot.score10 ?? null,
  };
}

function upsertDay(days: FollowedBotPoint[], point: FollowedBotPoint): FollowedBotPoint[] {
  const rest = (days || []).filter((d) => d.date !== point.date);
  rest.push(point);
  rest.sort((a, b) => a.date.localeCompare(b.date));
  return rest.slice(-MAX_DAYS);
}

export async function fetchPublicBot(characterId: string): Promise<{
  identity: FollowedBotIdentity;
  point: FollowedBotPoint;
}> {
  const id = String(characterId || "").trim();
  if (!/^\d{6,}$/.test(id)) throw new Error("Not a JuicyChat bot id");
  const client = JuicyClient.fromSession(loadSession());
  const res = await client.post<unknown>("/yume/api/user/v1/character/getCharacterDetail", {
    characterId: id,
  });
  if (!(res.success || res.code === "200")) {
    throw new Error(res.msg || `JuicyChat detail failed (${res.code || "unknown"})`);
  }
  const raw = unwrapDetail(res.data);
  if (!raw) throw new Error("Empty character payload");
  const mapped = characterFromApi(raw);
  if (!mapped) throw new Error("Could not read that bot card");
  const commentCount =
    asNum(raw.commentCount) ?? asNum((raw as { commentTotal?: unknown }).commentTotal);
  const scrapedAt = new Date().toISOString();
  return {
    identity: identityFromBot(mapped, { commentCount }),
    point: pointFromBot(mapped, { commentCount }, scrapedAt),
  };
}

function applyFetch(existing: FollowedBot | null, characterId: string, fetched: {
  identity: FollowedBotIdentity;
  point: FollowedBotPoint;
}, pinned: boolean): FollowedBot {
  const prev = existing;
  return {
    characterId,
    url: botChatUrl(characterId),
    pinned: prev ? prev.pinned : pinned,
    addedAt: prev?.addedAt || fetched.point.scrapedAt,
    lastScrapedAt: fetched.point.scrapedAt,
    lastError: null,
    identity: { ...prev?.identity, ...fetched.identity },
    latest: fetched.point,
    days: upsertDay(prev?.days || [], fetched.point),
  };
}

export async function followBotByUrl(input: string, opts?: { pinned?: boolean }): Promise<{
  file: FollowedBotsFile;
  entry: FollowedBot;
}> {
  const id = parseBotLink(input);
  if (!id) throw new Error("Paste a juicychat.ai/chat/… link or a numeric bot id");
  const file = loadFollowedBots();
  const existing = file.bots.find((b) => b.characterId === id) || null;
  if (!existing && file.bots.length >= MAX_FOLLOWED_BOTS) {
    throw new Error(`Follow cap is ${MAX_FOLLOWED_BOTS} bots`);
  }
  const fetched = await fetchPublicBot(id);
  const entry = applyFetch(existing, id, fetched, opts?.pinned !== false);
  const bots = existing
    ? file.bots.map((b) => (b.characterId === id ? entry : b))
    : [entry, ...file.bots];
  return { file: saveFollowedBots({ ...file, bots }), entry };
}

export function unfollowBot(characterId: string): FollowedBotsFile {
  const file = loadFollowedBots();
  return saveFollowedBots({
    ...file,
    bots: file.bots.filter((b) => b.characterId !== characterId),
  });
}

export function pinFollowedBot(characterId: string, pinned = true): FollowedBotsFile {
  const file = loadFollowedBots();
  return saveFollowedBots({
    ...file,
    bots: file.bots.map((b) => (b.characterId === characterId ? { ...b, pinned } : b)),
  });
}

export async function refreshFollowedBot(characterId: string): Promise<{
  file: FollowedBotsFile;
  entry: FollowedBot;
}> {
  const file = loadFollowedBots();
  const existing = file.bots.find((b) => b.characterId === characterId);
  if (!existing) throw new Error("That bot is not on the follow list");
  try {
    const fetched = await fetchPublicBot(characterId);
    const entry = applyFetch(existing, characterId, fetched, existing.pinned);
    const bots = file.bots.map((b) => (b.characterId === characterId ? entry : b));
    return { file: saveFollowedBots({ ...file, bots }), entry };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const entry = { ...existing, lastError: msg };
    const bots = file.bots.map((b) => (b.characterId === characterId ? entry : b));
    saveFollowedBots({ ...file, bots });
    throw e;
  }
}

export async function refreshAllFollowedBots(): Promise<FollowedBotsFile> {
  const file = loadFollowedBots();
  if (!file.bots.length) return file;
  const bots: FollowedBot[] = [];
  for (const prev of file.bots) {
    try {
      const fetched = await fetchPublicBot(prev.characterId);
      bots.push(applyFetch(prev, prev.characterId, fetched, prev.pinned));
    } catch (e) {
      bots.push({
        ...prev,
        lastError: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return saveFollowedBots({ ...file, bots });
}
