export type JuicyApiResult<T> = {
  code: string;
  data: T;
  msg?: string;
  success?: boolean;
  total?: number;
  pageNo?: number;
  pageSize?: number;
  requestId?: string;
};

export type JuicyUserInfo = {
  userId: string;
  userName: string;
  userNo?: string;
  userAvatar?: string;
  userBio?: string;
  characterCount?: number;
  chatCount?: number;
  likeCount?: number;
  favoriteCount?: number;
  followersCount?: number;
  followingCount?: number;
  gender?: number;
  medalId?: string[];
  spaceSwitch?: number;
  unfiltered?: number;
};

export type JuicyBot = {
  characterId: string;
  characterName: string;
  characterPhoto?: string;
  characterThumb?: string;
  introduction?: string;
  chatCount?: number;
  likeCount?: number;
  favoriteCount?: number;
  visibility?: number | null;
  auditType?: number | null;
  auditAfterType?: number | null;
  rating?: string | number | null;
  characterTags?: string[];
  gender?: number;
  gmtCreate?: string | number;
  gmtFirstPublish?: string | number;
  gmtModified?: string | number;
  score?: number;
  score10?: number;
  score20?: number;
  pinnedTime?: string | number | null;
  userId?: string;
  userName?: string;
  personality?: string;
  publicDefinition?: number;
  basePopular?: number;
  baseTrending?: number;
  baseRecent?: number;
  baseEditor?: number;
  baseImmersive?: number;
  galleryCount?: number;
  memoryCount?: number;
  genPictureCount?: number;
  figureId?: string;
  shareCount?: number;
  characterAge?: string | number;
  textLength?: number;
  /** Any list/detail fields we don't yet model — keep them so we can backfill later. */
  extras?: Record<string, unknown>;
  _visibilityLabel?: string;
};

export type LoungeSnapshot = {
  scrapedAt: string;
  authenticated: boolean;
  userId: string;
  profile: JuicyUserInfo | null;
  space: Record<string, string | number | boolean | null | string[]> | null;
  stats: Record<string, string | number | boolean | null> | null;
  benefit: Record<string, string | number | boolean | null> | null;
  ownCharacterData: Record<string, string | number | boolean | null> | null;
  bots: JuicyBot[];
  totals: {
    bots: number;
    publicBots: number;
    unlistedBots: number;
    privateBots: number;
    chats: number;
    likes: number;
    favorites: number;
    followers: number;
    interactions: number;
  };
  warnings: string[];
  source: "live" | "cache";
};

// ── Growth tracking ──────────────────────────────

export type MetricTotals = {
  chats: number;
  likes: number;
  favorites: number;
  interactions: number;
  followers: number;
  bots: number;
};

export type BotMetricPoint = {
  characterId: string;
  characterName: string;
  characterThumb?: string;
  chats: number;
  likes: number;
  favorites: number;
  interactions: number;
  tags?: string[];
  score10?: number;
  score20?: number;
  visibility?: number | null;
  comments?: number;
  gmtFirstPublish?: string | number;
  gmtCreate?: string | number;
  memoryCount?: number;
  galleryCount?: number;
  genPictureCount?: number;
  shareCount?: number;
  figureId?: string;
  basePopular?: number;
  baseTrending?: number;
  baseRecent?: number;
  baseEditor?: number;
  baseImmersive?: number;
  extrasKeys?: string[];
};

/** Lift a base* flag off extras for snapshots scraped before the field was first-class. */
export function liftBaseImmersive(b: {
  baseImmersive?: number;
  extras?: Record<string, unknown>;
}): number | undefined {
  if (typeof b.baseImmersive === "number") return b.baseImmersive;
  const extra = b.extras?.baseImmersive;
  return typeof extra === "number" ? extra : undefined;
}

export type HistoryDay = {
  date: string; // YYYY-MM-DD (Europe/Madrid)
  scrapedAt: string;
  totals: MetricTotals;
  bots: Record<string, BotMetricPoint>;
};

export type HistoryFile = {
  version: 1;
  timezone: string;
  days: HistoryDay[];
  lastScrape?: HistoryDay;
  previousScrape?: HistoryDay;
};

export type GrowthDelta = {
  chats: number;
  likes: number;
  favorites: number;
  interactions: number;
  followers: number;
  bots: number;
};

export type BotGrowthRow = {
  characterId: string;
  characterName: string;
  characterThumb?: string;
  current: {
    chats: number;
    likes: number;
    favorites: number;
    interactions: number;
  };
  dayOverDay: GrowthDelta | null;
  last7Days: GrowthDelta | null;
  sinceLastRefresh: GrowthDelta | null;
};

export type TopGainer = {
  characterId: string;
  characterName: string;
  characterThumb?: string;
  delta: number;
  current: number;
};

export type BotCatalogItem = {
  characterId: string;
  characterName: string;
  characterThumb?: string;
  chats: number;
  likes: number;
  favorites: number;
  interactions: number;
};

export type BotTimelineDay = {
  date: string;
  bots: Record<string, { chats: number; likes: number; favorites: number; interactions: number }>;
};

export type GrowthAnalysis = {
  daysTracked: number;
  timezone: string;
  latestDate: string | null;
  previousDate: string | null;
  latestScrapedAt: string | null;
  previousScrapedAt: string | null;
  dayOverDay: GrowthDelta | null;
  sinceLastRefresh: GrowthDelta | null;
  last7Days: GrowthDelta | null;
  chart: Array<{
    date: string;
    chats: number;
    likes: number;
    favorites: number;
    interactions: number;
    followers: number;
  }>;
  dailyGrowth: Array<{
    date: string;
    chats: number;
    likes: number;
    favorites: number;
    interactions: number;
  }>;
  botGrowth: BotGrowthRow[];
  botCatalog: BotCatalogItem[];
  botTimeline: BotTimelineDay[];
  topGainers: {
    chats: TopGainer[];
    likes: TopGainer[];
    interactions: TopGainer[];
    period: "dayOverDay" | "sinceLastRefresh" | "last7Days";
  };
};
