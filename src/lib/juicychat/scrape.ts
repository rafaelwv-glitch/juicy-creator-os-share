import { JuicyClient } from "./client";
import { DEFAULT_LOUNGE_USER_ID } from "./constants";
import { loadSession, saveSession } from "./session";
import type { JuicyBot, JuicyUserInfo, LoungeSnapshot } from "./types";
import { consensusFollowerCount } from "./repair";

function visibilityLabel(v: number | null | undefined) {
  if (v === 2) return "public";
  if (v === 1) return "unlisted";
  if (v === 0) return "private";
  return "unknown";
}

function asNum(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}

function pickUser(raw: Record<string, unknown> | null | undefined): JuicyUserInfo | null {
  if (!raw || raw.userId == null) return null;
  return {
    userId: String(raw.userId),
    userName: String(raw.userName ?? ""),
    userNo: raw.userNo != null ? String(raw.userNo) : undefined,
    userAvatar: raw.userAvatar != null ? String(raw.userAvatar) : undefined,
    userBio: raw.userBio != null ? String(raw.userBio) : undefined,
    characterCount: asNum(raw.characterCount),
    chatCount: asNum(raw.chatCount),
    likeCount: asNum(raw.likeCount),
    favoriteCount: asNum(raw.favoriteCount),
    followersCount: asNum(raw.followersCount) ?? asNum(raw.followerCount),
    followingCount: asNum(raw.followingCount),
    gender: typeof raw.gender === "number" ? raw.gender : undefined,
    medalId: Array.isArray(raw.medalId) ? raw.medalId.map(String) : undefined,
    spaceSwitch: typeof raw.spaceSwitch === "number" ? raw.spaceSwitch : undefined,
    unfiltered: typeof raw.unfiltered === "number" ? raw.unfiltered : undefined,
  };
}

function slimUnknown(v: unknown): unknown {
  if (v == null) return v;
  if (typeof v === "string") return v.length > 12_000 ? `${v.slice(0, 12_000)}…[truncated]` : v;
  if (typeof v === "number" || typeof v === "boolean") return v;
  if (Array.isArray(v)) return v.slice(0, 80).map(slimUnknown);
  if (typeof v === "object") {
    const o: Record<string, unknown> = {};
    let n = 0;
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (n >= 60) break;
      o[k] = slimUnknown(val);
      n += 1;
    }
    return o;
  }
  return String(v);
}

const BOT_KNOWN = new Set([
  "characterId",
  "characterName",
  "characterPhoto",
  "characterThumb",
  "introduction",
  "chatCount",
  "likeCount",
  "favoriteCount",
  "visibility",
  "auditType",
  "auditAfterType",
  "rating",
  "characterTags",
  "gender",
  "gmtCreate",
  "gmtFirstPublish",
  "gmtModified",
  "score",
  "score10",
  "score20",
  "pinnedTime",
  "userId",
  "userName",
  "personality",
  "publicDefinition",
  "basePopular",
  "baseTrending",
  "baseRecent",
  "baseEditor",
  "baseImmersive",
  "galleryCount",
  "memoryCount",
  "genPictureCount",
  "figureId",
  "shareCount",
  "characterAge",
  "textLength",
]);

function pickBot(raw: Record<string, unknown>): JuicyBot | null {
  if (!raw?.characterId) return null;
  const extras: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (BOT_KNOWN.has(k) || v == null) continue;
    extras[k] = slimUnknown(v);
  }
  return {
    characterId: String(raw.characterId),
    characterName: String(raw.characterName ?? "Untitled"),
    characterPhoto: raw.characterPhoto != null ? String(raw.characterPhoto) : undefined,
    characterThumb: raw.characterThumb != null ? String(raw.characterThumb) : undefined,
    introduction: raw.introduction != null ? String(raw.introduction) : undefined,
    chatCount: typeof raw.chatCount === "number" ? raw.chatCount : undefined,
    likeCount: typeof raw.likeCount === "number" ? raw.likeCount : undefined,
    favoriteCount: typeof raw.favoriteCount === "number" ? raw.favoriteCount : undefined,
    visibility:
      typeof raw.visibility === "number" ? raw.visibility : raw.visibility === null ? null : undefined,
    auditType: typeof raw.auditType === "number" ? raw.auditType : null,
    auditAfterType: typeof raw.auditAfterType === "number" ? raw.auditAfterType : null,
    rating: (raw.rating as string | number | null | undefined) ?? null,
    characterTags: Array.isArray(raw.characterTags) ? raw.characterTags.map(String) : undefined,
    gender: typeof raw.gender === "number" ? raw.gender : undefined,
    gmtCreate: raw.gmtCreate as string | number | undefined,
    gmtFirstPublish: raw.gmtFirstPublish as string | number | undefined,
    gmtModified: raw.gmtModified as string | number | undefined,
    score: typeof raw.score === "number" ? raw.score : undefined,
    score10: typeof raw.score10 === "number" ? raw.score10 : undefined,
    score20: typeof raw.score20 === "number" ? raw.score20 : undefined,
    pinnedTime: (raw.pinnedTime as string | number | null | undefined) ?? null,
    userId: raw.userId != null ? String(raw.userId) : undefined,
    userName: raw.userName != null ? String(raw.userName) : undefined,
    personality: raw.personality != null ? String(raw.personality) : undefined,
    publicDefinition: typeof raw.publicDefinition === "number" ? raw.publicDefinition : undefined,
    basePopular: typeof raw.basePopular === "number" ? raw.basePopular : undefined,
    baseTrending: typeof raw.baseTrending === "number" ? raw.baseTrending : undefined,
    baseRecent: typeof raw.baseRecent === "number" ? raw.baseRecent : undefined,
    baseEditor: typeof raw.baseEditor === "number" ? raw.baseEditor : undefined,
    baseImmersive:
      typeof raw.baseImmersive === "number"
        ? raw.baseImmersive
        : typeof extras.baseImmersive === "number"
          ? (extras.baseImmersive as number)
          : undefined,
    galleryCount: typeof raw.galleryCount === "number" ? raw.galleryCount : undefined,
    memoryCount: typeof raw.memoryCount === "number" ? raw.memoryCount : undefined,
    genPictureCount: typeof raw.genPictureCount === "number" ? raw.genPictureCount : undefined,
    figureId: raw.figureId != null ? String(raw.figureId) : undefined,
    shareCount: typeof raw.shareCount === "number" ? raw.shareCount : undefined,
    characterAge: (raw.characterAge as string | number | undefined) ?? undefined,
    textLength: typeof raw.textLength === "number" ? raw.textLength : undefined,
    extras: Object.keys(extras).length ? extras : undefined,
    _visibilityLabel: visibilityLabel(
      typeof raw.visibility === "number" ? raw.visibility : (raw.visibility as null),
    ),
  };
}

function flattenRecord(
  raw: unknown,
): Record<string, string | number | boolean | null> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: Record<string, string | number | boolean | null> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (v == null) out[k] = null;
    else if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") out[k] = v;
    else out[k] = JSON.stringify(v);
  }
  return out;
}

async function paginateBots(
  client: JuicyClient,
  mode: "public" | "own",
  userId: string,
): Promise<{ bots: JuicyBot[]; warnings: string[] }> {
  const warnings: string[] = [];
  const bots: JuicyBot[] = [];
  let pageNo = 1;
  const pageSize = 50;
  let total = Infinity;

  while (bots.length < total && pageNo <= 40) {
    if (mode === "own") {
      const res = await client.post<Record<string, unknown>[]>(
        "/yume/api/user/v1/character/getOwnUserCharacterList",
        {
          pageNo,
          pageSize,
          sortGmtCreate: 0,
          visibility: null,
          searchContent: "",
        },
      );
      if (!res.success && res.code !== "200") {
        warnings.push(`getOwnUserCharacterList: ${res.msg || res.code}`);
        break;
      }
      const batch = (Array.isArray(res.data) ? res.data : [])
        .map((r) => pickBot(r))
        .filter(Boolean) as JuicyBot[];
      total = typeof res.total === "number" ? res.total : batch.length;
      bots.push(...batch);
      if (batch.length < pageSize) break;
    } else {
      const res = await client.post<Record<string, unknown>[]>(
        "/yume/api/user/v1/character/getUserSpaceCharacterList",
        {
          pageNo,
          pageSize,
          visibility: null,
          auditType: null,
          searchContent: "",
          characterTags: [],
          sortName: "new",
          gender: null,
          userId,
        },
      );
      if (!res.success && res.code !== "200") {
        warnings.push(`getUserSpaceCharacterList: ${res.msg || res.code}`);
        break;
      }
      const batch = (Array.isArray(res.data) ? res.data : [])
        .map((r) => pickBot(r))
        .filter(Boolean) as JuicyBot[];
      total = typeof res.total === "number" ? res.total : batch.length;
      bots.push(...batch);
      if (batch.length < pageSize) break;
    }
    pageNo += 1;
  }

  const map = new Map<string, JuicyBot>();
  for (const b of bots) map.set(b.characterId, b);
  return { bots: [...map.values()], warnings };
}

export async function scrapeLounge(options?: {
  userId?: string;
  forceAuth?: boolean;
}): Promise<LoungeSnapshot> {
  const userId = options?.userId || "";
  if (!userId) throw new Error("No lounge user id — log in first or pass userId.");
  const session = loadSession();
  const client = JuicyClient.fromSession(session);
  const warnings: string[] = [];

  let authenticated = false;
  let me: JuicyUserInfo | null = null;
  try {
    const meRes = await client.get<Record<string, unknown> | null>("/yume/api/user/v1/getUserInfo");
    me = pickUser(meRes.data ?? undefined);
    if (me?.userId) {
      authenticated = true;
      if (session && client.cookie.length > 8) {
        saveSession({
          ...session,
          cookie: client.cookie,
          userId: me.userId,
          userName: me.userName,
          userNo: me.userNo,
        });
      }
    }
  } catch (e) {
    warnings.push(`getUserInfo failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  const isOwn = Boolean(authenticated && me?.userId && String(me.userId) === String(userId));

  let profile: JuicyUserInfo | null = null;
  try {
    const p = await client.post<Record<string, unknown>>("/yume/api/user/v1/getOtherUserInfo", {
      userId,
    });
    if (p.success || p.code === "200") profile = pickUser(p.data);
    else warnings.push(`getOtherUserInfo: ${p.msg || p.code}`);
  } catch (e) {
    warnings.push(`getOtherUserInfo error: ${e instanceof Error ? e.message : String(e)}`);
  }

  let space: LoungeSnapshot["space"] = null;
  try {
    const s = await client.post<Record<string, unknown>>("/yume/api/user/v1/getUserSpace", {
      userId,
    });
    if (s.success || s.code === "200") {
      const flat: Record<string, string | number | boolean | null | string[]> = {};
      for (const [k, v] of Object.entries(s.data || {})) {
        if (v == null) flat[k] = null;
        else if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") flat[k] = v;
        else if (Array.isArray(v)) flat[k] = v.map(String);
        else flat[k] = JSON.stringify(v);
      }
      space = flat;
    }
  } catch (e) {
    warnings.push(`getUserSpace error: ${e instanceof Error ? e.message : String(e)}`);
  }

  let stats: LoungeSnapshot["stats"] = null;
  let benefit: LoungeSnapshot["benefit"] = null;
  let ownCharacterData: LoungeSnapshot["ownCharacterData"] = null;

  // These three endpoints take no userId — they always return the logged-in
  // account. Never attach them to a rival snapshot.
  if (isOwn) {
    try {
      const st = await client.post<Record<string, unknown>>(
        "/yume/api/user/v1/getUserStatisticsData",
        {},
      );
      if (st.success || st.code === "200") stats = flattenRecord(st.data);
      else warnings.push(`getUserStatisticsData: ${st.msg || st.code}`);
    } catch (e) {
      warnings.push(`stats error: ${e instanceof Error ? e.message : String(e)}`);
    }
    try {
      const b = await client.post<Record<string, unknown>>(
        "/yume/api/user/v1/creator/getBenefitSummary",
        {},
      );
      if (b.success || b.code === "200") benefit = flattenRecord(b.data);
      else warnings.push(`getBenefitSummary: ${b.msg || b.code}`);
    } catch (e) {
      warnings.push(`benefit error: ${e instanceof Error ? e.message : String(e)}`);
    }
    try {
      const o = await client.post<Record<string, unknown>>(
        "/yume/api/user/v1/character/getOwnUserCharacterData",
        {},
      );
      if (o.success || o.code === "200") ownCharacterData = flattenRecord(o.data);
      else warnings.push(`getOwnUserCharacterData: ${o.msg || o.code}`);
    } catch (e) {
      warnings.push(`ownCharacterData error: ${e instanceof Error ? e.message : String(e)}`);
    }
  } else if (options?.forceAuth && !authenticated) {
    warnings.push("Not logged in — private / unlisted bots hidden. Use magic link or password.");
  }

  const list = await paginateBots(client, isOwn ? "own" : "public", userId);
  warnings.push(...list.warnings);
  let bots = list.bots;

  if (isOwn && bots.length === 0) {
    const pub = await paginateBots(client, "public", userId);
    bots = pub.bots;
    warnings.push(...pub.warnings);
  }

  bots.sort((a, b) => (b.chatCount ?? 0) - (a.chatCount ?? 0));

  if (authenticated && isOwn) {
    try {
      const { scrapeAndRecordEconomy } = await import("./economy");
      await scrapeAndRecordEconomy(client, { bots, space });
    } catch (e) {
      warnings.push(`economy: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const publicBots = bots.filter((b) => b.visibility === 2 || b.visibility == null).length;
  const unlistedBots = bots.filter((b) => b.visibility === 1).length;
  const privateBots = bots.filter((b) => b.visibility === 0).length;

  const chatsFromBots = bots.reduce((s, b) => s + (b.chatCount ?? 0), 0);
  const likesFromBots = bots.reduce((s, b) => s + (b.likeCount ?? 0), 0);
  const favFromBots = bots.reduce((s, b) => s + (b.favoriteCount ?? 0), 0);

  // Rival scrapes: public profile is the only trustworthy source. Own-account
  // stats/benefit APIs take no userId and always return the logged-in lounge.
  if (!isOwn) {
    if (!profile) {
      warnings.push("Public profile missing — totals from listed bots only; followers unknown.");
    }
    const chats = profile?.chatCount ?? chatsFromBots;
    const likes = profile?.likeCount ?? likesFromBots;
    const favorites = profile?.favoriteCount ?? favFromBots;
    const followers = profile?.followersCount ?? 0;
    return {
      scrapedAt: new Date().toISOString(),
      authenticated: false,
      userId,
      profile,
      space,
      stats: null,
      benefit: null,
      ownCharacterData: null,
      bots,
      totals: {
        bots: bots.length,
        publicBots,
        unlistedBots,
        privateBots,
        chats,
        likes,
        favorites,
        followers,
        interactions: chats + likes + favorites,
      },
      warnings,
      source: "live",
    };
  }

  const chats = profile?.chatCount ?? asNum(stats?.chatCount) ?? chatsFromBots;
  const likes = profile?.likeCount ?? asNum(stats?.likeCount) ?? likesFromBots;
  const favorites = profile?.favoriteCount ?? asNum(stats?.favoriteCount) ?? favFromBots;
  const followers =
    consensusFollowerCount([
      profile?.followersCount,
      asNum(stats?.followersCount),
      asNum(stats?.followerCount),
    ]) ??
    profile?.followersCount ??
    asNum(stats?.followersCount) ??
    asNum(stats?.followerCount) ??
    0;

  try {
    const { recordFollowerPoint } = await import("./followers");
    if (followers > 0) recordFollowerPoint(followers, "lounge-profile");
  } catch {
    /* */
  }

  return {
    scrapedAt: new Date().toISOString(),
    authenticated: true,
    userId,
    profile: profile ?? me,
    space,
    stats,
    benefit,
    ownCharacterData,
    bots,
    totals: {
      bots: bots.length,
      publicBots,
      unlistedBots,
      privateBots,
      chats,
      likes,
      favorites,
      followers,
      interactions: chats + likes + favorites,
    },
    warnings,
    source: "live",
  };
}

/** Cookie-in-body scrape for the phone publisher — never writes lounge user-kv. */
export async function scrapeOwnFromCookie(cookie: string): Promise<{
  cookie: string;
  user: JuicyUserInfo | null;
  bots: JuicyBot[];
  warnings: string[];
  authenticated: boolean;
}> {
  const client = new JuicyClient({ cookie });
  const warnings: string[] = [];
  let user: JuicyUserInfo | null = null;
  try {
    const meRes = await client.get<Record<string, unknown> | null>("/yume/api/user/v1/getUserInfo");
    user = pickUser(meRes.data ?? undefined);
  } catch (e) {
    warnings.push(`getUserInfo failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!user?.userId) {
    return {
      cookie: client.cookie || cookie,
      user: null,
      bots: [],
      warnings,
      authenticated: false,
    };
  }
  const list = await paginateBots(client, "own", user.userId);
  warnings.push(...list.warnings);
  let bots = list.bots;
  if (bots.length === 0) {
    const pub = await paginateBots(client, "public", user.userId);
    bots = pub.bots;
    warnings.push(...pub.warnings);
  }
  return {
    cookie: client.cookie || cookie,
    user,
    bots,
    warnings,
    authenticated: true,
  };
}
