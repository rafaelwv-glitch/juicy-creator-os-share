/** Timestamped lounge report for GitHub → Grok publish advisor. */
import type { JuicyBot, LoungeSnapshot, GrowthAnalysis } from "./types";
import { classifyBot, toQueueRow, type PublishStatus } from "./publish-bots";
import { loungeTimezone } from "./timezone-server";

function clip(s: string, n: number) {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= n ? t : t.slice(0, n - 1) + "…";
}

function firstSentence(s: string) {
  const t = clip(s, 400);
  const m = t.match(/^(.+?[.!?])(\s|$)/);
  return m ? m[1] : t;
}

function isoFromGmt(v: string | number | null | undefined): string | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") {
    const ms = v < 1e12 ? v * 1000 : v;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? String(v) : d.toISOString();
  }
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : d.toISOString();
}

export function botReportRow(bot: JuicyBot) {
  const row = toQueueRow(bot);
  const tags = row.tags || [];
  return {
    characterId: row.characterId,
    name: row.characterName,
    status: row.status as PublishStatus,
    statusLabel: row.statusLabel,
    canPublish: row.canPublish,
    tags,
    genre: tags[0] || null,
    extraTags: tags.slice(1, 8),
    topic: firstSentence(String(bot.introduction || bot.personality || "")),
    introduction: bot.introduction ? clip(String(bot.introduction), 280) : null,
    personality: bot.personality ? clip(String(bot.personality), 160) : null,
    rating: bot.rating != null ? String(bot.rating) : null,
    visibility: row.visibilityLabel,
    createdAt: isoFromGmt(bot.gmtCreate),
    chats: row.chats,
  };
}

export function classifyCounts(bots: JuicyBot[]) {
  const counts: Record<string, number> = {
    pending_release: 0,
    under_review: 0,
    draft: 0,
    rejected: 0,
    taken_private: 0,
    live: 0,
  };
  for (const b of bots) counts[classifyBot(b)] = (counts[classifyBot(b)] || 0) + 1;
  return counts;
}

export function buildLoungeReport(opts: {
  snapshot: LoungeSnapshot | null;
  growth: GrowthAnalysis | null;
  appVersion: string;
  timezone?: string;
}) {
  const snap = opts.snapshot;
  const bots = snap?.bots || [];
  const unpublished = bots.filter((b) => classifyBot(b) !== "live").map(botReportRow);
  const live = bots.filter((b) => classifyBot(b) === "live");
  const counts = classifyCounts(bots);
  return {
    schema: "juicy-lounge-report/v1",
    generatedAt: new Date().toISOString(),
    timezone: opts.timezone || loungeTimezone(),
    appVersion: opts.appVersion,
    creator: {
      userId: snap?.profile?.userId || snap?.userId || null,
      userName: snap?.profile?.userName || null,
    },
    kpis: {
      bots: snap?.totals.bots || bots.length,
      chats: snap?.totals.chats || 0,
      likes: snap?.totals.likes || 0,
      favorites: snap?.totals.favorites || 0,
      interactions: snap?.totals.interactions || 0,
      followers: snap?.totals.followers || 0,
      dayDelta: opts.growth?.dayOverDay || null,
      weekDelta: opts.growth?.last7Days || null,
    },
    unpublished: {
      counts: {
        ...counts,
        totalUnreleased: unpublished.length,
      },
      bots: unpublished,
    },
    liveTop: live.slice(0, 15).map((b) => ({
      characterId: b.characterId,
      name: b.characterName,
      tags: (b.characterTags || []).slice(0, 6),
      chats: b.chatCount || 0,
      likes: b.likeCount || 0,
    })),
    note: "Suggest publish date/time in the lounge timezone per unpublished bot using tags/genre/topic. Pending release first. Stagger same-tag drops.",
  };
}
