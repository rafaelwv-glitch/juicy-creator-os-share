/**
 * Browser-safe tag forensics types + search helpers.
 * Keep Node fs/os/path out of this file — the Forensics page imports it.
 */

export type TagSeriesPoint = {
  date: string;
  weekday: string;
  gain: number;
  bots: number;
};

export type TagTrafficRow = {
  tag: string;
  bots: number;
  chats: number;
  gain7: number;
  gain30: number;
  chatsPerDay: number;
  lift: number;
  peakWeekday: string | null;
  peakHour: number | null;
  series: TagSeriesPoint[];
};

export type TagWhenRow = {
  tag: string;
  successWhen: string;
  evidence: string;
  weekdays: Array<{ day: string; gain: number; share: number }>;
  hours: Array<{ hour: number; events: number }>;
  gain7: number;
  lift: number;
};

export type TagComboRow = {
  a: string;
  b: string;
  bots: number;
  chats: number;
  chatsPerDay: number;
  lift: number;
  dChats: number;
  names: string[];
};

export type TagCoverage = "overserved" | "underserved" | "balanced" | "unused";

export type TagCatalogEntry = {
  tag: string;
  bots: number;
  chats: number;
  gain7: number;
  gain30: number;
  chatsPerDay: number;
  lift: number;
  official: boolean;
  yours: boolean;
  marketN: number;
  marketChats: number;
  rivalBots: number;
  coverage: TagCoverage;
  sources: Array<"warehouse" | "official" | "new-feed" | "rival">;
};

export type TagGapRow = {
  kind: "overserved" | "underserved";
  subject: "tag" | "combo";
  tag: string;
  pair?: { a: string; b: string };
  score: number;
  why: string;
  bots: number;
  lift: number;
  marketN: number;
  names?: string[];
};

export type TagSuggest = {
  kind: "tag" | "combo";
  label: string;
  sub: string;
  tag?: string;
  pair?: { a: string; b: string };
  badges: string[];
};

export type TagPopularityPoint = {
  date: string;
  weekday: string;
  cards: number;
  knownCards: number;
  yourGain: number;
};

export type TagCreatorHit = {
  userId: string;
  userName: string;
  from: "you" | "rival" | "new-feed";
  bots: number;
  chats: number;
  names: string[];
  lastDate?: string | null;
};

export type TagPopularityRow = {
  tag: string;
  cards7: number;
  cards30: number;
  delta: number;
  knownShare: number;
  trackedCreators: number;
  series: TagPopularityPoint[];
  creators: TagCreatorHit[];
};

export type TagForensics = {
  timezone: string;
  generatedAt: string;
  daysTracked: number;
  botCount: number;
  timingEvents: number;
  officialCount: number;
  catalogSize: number;
  feedDays: number;
  traffic: TagTrafficRow[];
  when: TagWhenRow[];
  combos: TagComboRow[];
  catalog: TagCatalogEntry[];
  overserved: TagGapRow[];
  underserved: TagGapRow[];
  popularity: TagPopularityRow[];
};

export type PondTagCount = { tag: string; n: number; chats?: number };
export type RivalTagBotIn = {
  characterId?: string;
  characterName?: string;
  tags: string[];
  chats: number;
  userName?: string;
  userId?: string;
};
export type NewFeedDayIn = {
  date: string;
  tagCounts?: Array<{ tag: string; n: number }>;
  titles?: Array<{
    characterId?: string;
    characterName?: string;
    userId?: string;
    userName?: string;
    tags?: string[];
    chats?: number;
  }>;
};
export type NewFeedBotIn = {
  characterId?: string;
  characterName?: string;
  userId?: string;
  userName?: string;
  tags?: string[];
  chats?: number;
  lastDate?: string;
  own?: boolean;
};

export function tagKey(t: string) {
  return String(t || "")
    .trim()
    .toLowerCase();
}

export function queryTokens(q: string): string[] {
  return String(q || "")
    .toLowerCase()
    .split(/[×x,|/]+|\s+and\s+/i)
    .map((s) => s.trim())
    .filter((s) => s.length >= 1);
}

export function tagMatchesQuery(tag: string, q: string): boolean {
  const k = tagKey(tag);
  const raw = String(q || "")
    .trim()
    .toLowerCase();
  if (!raw) return true;
  if (k === raw || k.startsWith(raw) || k.includes(raw)) return true;
  const tokens = queryTokens(raw);
  return tokens.some((t) => k === t || k.startsWith(t) || k.includes(t));
}

export function comboMatchesQuery(a: string, b: string, q: string): boolean {
  const raw = String(q || "")
    .trim()
    .toLowerCase();
  if (!raw) return true;
  if (tagMatchesQuery(a, raw) || tagMatchesQuery(b, raw)) return true;
  const tokens = queryTokens(raw).filter((t) => t.length >= 2);
  if (tokens.length >= 2) {
    const hitA = tokens.some((t) => tagKey(a).includes(t));
    const hitB = tokens.some((t) => tagKey(b).includes(t));
    return hitA && hitB;
  }
  return false;
}

export function suggestTags(
  catalog: TagCatalogEntry[],
  combos: TagComboRow[],
  query: string,
  limit = 10,
): TagSuggest[] {
  const raw = String(query || "").trim();
  const out: TagSuggest[] = [];
  const seen = new Set<string>();
  const push = (s: TagSuggest) => {
    const id = s.kind === "combo" ? `c:${s.label}` : `t:${tagKey(s.tag || s.label)}`;
    if (seen.has(id)) return;
    seen.add(id);
    out.push(s);
  };

  const badge = (c: TagCatalogEntry): string[] => {
    const b: string[] = [];
    if (c.coverage === "overserved") b.push("over");
    else if (c.coverage === "underserved") b.push("under");
    else if (c.coverage === "unused") b.push("unused");
    if (c.official) b.push("official");
    if (c.yours) b.push("yours");
    return b.slice(0, 3);
  };

  const subOf = (c: TagCatalogEntry) => {
    if (c.yours) return `${c.bots} bot${c.bots === 1 ? "" : "s"} · ${c.lift.toFixed(2)}× lift`;
    if (c.marketN) return `not yours · ${c.marketN} new cards`;
    if (c.official) return "official catalog · unused";
    if (c.rivalBots) return `${c.rivalBots} neighbour bot${c.rivalBots === 1 ? "" : "s"}`;
    return "in catalog";
  };

  if (!raw) {
    const yours = catalog.filter((c) => c.yours).slice(0, 5);
    const unused = catalog
      .filter((c) => !c.yours && (c.official || c.marketN >= 3))
      .sort((a, b) => b.marketN - a.marketN)
      .slice(0, 5);
    for (const c of [...yours, ...unused]) {
      push({ kind: "tag", label: c.tag, sub: subOf(c), tag: c.tag, badges: badge(c) });
    }
    return out.slice(0, limit);
  }

  const q = raw.toLowerCase();
  const scored = catalog
    .map((c) => {
      const k = tagKey(c.tag);
      let score = 0;
      if (k === q) score = 100;
      else if (k.startsWith(q)) score = 80;
      else if (k.includes(q)) score = 50;
      else if (tagMatchesQuery(c.tag, q)) score = 30;
      else return null;
      if (c.yours) score += 4;
      if (c.coverage === "underserved") score += 3;
      return { c, score };
    })
    .filter((x): x is { c: TagCatalogEntry; score: number } => Boolean(x))
    .sort((a, b) => b.score - a.score || b.c.gain7 - a.c.gain7);

  for (const { c } of scored) {
    if (out.length >= limit) break;
    push({ kind: "tag", label: c.tag, sub: subOf(c), tag: c.tag, badges: badge(c) });
  }

  if (out.length < limit) {
    for (const combo of combos) {
      if (!comboMatchesQuery(combo.a, combo.b, q)) continue;
      push({
        kind: "combo",
        label: `${combo.a} × ${combo.b}`,
        sub: `${combo.bots} bot${combo.bots === 1 ? "" : "s"} · ${combo.lift.toFixed(2)}× vs solos`,
        pair: { a: combo.a, b: combo.b },
        badges: combo.lift >= 1.15 ? ["under"] : combo.lift < 0.9 ? ["over"] : [],
      });
      if (out.length >= limit) break;
    }
  }
  return out.slice(0, limit);
}
