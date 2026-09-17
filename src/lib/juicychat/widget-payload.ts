import type { CreatorDashboard } from "./dashboard";

export function widgetPayload(dash: CreatorDashboard | null) {
  const snap = dash?.snapshot;
  const day = dash?.growth?.dayOverDay;
  return {
    userName: snap?.profile?.userName || snap?.userId || "",
    userId: snap?.profile?.userId || snap?.userId || "",
    bots: snap?.totals?.bots ?? snap?.bots?.length ?? 0,
    chats: snap?.totals?.chats ?? 0,
    likes: snap?.totals?.likes ?? 0,
    favorites: snap?.totals?.favorites ?? 0,
    followers: snap?.totals?.followers ?? 0,
    interactions: snap?.totals?.interactions ?? 0,
    chatsDelta: day?.chats ?? 0,
    likesDelta: day?.likes ?? 0,
    scrapedAt: dash?.scrapedAt || snap?.scrapedAt || null,
    source: dash?.source || "cache",
  };
}
