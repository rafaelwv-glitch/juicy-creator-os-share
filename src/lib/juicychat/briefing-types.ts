export type HeatPrinter = {
  characterId: string;
  characterName: string;
  characterThumb?: string;
  chats7d: number;
  likes7d: number;
  favorites7d: number;
  dodChats: number;
  share: number;
  ageDays: number | null;
};

export type WeekHeat = {
  chats: number;
  likes: number;
  favorites: number;
  followers: number;
  printers: HeatPrinter[];
  daily: Array<{ date: string; chats: number; likes: number; favorites: number }>;
  topShare: number;
};

export type ClockItem = {
  characterId: string;
  characterName: string;
  characterThumb?: string;
  chats: number;
  waitDays: number | null;
  firstSeen: string | null;
  gmtCreate?: string | number;
  status: "pending_release" | "under_review" | "published" | "rejected" | "review" | "gone";
};

export type ClockJob = {
  id: string;
  characterId: string;
  characterName: string;
  fireAtMs: number;
  status: string;
};

export type ClockBrief = {
  waiting: ClockItem[];
  review: ClockItem[];
  inbound: ClockItem[];
  outbound: ClockItem[];
  scheduled: ClockJob[];
};

export type SpikeKind = "new-engine" | "old-comedy" | "steady" | "flash";

export type SpikeRow = {
  characterId: string;
  characterName: string;
  characterThumb?: string;
  kind: SpikeKind;
  ageDays: number | null;
  dodChats: number;
  chats7d: number;
  share7d: number;
  chats: number;
};

export type SpikeBrief = {
  headline: string;
  detail: string;
  rows: SpikeRow[];
  newEngineShare: number;
  oldComedyShare: number;
};

export type CreatorBriefing = {
  at: string;
  heat: WeekHeat;
  clock: ClockBrief;
  spikes: SpikeBrief;
};
