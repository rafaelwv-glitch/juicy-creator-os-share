/**
 * Leftover JuicyChat KPIs the lounge list doesn't carry: VIP/coins/gems,
 * inventory (space tabs, plaza, memories, figures, videos), revenue campaigns,
 * and per-bot shareCount / textLength / gallery pageView.
 *
 * Append-only daily file so later questions can use history we cannot backfill.
 * Never stores cookies, definitions, setting, or scenario.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { JuicyClient } from "./client";
import type { JuicyBot, LoungeSnapshot } from "./types";
import { dataPath, ensureDataDir } from "./paths";
import { dayKey } from "./history";
import { loungeTimezone } from "./timezone-server";

const FILE = "creator-economy.json";
const MAX_DAYS = 400;
const TOP_BOTS = 8;

/** Never persist hidden card text even if a detail payload leaks it. */
const HIDDEN = new Set([
  "setting",
  "scenario",
  "greeting",
  "personality",
  "customInfo",
  "inputContent",
  "imagePrompt",
  "prompt",
  "lastEnabledPrompt",
  "characterDefinition",
  "definition",
]);

export type EconomyVip = {
  coin?: number;
  coinTotal?: number;
  gems?: number;
  gemsTotal?: number;
  incomeGems?: number;
  frozenGems?: number;
  vipCoin?: number;
  vipMaxCoin?: number;
  dailyCoin?: number;
  dailyMaxCoin?: number;
  userVipId?: string;
  userVipType?: number;
  vipTimeType?: string;
  userVipGmtEnd?: number;
  /** Unmapped VIP / coin keys (e.g. Second Best) — keep so they stay visible. */
  leftover?: Record<string, unknown>;
};

export type EconomyQuota = {
  freeFigure?: number;
  freePicture?: number;
  freeVideo?: number;
  figureCount?: number;
  figureGenCount?: number;
  pictureCount?: number;
  usePictureCount?: number;
};

export type EconomyUnread = {
  commentsNew?: number;
  followerNew?: number;
  interactionNew?: number;
  messageUnReadCount?: number;
  officialNew?: number;
};

export type EconomyInventory = {
  spacePublicChars?: number;
  spaceFigures?: number;
  spaceFolders?: number;
  spaceGalleries?: number;
  spacePublicImages?: number;
  spaceVideos?: number;
  plazaUserPics?: number;
  plazaFigures?: number;
  plazaChatPics?: number;
  memoriesAll?: number;
  memoriesPublic?: number;
  memoriesPrivate?: number;
  memoriesUnlisted?: number;
  personas?: number;
  sceneCards?: number;
  backpackItems?: number;
  coupons?: number;
  figuresOwned?: number;
  videosOwned?: number;
  genPicsOwned?: number;
};

export type EconomyCampaign = {
  id: string;
  name: string;
  status?: number;
  revenueGems?: number;
  totalRevenueGems?: number;
  entityCount?: number;
  startDate?: number;
  endDate?: number;
};

export type EconomyBotSignal = {
  characterId: string;
  characterName: string;
  shareCount?: number;
  textLength?: number;
  characterAge?: string | number;
  figureId?: string;
  commentCount?: number;
  galleryPageView?: number;
  galleryPics?: number;
  galleryName?: string;
  genAll?: number;
  genCloseUp?: number;
  genOwn?: number;
  genUnlock?: number;
  picLibraryStatus?: number;
  pictureUnlock?: number;
  hasSceneCard?: boolean;
  revenueGems?: number;
};

export type EconomySnapshot = {
  scrapedAt: string;
  date: string;
  vip: EconomyVip;
  quota: EconomyQuota;
  unread: EconomyUnread;
  checkInStreak?: number;
  inventory: EconomyInventory;
  campaigns: EconomyCampaign[];
  campaignCount?: number;
  botSignals: EconomyBotSignal[];
  warnings: string[];
};

export type EconomyFile = {
  version: 1;
  timezone: string;
  last: EconomySnapshot | null;
  days: EconomySnapshot[];
};

function asArray(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  if (!data || typeof data !== "object") return [];
  const o = data as Record<string, unknown>;
  for (const k of ["list", "records", "rows", "data", "items"]) {
    if (Array.isArray(o[k])) return o[k] as Record<string, unknown>[];
  }
  return [];
}

function num(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}

function str(v: unknown): string | undefined {
  if (v == null) return undefined;
  const s = String(v).trim();
  return s ? s : undefined;
}

function leftoverFrom(src: Record<string, unknown>): Record<string, unknown> {
  const skip = new Set([
    "coin",
    "coinTotal",
    "gems",
    "gemsTotal",
    "incomeGems",
    "frozenGems",
    "vipCoin",
    "vipMaxCoin",
    "dailyCoin",
    "dailyMaxCoin",
    "userVipId",
    "userVipType",
    "vipTimeType",
    "userVipGmtEnd",
    "freeQuota",
    "picFreeQuota",
    "code",
    "msg",
    "success",
    "requestId",
    "data",
    "total",
    "pageNo",
    "pageSize",
  ]);
  const out: Record<string, unknown> = {};
  const push = (k: string, v: unknown) => {
    if (v == null || v === "" || typeof v === "object") return;
    if (Object.keys(out).length >= 40) return;
    out[k] = v;
  };
  for (const [k, v] of Object.entries(src)) {
    if (skip.has(k)) continue;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      for (const [k2, v2] of Object.entries(v as Record<string, unknown>)) {
        push(`${k}.${k2}`, v2);
      }
    } else if (Array.isArray(v)) {
      const prim = v.filter((x) => x != null && typeof x !== "object").slice(0, 8);
      if (prim.length) push(k, prim.join(", "));
    } else {
      push(k, v);
    }
  }
  return out;
}

function parseJsonObject(v: unknown): Record<string, unknown> | null {
  if (!v) return null;
  if (typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  if (typeof v === "string") {
    try {
      const p = JSON.parse(v);
      if (p && typeof p === "object" && !Array.isArray(p)) return p as Record<string, unknown>;
    } catch {
      /* */
    }
  }
  return null;
}

async function postObj(
  client: JuicyClient,
  path: string,
  body: unknown,
  warnings: string[],
  label: string,
): Promise<{ data: Record<string, unknown> | null; total?: number }> {
  try {
    const r = await client.post<unknown>(path, body ?? {});
    if (!r.success && r.code !== "200") {
      warnings.push(`${label}: ${r.msg || r.code}`);
      return { data: null };
    }
    const data =
      r.data && typeof r.data === "object" && !Array.isArray(r.data)
        ? (r.data as Record<string, unknown>)
        : Array.isArray(r.data)
          ? { list: r.data }
          : null;
    return { data, total: typeof r.total === "number" ? r.total : undefined };
  } catch (e) {
    warnings.push(`${label}: ${e instanceof Error ? e.message : String(e)}`);
    return { data: null };
  }
}

function tabFromSpace(space: LoungeSnapshot["space"] | null | undefined): EconomyInventory {
  const out: EconomyInventory = {};
  const tab = parseJsonObject(space?.tabTotal);
  if (tab) {
    out.spacePublicChars = num(tab.characterTotal);
    out.spaceFigures = num(tab.figuresTotal);
    out.spaceFolders = num(tab.folderTotal);
    out.spaceGalleries = num(tab.imageSetsTotal);
    out.spacePublicImages = num(tab.imagesTotal);
    out.spaceVideos = num(tab.videoTotal);
  }
  return out;
}

function characterBlob(raw: Record<string, unknown>): Record<string, unknown> {
  const c =
    raw.character && typeof raw.character === "object"
      ? (raw.character as Record<string, unknown>)
      : raw;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(c)) {
    if (HIDDEN.has(k)) continue;
    out[k] = v;
  }
  return out;
}

async function botSignal(
  client: JuicyClient,
  bot: JuicyBot,
  warnings: string[],
): Promise<EconomyBotSignal> {
  const row: EconomyBotSignal = {
    characterId: bot.characterId,
    characterName: bot.characterName,
    shareCount: bot.shareCount,
    textLength: bot.textLength,
    characterAge: bot.characterAge,
    figureId: bot.figureId,
  };

  const [detail, gallery, gen] = await Promise.all([
    postObj(
      client,
      "/yume/api/user/v1/character/getCharacterDetail",
      { characterId: bot.characterId },
      warnings,
      `detail ${bot.characterName}`,
    ),
    postObj(
      client,
      "/yume/api/user/v1/gallery/galleryPage",
      { characterId: bot.characterId, pageNo: 1, pageSize: 5 },
      warnings,
      `gallery ${bot.characterName}`,
    ),
    postObj(
      client,
      "/yume/api/user/v1/character/picture/getGenPictureCountData",
      { characterId: bot.characterId },
      warnings,
      `gen ${bot.characterName}`,
    ),
  ]);

  if (detail.data) {
    const c = characterBlob(detail.data);
    row.shareCount = num(c.shareCount) ?? row.shareCount;
    row.textLength = num(c.textLength) ?? row.textLength;
    if (c.characterAge != null) row.characterAge = c.characterAge as string | number;
    if (c.figureId != null) row.figureId = String(c.figureId);
    row.picLibraryStatus = num(c.picLibraryStatus);
    row.pictureUnlock = num(c.characterPictureUnlock);
    row.hasSceneCard = Boolean(c.sceneCard && typeof c.sceneCard === "object");
    row.commentCount = num(c.commentCount) ?? row.commentCount;
  }

  const galList = asArray(gallery.data);
  if (galList.length) {
    let views = 0;
    let pics = 0;
    let name: string | undefined;
    for (const g of galList) {
      views += num(g.pageView) ?? 0;
      pics += num(g.pictureCount) ?? 0;
      if (!name) name = str(g.galleryName);
    }
    row.galleryPageView = views;
    row.galleryPics = pics;
    row.galleryName = name;
  }

  if (gen.data) {
    row.genAll = num(gen.data.allPictureCount);
    row.genCloseUp = num(gen.data.closeUpPictureCount);
    row.genOwn = num(gen.data.ownPictureCount);
    row.genUnlock = num(gen.data.unLockPictureCount);
  }

  return row;
}

export function loadEconomy(): EconomyFile {
  try {
    const p = dataPath(FILE);
    if (!existsSync(p)) return { version: 1, timezone: loungeTimezone(), last: null, days: [] };
    const raw = JSON.parse(readFileSync(p, "utf8")) as EconomyFile;
    if (!raw || !Array.isArray(raw.days)) {
      return { version: 1, timezone: loungeTimezone(), last: null, days: [] };
    }
    return {
      version: 1,
      timezone: raw.timezone || loungeTimezone(),
      last: raw.last ?? null,
      days: raw.days,
    };
  } catch {
    return { version: 1, timezone: loungeTimezone(), last: null, days: [] };
  }
}

export function loadEconomyLast(): EconomySnapshot | null {
  const f = loadEconomy();
  return f.last ?? f.days[f.days.length - 1] ?? null;
}

function saveEconomy(file: EconomyFile) {
  ensureDataDir();
  writeFileSync(dataPath(FILE), JSON.stringify(file), "utf8");
}

function recordDay(snap: EconomySnapshot): EconomyFile {
  const file = loadEconomy();
  const idx = file.days.findIndex((d) => d.date === snap.date);
  if (idx >= 0) file.days[idx] = snap;
  else file.days.push(snap);
  file.days.sort((a, b) => a.date.localeCompare(b.date));
  if (file.days.length > MAX_DAYS) file.days = file.days.slice(file.days.length - MAX_DAYS);
  file.last = snap;
  saveEconomy(file);
  return file;
}

/**
 * Pull leftover KPIs and upsert today's row. Patches shareCount/textLength onto
 * the passed bots so the lounge snapshot also keeps them.
 */
export async function scrapeAndRecordEconomy(
  client: JuicyClient,
  options: {
    bots?: JuicyBot[];
    space?: LoungeSnapshot["space"];
    topBots?: number;
  } = {},
): Promise<EconomySnapshot> {
  const warnings: string[] = [];
  const scrapedAt = new Date().toISOString();
  const date = dayKey(scrapedAt);
  const bots = options.bots || [];

  const [
    vipRes,
    coinRes,
    withdrawRes,
    unreadRes,
    checkinRes,
    plazaRes,
    memRes,
    personaRes,
    backpackRes,
    couponRes,
    campRes,
    videoRes,
    figureRes,
    genListRes,
  ] = await Promise.all([
    postObj(client, "/yume/api/user/v1/getUserVipDetail", {}, warnings, "vip"),
    postObj(client, "/yume/api/user/v1/getUserCoin", {}, warnings, "coin"),
    postObj(client, "/yume/api/user/v1/wallet/getWithdrawalInfo", {}, warnings, "withdraw"),
    postObj(client, "/yume/api/user/v1/message/haveMessageUnReadCount", {}, warnings, "unread"),
    postObj(client, "/yume/api/user/v2/task/userCheckInPrompt", {}, warnings, "checkin"),
    postObj(client, "/yume/api/user/v1/image/getOwnPhotoPlazaCount", {}, warnings, "plaza"),
    postObj(client, "/yume/api/user/v1/memory/getOwnUserCharacterData", {}, warnings, "memories"),
    postObj(client, "/yume/api/user/v1/persona/getMinePersonaSceneCardCount", {}, warnings, "personas"),
    postObj(client, "/yume/api/user/v1/backpack/getUserPropList", { pageNo: 1, pageSize: 1 }, warnings, "backpack"),
    postObj(client, "/yume/api/user/v1/getCouponList", { pageNo: 1, pageSize: 1, couponType: -1 }, warnings, "coupons"),
    postObj(
      client,
      "/yume/api/user/v1/revenue/campaign/revenueCampaignPage",
      { pageNo: 1, pageSize: 20 },
      warnings,
      "campaigns",
    ),
    postObj(client, "/yume/api/user/v1/video/myVideoPage", { pageNo: 1, pageSize: 1 }, warnings, "videos"),
    postObj(client, "/yume/api/user/v1/figure/figurePage", { pageNo: 1, pageSize: 1 }, warnings, "figures"),
    postObj(
      client,
      "/yume/api/user/v1/character/picture/getOwnGenPictureList",
      { pageNo: 1, pageSize: 1 },
      warnings,
      "genPics",
    ),
  ]);

  const vipSrc = { ...(vipRes.data || {}), ...(coinRes.data || {}) };
  const freeQuota = parseJsonObject(vipSrc.freeQuota);
  const picFree = parseJsonObject(vipSrc.picFreeQuota);
  const leftover = leftoverFrom({
    ...vipSrc,
    ...(withdrawRes.data || {}),
  });

  const vip: EconomyVip = {
    coin: num(vipSrc.coin),
    coinTotal: num(vipSrc.coinTotal),
    gems: num(vipSrc.gems) ?? num(withdrawRes.data?.gems),
    gemsTotal: num(vipSrc.gemsTotal),
    incomeGems: num(vipSrc.incomeGems) ?? num(withdrawRes.data?.incomeGems),
    frozenGems: num(withdrawRes.data?.frozenGems),
    vipCoin: num(vipSrc.vipCoin),
    vipMaxCoin: num(vipSrc.vipMaxCoin),
    dailyCoin: num(vipSrc.dailyCoin),
    dailyMaxCoin: num(vipSrc.dailyMaxCoin),
    userVipId: str(vipSrc.userVipId),
    userVipType: num(vipSrc.userVipType),
    vipTimeType: str(vipSrc.vipTimeType),
    userVipGmtEnd: num(vipSrc.userVipGmtEnd),
    leftover: Object.keys(leftover).length ? leftover : undefined,
  };

  const quota: EconomyQuota = {
    freeFigure: num(freeQuota?.freeFigureCount),
    freePicture: num(freeQuota?.freePictureCount),
    freeVideo: num(freeQuota?.freeVideoCount),
    figureCount: num(picFree?.figureCount),
    figureGenCount: num(picFree?.figureGenCount),
    pictureCount: num(picFree?.pictureCount),
    usePictureCount: num(picFree?.usePictureCount),
  };

  const unread: EconomyUnread = {
    commentsNew: num(unreadRes.data?.commentsNew),
    followerNew: num(unreadRes.data?.followerNew),
    interactionNew: num(unreadRes.data?.interactionNew),
    messageUnReadCount: num(unreadRes.data?.messageUnReadCount),
    officialNew: num(unreadRes.data?.officialNew),
  };

  const inventory: EconomyInventory = {
    ...tabFromSpace(options.space),
    plazaUserPics: num(plazaRes.data?.userPictureCount),
    plazaFigures: num(plazaRes.data?.figureCount),
    plazaChatPics: num(plazaRes.data?.chatPictureCount),
    memoriesAll: num(memRes.data?.allCount),
    memoriesPublic: num(memRes.data?.publicCount),
    memoriesPrivate: num(memRes.data?.privateCount),
    memoriesUnlisted: num(memRes.data?.unlistedCount),
    personas: num(personaRes.data?.personaCardCount),
    sceneCards: num(personaRes.data?.sceneCardCount),
    backpackItems: backpackRes.total,
    coupons: couponRes.total,
    figuresOwned: figureRes.total,
    videosOwned: videoRes.total,
    genPicsOwned: genListRes.total,
  };

  const campaigns: EconomyCampaign[] = asArray(campRes.data).map((c) => ({
    id: String(c.revenueCampaignId ?? ""),
    name: String(c.campaignName || c.shortTitle || c.longTitle || "campaign"),
    status: num(c.status),
    revenueGems: num(c.revenueGems),
    totalRevenueGems: num(c.totalRevenueGems),
    entityCount: num(c.entityCount),
    startDate: num(c.startDate),
    endDate: num(c.endDate),
  })).filter((c) => c.id);

  const top = [...bots]
    .sort((a, b) => (b.chatCount ?? 0) - (a.chatCount ?? 0))
    .slice(0, options.topBots ?? TOP_BOTS);

  const botSignals: EconomyBotSignal[] = [];
  for (const bot of top) {
    try {
      botSignals.push(await botSignal(client, bot, warnings));
    } catch (e) {
      warnings.push(`bot ${bot.characterName}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  for (const sig of botSignals) {
    const b = bots.find((x) => x.characterId === sig.characterId);
    if (!b) continue;
    if (sig.shareCount != null) b.shareCount = sig.shareCount;
    if (sig.textLength != null) b.textLength = sig.textLength;
    if (sig.characterAge != null) b.characterAge = sig.characterAge;
    if (sig.figureId) b.figureId = sig.figureId;
  }

  const snap: EconomySnapshot = {
    scrapedAt,
    date,
    vip,
    quota,
    unread,
    checkInStreak: num(checkinRes.data?.progress),
    inventory,
    campaigns,
    campaignCount: campRes.total ?? campaigns.length,
    botSignals,
    warnings,
  };
  recordDay(snap);
  return snap;
}

export function patchBotsFromEconomy(bots: JuicyBot[], snap: EconomySnapshot | null | undefined) {
  if (!snap?.botSignals?.length) return;
  const byId = new Map(snap.botSignals.map((s) => [s.characterId, s]));
  for (const b of bots) {
    const sig = byId.get(b.characterId);
    if (!sig) continue;
    if (sig.shareCount != null && b.shareCount == null) b.shareCount = sig.shareCount;
    if (sig.textLength != null && b.textLength == null) b.textLength = sig.textLength;
    if (sig.characterAge != null && b.characterAge == null) b.characterAge = sig.characterAge;
    if (sig.figureId && !b.figureId) b.figureId = sig.figureId;
  }
}
