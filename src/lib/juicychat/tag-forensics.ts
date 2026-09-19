/**
 * Tag forensics — traffic, success-when, combinations, and coverage gaps.
 *
 * SERVER-ONLY. Client UI must import query helpers from tag-forensics-view.ts
 * so Vite never pulls node:os / node:fs into the browser bundle.
 *
 * Chat flow comes from dated growth-history snapshots (per-bot chats + tags).
 * Engagement hours come from the notification timing archive when present.
 * Combinations are co-occurring tags on the same bot, scored against solo tags.
 * Coverage uses your mix vs warehouse lift, the official catalog, New-feed pond,
 * and neighbour tags to flag overserved and underserved tags / pairs.
 */
import { loadHistory } from "./history";
import { loadForensics } from "./forensics";
import { loadNewFeedStore } from "./new-feed";
import { analyzeTiming, type TimingAnalysis } from "./notifications";
import { dataPath } from "./paths";
import { loadRivals } from "./rivals";
import { rivalBotsFromEntries } from "./tag-competition";
import type { HistoryDay, HistoryFile, JuicyBot, LoungeSnapshot } from "./types";
import { existsSync, readFileSync } from "node:fs";
import { tagKey } from "./tag-forensics-view";
import { loungeTimezone } from "./timezone-server";

export type {
  NewFeedBotIn,
  NewFeedDayIn,
  PondTagCount,
  RivalTagBotIn,
  TagCatalogEntry,
  TagComboRow,
  TagCoverage,
  TagCreatorHit,
  TagForensics,
  TagGapRow,
  TagPopularityPoint,
  TagPopularityRow,
  TagSeriesPoint,
  TagSuggest,
  TagTrafficRow,
  TagWhenRow,
} from "./tag-forensics-view";
export { comboMatchesQuery, queryTokens, suggestTags, tagKey, tagMatchesQuery } from "./tag-forensics-view";

import type {
  NewFeedBotIn,
  NewFeedDayIn,
  PondTagCount,
  RivalTagBotIn,
  TagCatalogEntry,
  TagComboRow,
  TagCoverage,
  TagCreatorHit,
  TagForensics,
  TagGapRow,
  TagPopularityPoint,
  TagPopularityRow,
  TagSeriesPoint,
  TagTrafficRow,
  TagWhenRow,
} from "./tag-forensics-view";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

function displayTag(t: string) {
  return String(t || "").trim();
}

function weekdayOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return 0;
  return new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
}

function median(nums: number[]): number {
  const a = nums.filter((n) => Number.isFinite(n)).sort((x, y) => x - y);
  if (!a.length) return 0;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid]! : (a[mid - 1]! + a[mid]!) / 2;
}

function uniqueTags(raw: string[] | undefined | null): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of raw || []) {
    const k = tagKey(t);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(displayTag(t));
  }
  return out;
}

function hourLabel(h: number) {
  return `${String(h).padStart(2, "0")}:00`;
}

function peakIndex(arr: number[]): number | null {
  let best = -1;
  let idx: number | null = null;
  for (let i = 0; i < arr.length; i++) {
    if (arr[i]! > best) {
      best = arr[i]!;
      idx = i;
    }
  }
  return best > 0 ? idx : null;
}

function slotPhrase(weekdays: number[], hours: number[]): string {
  const peakDays = DAY_ORDER.filter((d) => (weekdays[d] || 0) > 0)
    .sort((a, b) => (weekdays[b] || 0) - (weekdays[a] || 0))
    .slice(0, 3);
  const peakHours = [...hours.keys()]
    .filter((h) => (hours[h] || 0) > 0)
    .sort((a, b) => (hours[b] || 0) - (hours[a] || 0))
    .slice(0, 2);
  const dayBit = peakDays.length ? peakDays.map((d) => DAY_LABELS[d]).join("–") : null;
  if (peakHours.length >= 2) {
    const a = Math.min(peakHours[0]!, peakHours[1]!);
    const b = Math.max(peakHours[0]!, peakHours[1]!);
    const timeBit = `${hourLabel(a)}–${hourLabel((b + 1) % 24)}`;
    return dayBit ? `${dayBit} ${timeBit}` : timeBit;
  }
  if (peakHours.length === 1) {
    const timeBit = `around ${hourLabel(peakHours[0]!)}`;
    return dayBit ? `${dayBit} ${timeBit}` : timeBit;
  }
  return dayBit || "not enough timing yet";
}

function pairKey(a: string, b: string) {
  const ka = tagKey(a);
  const kb = tagKey(b);
  return ka < kb ? `${ka}||${kb}` : `${kb}||${ka}`;
}

function pickDisplay(cur: string, next: string) {
  const n = displayTag(next);
  return n.length > cur.length ? n : cur;
}

type Mix = {
  tag: string;
  bots: Set<string>;
  chats: number;
  cpd: number;
  dChats: number;
  names: Map<string, string>;
};

export function analyzeTagForensics(input: {
  history?: HistoryFile | null;
  snapshot?: LoungeSnapshot | null;
  timing?: TimingAnalysis | null;
  forensicTags?: Record<string, string[]>;
  officialTags?: string[];
  pondTags?: PondTagCount[];
  rivalBots?: RivalTagBotIn[];
  newFeedDays?: NewFeedDayIn[];
  newFeedBots?: NewFeedBotIn[];
  now?: Date;
}): TagForensics {
  const history = input.history;
  const snapshot = input.snapshot;
  const timing = input.timing;
  const forensicTags = input.forensicTags || {};
  const days = [...(history?.days || [])].sort((a, b) => a.date.localeCompare(b.date));

  const lastTags = new Map<string, string[]>();
  for (const [id, tags] of Object.entries(forensicTags)) {
    const u = uniqueTags(tags);
    if (u.length) lastTags.set(id, u);
  }
  for (const b of snapshot?.bots || []) {
    const u = uniqueTags(b.characterTags);
    if (u.length) lastTags.set(b.characterId, u);
  }

  const tagsOf = (id: string, point?: HistoryDay["bots"][string]): string[] => {
    const fromDay = uniqueTags(point?.tags);
    if (fromDay.length) {
      lastTags.set(id, fromDay);
      return fromDay;
    }
    return lastTags.get(id) || [];
  };

  type Acc = {
    tag: string;
    bots: Set<string>;
    chats: number;
    gain7: number;
    gain30: number;
    byDate: Map<string, { gain: number; bots: Set<string> }>;
    byDow: number[];
  };
  const acc = new Map<string, Acc>();
  const bump = (raw: string): Acc => {
    const k = tagKey(raw);
    let row = acc.get(k);
    if (!row) {
      row = {
        tag: displayTag(raw),
        bots: new Set(),
        chats: 0,
        gain7: 0,
        gain30: 0,
        byDate: new Map(),
        byDow: Array(7).fill(0),
      };
      acc.set(k, row);
    } else {
      row.tag = pickDisplay(row.tag, raw);
    }
    return row;
  };

  const lastDay = days[days.length - 1];
  if (lastDay) {
    for (const [id, point] of Object.entries(lastDay.bots)) {
      for (const t of tagsOf(id, point)) {
        const row = bump(t);
        row.bots.add(id);
        row.chats += point.chats || 0;
      }
    }
  } else {
    for (const b of snapshot?.bots || []) {
      for (const t of uniqueTags(b.characterTags)) {
        const row = bump(t);
        row.bots.add(b.characterId);
        row.chats += b.chatCount ?? 0;
      }
    }
  }

  const cutoff7 = days.length >= 8 ? days[days.length - 8]!.date : days[0]?.date;
  const cutoff30 = days.length >= 31 ? days[days.length - 31]!.date : days[0]?.date;

  for (let i = 1; i < days.length; i++) {
    const prev = days[i - 1]!;
    const cur = days[i]!;
    const dow = weekdayOf(cur.date);
    for (const [id, point] of Object.entries(cur.bots)) {
      const before = prev.bots[id];
      const prevChats = before?.chats ?? point.chats ?? 0;
      const gain = Math.max(0, (point.chats || 0) - prevChats);
      const tags = tagsOf(id, point);
      if (!tags.length) continue;
      for (const t of tags) {
        const row = bump(t);
        row.bots.add(id);
        if (gain <= 0) continue;
        row.byDow[dow] += gain;
        const cell = row.byDate.get(cur.date) || { gain: 0, bots: new Set() };
        cell.gain += gain;
        cell.bots.add(id);
        row.byDate.set(cur.date, cell);
        if (!cutoff7 || cur.date > cutoff7) row.gain7 += gain;
        if (!cutoff30 || cur.date > cutoff30) row.gain30 += gain;
      }
    }
  }

  const spanDays = Math.max(1, days.length);
  const cpdList = [...acc.values()].map((r) => (r.bots.size ? r.gain30 / Math.min(30, spanDays) : 0));
  const cpdMed = median(cpdList.filter((n) => n > 0)) || 1;

  const timingByTag = new Map<string, { hours: number[]; bestHour: number | null }>();
  if (timing?.tags?.length) {
    for (const t of timing.tags) {
      const k = tagKey(t.tag);
      if (!k || k === "(untagged)") continue;
      const hours = Array.isArray(t.byHour) ? t.byHour.slice(0, 24) : Array(24).fill(0);
      while (hours.length < 24) hours.push(0);
      timingByTag.set(k, { hours, bestHour: peakIndex(hours) });
    }
  }

  const seriesDates = days.slice(-14).map((d) => d.date);
  const traffic: TagTrafficRow[] = [...acc.values()]
    .map((r) => {
      const k = tagKey(r.tag);
      const cpd = r.gain30 / Math.min(30, spanDays);
      const peakDow = peakIndex(r.byDow);
      const series: TagSeriesPoint[] = seriesDates.map((date) => {
        const cell = r.byDate.get(date);
        return {
          date,
          weekday: DAY_LABELS[weekdayOf(date)],
          gain: cell?.gain || 0,
          bots: cell?.bots.size || 0,
        };
      });
      return {
        tag: r.tag,
        bots: r.bots.size,
        chats: r.chats,
        gain7: r.gain7,
        gain30: r.gain30,
        chatsPerDay: cpd,
        lift: cpdMed ? cpd / cpdMed : 1,
        peakWeekday: peakDow != null ? DAY_LABELS[peakDow] : null,
        peakHour: timingByTag.get(k)?.bestHour ?? null,
        series,
      };
    })
    .sort((a, b) => b.gain7 - a.gain7 || b.chats - a.chats);

  const when: TagWhenRow[] = traffic
    .filter((t) => t.gain7 > 0 || t.gain30 > 0 || t.peakHour != null)
    .map((t) => {
      const k = tagKey(t.tag);
      const row = acc.get(k)!;
      const hours = timingByTag.get(k)?.hours || Array(24).fill(0);
      const dowTotal = row.byDow.reduce((s, n) => s + n, 0) || 1;
      const weekdays = DAY_ORDER.map((d) => ({
        day: DAY_LABELS[d],
        gain: row.byDow[d] || 0,
        share: (row.byDow[d] || 0) / dowTotal,
      })).filter((x) => x.gain > 0);
      const hourRows = hours
        .map((events, hour) => ({ hour, events }))
        .filter((x) => x.events > 0)
        .sort((a, b) => b.events - a.events);
      const successWhen = slotPhrase(row.byDow, hours);
      const evidenceParts = [
        t.gain7 ? `+${Math.round(t.gain7)} chats / 7d` : null,
        t.peakWeekday ? `warehouse peak ${t.peakWeekday}` : null,
        t.peakHour != null ? `likes/stars ${hourLabel(t.peakHour)}` : null,
        `${t.bots} bot${t.bots === 1 ? "" : "s"}`,
      ].filter(Boolean);
      return {
        tag: t.tag,
        successWhen,
        evidence: evidenceParts.join(" · "),
        weekdays,
        hours: hourRows.slice(0, 8),
        gain7: t.gain7,
        lift: t.lift,
      };
    })
    .sort((a, b) => b.lift - a.lift || b.gain7 - a.gain7);

  const mix = new Map<string, Mix>();
  const botList: Array<{ id: string; name: string; chats: number; dChats: number; tags: string[] }> = [];
  const prevDay = days.length >= 2 ? days[days.length - 2] : null;
  const srcBots: JuicyBot[] = snapshot?.bots || [];
  if (srcBots.length) {
    for (const b of srcBots) {
      const tags = uniqueTags(b.characterTags);
      const prev = prevDay?.bots[b.characterId];
      botList.push({
        id: b.characterId,
        name: b.characterName,
        chats: b.chatCount ?? 0,
        dChats: Math.max(0, (b.chatCount ?? 0) - (prev?.chats ?? b.chatCount ?? 0)),
        tags,
      });
    }
  } else if (lastDay) {
    for (const [id, point] of Object.entries(lastDay.bots)) {
      const tags = tagsOf(id, point);
      const prev = prevDay?.bots[id];
      botList.push({
        id,
        name: point.characterName,
        chats: point.chats,
        dChats: Math.max(0, point.chats - (prev?.chats ?? point.chats)),
        tags,
      });
    }
  }

  for (const b of botList) {
    for (const t of b.tags) {
      const k = tagKey(t);
      let row = mix.get(k);
      if (!row) {
        row = { tag: t, bots: new Set(), chats: 0, cpd: 0, dChats: 0, names: new Map() };
        mix.set(k, row);
      } else {
        row.tag = pickDisplay(row.tag, t);
      }
      row.bots.add(b.id);
      row.chats += b.chats;
      row.dChats += b.dChats;
      row.names.set(b.id, b.name);
    }
  }
  for (const row of mix.values()) {
    row.cpd = row.bots.size ? row.chats / row.bots.size : 0;
  }
  const soloMed = median([...mix.values()].map((m) => m.cpd).filter((n) => n > 0)) || 1;

  const comboMap = new Map<
    string,
    { a: string; b: string; bots: Set<string>; chats: number; dChats: number; names: string[] }
  >();
  for (const b of botList) {
    const tags = [...b.tags].sort((x, y) => tagKey(x).localeCompare(tagKey(y)));
    for (let i = 0; i < tags.length; i++) {
      for (let j = i + 1; j < tags.length; j++) {
        const a = tags[i]!;
        const c = tags[j]!;
        const key = pairKey(a, c);
        let row = comboMap.get(key);
        if (!row) {
          row = { a, b: c, bots: new Set(), chats: 0, dChats: 0, names: [] };
          comboMap.set(key, row);
        }
        if (!row.bots.has(b.id)) {
          row.bots.add(b.id);
          row.chats += b.chats;
          row.dChats += b.dChats;
          if (row.names.length < 4) row.names.push(b.name);
        }
      }
    }
  }

  const combos: TagComboRow[] = [...comboMap.values()]
    .filter((r) => r.bots.size >= 1)
    .map((r) => {
      const cpd = r.chats / r.bots.size;
      const soloA = mix.get(tagKey(r.a))?.cpd || soloMed;
      const soloB = mix.get(tagKey(r.b))?.cpd || soloMed;
      const expected = (soloA + soloB) / 2 || 1;
      return {
        a: r.a,
        b: r.b,
        bots: r.bots.size,
        chats: r.chats,
        chatsPerDay: cpd,
        lift: expected ? cpd / expected : 1,
        dChats: r.dChats,
        names: r.names,
      };
    })
    .sort((a, b) => b.lift - a.lift || b.chats - a.chats);

  const official = new Map<string, string>();
  for (const t of input.officialTags || []) {
    const k = tagKey(t);
    if (!k) continue;
    official.set(k, pickDisplay(official.get(k) || "", t));
  }

  const pond = new Map<string, { tag: string; n: number; chats: number }>();
  for (const p of input.pondTags || []) {
    const k = tagKey(p.tag);
    if (!k) continue;
    const cur = pond.get(k) || { tag: displayTag(p.tag), n: 0, chats: 0 };
    cur.tag = pickDisplay(cur.tag, p.tag);
    cur.n += p.n || 0;
    cur.chats += p.chats || 0;
    pond.set(k, cur);
  }

  const rivalCount = new Map<string, { tag: string; bots: number; chats: number }>();
  const rivalPairs = new Map<
    string,
    { a: string; b: string; bots: number; chats: number; names: string[] }
  >();
  for (const b of input.rivalBots || []) {
    const tags = uniqueTags(b.tags);
    const seen = new Set<string>();
    for (const t of tags) {
      const k = tagKey(t);
      if (!k || seen.has(k)) continue;
      seen.add(k);
      const cur = rivalCount.get(k) || { tag: displayTag(t), bots: 0, chats: 0 };
      cur.tag = pickDisplay(cur.tag, t);
      cur.bots += 1;
      cur.chats += b.chats || 0;
      rivalCount.set(k, cur);
    }
    const sorted = [...tags].sort((x, y) => tagKey(x).localeCompare(tagKey(y)));
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const a = sorted[i]!;
        const c = sorted[j]!;
        const key = pairKey(a, c);
        const cur = rivalPairs.get(key) || { a, b: c, bots: 0, chats: 0, names: [] };
        cur.bots += 1;
        cur.chats += b.chats || 0;
        if (cur.names.length < 3 && b.characterName) cur.names.push(b.characterName);
        rivalPairs.set(key, cur);
      }
    }
  }

  const trafficByKey = new Map(traffic.map((t) => [tagKey(t.tag), t] as const));
  const catalogKeys = new Set<string>([
    ...trafficByKey.keys(),
    ...official.keys(),
    ...pond.keys(),
    ...rivalCount.keys(),
    ...mix.keys(),
  ]);

  const totalBots = Math.max(1, botList.length);
  const catalog: TagCatalogEntry[] = [...catalogKeys]
    .map((k) => {
      const t = trafficByKey.get(k);
      const off = official.get(k);
      const p = pond.get(k);
      const riv = rivalCount.get(k);
      const mx = mix.get(k);
      const tag = pickDisplay(pickDisplay(t?.tag || mx?.tag || "", off || ""), p?.tag || riv?.tag || k);
      const bots = t?.bots || mx?.bots.size || 0;
      const lift = t?.lift ?? 1;
      const yours = bots > 0;
      const sources: TagCatalogEntry["sources"] = [];
      if (t || mx) sources.push("warehouse");
      if (off) sources.push("official");
      if (p) sources.push("new-feed");
      if (riv) sources.push("rival");
      let coverage: TagCoverage = "balanced";
      if (!yours) coverage = "unused";
      else if (bots >= 3 && lift < 0.9) coverage = "overserved";
      else if (bots / totalBots >= 0.28 && bots >= 3 && lift <= 1) coverage = "overserved";
      else if ((p?.n || 0) >= 8 && bots >= 2 && lift < 1) coverage = "overserved";
      else if (bots <= 2 && lift >= 1.15 && (t?.gain7 || 0) > 0) coverage = "underserved";
      return {
        tag,
        bots,
        chats: t?.chats || mx?.chats || 0,
        gain7: t?.gain7 || 0,
        gain30: t?.gain30 || 0,
        chatsPerDay: t?.chatsPerDay || 0,
        lift,
        official: Boolean(off),
        yours,
        marketN: p?.n || 0,
        marketChats: p?.chats || 0,
        rivalBots: riv?.bots || 0,
        coverage,
        sources,
      };
    })
    .sort((a, b) => b.gain7 - a.gain7 || b.bots - a.bots || a.tag.localeCompare(b.tag));

  const catByKey = new Map(catalog.map((c) => [tagKey(c.tag), c] as const));
  const overserved: TagGapRow[] = [];
  const underserved: TagGapRow[] = [];

  for (const c of catalog) {
    const share = c.bots / totalBots;
    const crowded = c.marketN >= 8 || c.rivalBots >= 4;
    if (c.bots >= 3 && c.lift < 0.9) {
      overserved.push({
        kind: "overserved",
        subject: "tag",
        tag: c.tag,
        score: c.bots * (1.1 - Math.min(1, c.lift)),
        why: `${c.bots} bots on a below-median tag (${c.lift.toFixed(2)}×). Thin the stack or retag.`,
        bots: c.bots,
        lift: c.lift,
        marketN: c.marketN,
      });
    } else if (share >= 0.28 && c.bots >= 3 && c.lift <= 1) {
      overserved.push({
        kind: "overserved",
        subject: "tag",
        tag: c.tag,
        score: share * 3,
        why: `${Math.round(share * 100)}% of the roster wears this without extra lift.`,
        bots: c.bots,
        lift: c.lift,
        marketN: c.marketN,
      });
    } else if (crowded && c.bots >= 2 && c.lift < 1) {
      overserved.push({
        kind: "overserved",
        subject: "tag",
        tag: c.tag,
        score: (c.marketN + c.rivalBots) / Math.max(0.25, c.lift),
        why: `Crowded lane (${c.marketN} new cards, ${c.rivalBots} neighbour bots) at ${c.lift.toFixed(2)}×.`,
        bots: c.bots,
        lift: c.lift,
        marketN: c.marketN,
      });
    }

    if (c.yours && c.bots <= 2 && c.lift >= 1.15 && (c.gain7 > 0 || c.chatsPerDay > 0)) {
      underserved.push({
        kind: "underserved",
        subject: "tag",
        tag: c.tag,
        score: c.lift / Math.max(1, c.bots),
        why: `${c.lift.toFixed(2)}× lift on only ${c.bots} bot${c.bots === 1 ? "" : "s"}. Room to add another ship.`,
        bots: c.bots,
        lift: c.lift,
        marketN: c.marketN,
      });
    } else if (!c.yours && c.official && c.marketN >= 3) {
      underserved.push({
        kind: "underserved",
        subject: "tag",
        tag: c.tag,
        score: c.marketN + c.rivalBots * 0.5,
        why: `Official tag you don't use — ${c.marketN} new cards in the pond.`,
        bots: 0,
        lift: c.lift,
        marketN: c.marketN,
      });
    } else if (!c.yours && c.marketN >= 5) {
      underserved.push({
        kind: "underserved",
        subject: "tag",
        tag: c.tag,
        score: c.marketN,
        why: `${c.marketN} new-feed cards, zero of yours.`,
        bots: 0,
        lift: c.lift,
        marketN: c.marketN,
      });
    }
  }

  for (const combo of combos) {
    if (combo.bots >= 2 && combo.lift < 0.9) {
      overserved.push({
        kind: "overserved",
        subject: "combo",
        tag: `${combo.a} × ${combo.b}`,
        pair: { a: combo.a, b: combo.b },
        score: combo.bots * (1.1 - Math.min(1, combo.lift)),
        why: `Pair underperforms each tag alone (${combo.lift.toFixed(2)}×).`,
        bots: combo.bots,
        lift: combo.lift,
        marketN: 0,
        names: combo.names,
      });
    }
    if (combo.bots === 1 && combo.lift >= 1.15) {
      underserved.push({
        kind: "underserved",
        subject: "combo",
        tag: `${combo.a} × ${combo.b}`,
        pair: { a: combo.a, b: combo.b },
        score: combo.lift,
        why: `Winning pair on a single bot. Clone the combo.`,
        bots: 1,
        lift: combo.lift,
        marketN: 0,
        names: combo.names,
      });
    }
  }

  const observedKeys = new Set(combos.map((c) => pairKey(c.a, c.b)));
  const highYours = catalog
    .filter((c) => c.yours && c.lift >= 1.05)
    .sort((a, b) => b.lift - a.lift)
    .slice(0, 12);
  for (let i = 0; i < highYours.length; i++) {
    for (let j = i + 1; j < highYours.length; j++) {
      const a = highYours[i]!;
      const b = highYours[j]!;
      const key = pairKey(a.tag, b.tag);
      if (observedKeys.has(key)) continue;
      const expected = (a.lift + b.lift) / 2;
      underserved.push({
        kind: "underserved",
        subject: "combo",
        tag: `${a.tag} × ${b.tag}`,
        pair: { a: a.tag, b: b.tag },
        score: expected,
        why: `You run both tags, never on the same bot.`,
        bots: 0,
        lift: expected,
        marketN: 0,
      });
      observedKeys.add(key);
    }
  }

  for (const rp of [...rivalPairs.values()].sort((a, b) => b.chats - a.chats)) {
    if (rp.bots < 2) continue;
    const key = pairKey(rp.a, rp.b);
    if (observedKeys.has(key)) continue;
    const aYours = catByKey.get(tagKey(rp.a))?.yours;
    const bYours = catByKey.get(tagKey(rp.b))?.yours;
    if (aYours && bYours) continue;
    underserved.push({
      kind: "underserved",
      subject: "combo",
      tag: `${rp.a} × ${rp.b}`,
      pair: { a: rp.a, b: rp.b },
      score: rp.bots + rp.chats / 1000,
      why: `Neighbours pair this on ${rp.bots} bots${rp.names.length ? ` (${rp.names.slice(0, 2).join(", ")})` : ""}. You don't.`,
      bots: 0,
      lift: 1,
      marketN: rp.bots,
      names: rp.names,
    });
    observedKeys.add(key);
  }

  overserved.sort((a, b) => b.score - a.score);
  underserved.sort((a, b) => b.score - a.score);

  const youId = String(snapshot?.userId || snapshot?.profile?.userId || "").trim();
  const youName = snapshot?.profile?.userName || "You";
  const popularity = buildPopularity({
    days: input.newFeedDays || [],
    feedBots: input.newFeedBots || [],
    traffic,
    youId,
    youName,
    youBots: botList,
    rivalBots: input.rivalBots || [],
  });

  return {
    timezone: loungeTimezone(),
    generatedAt: (input.now || new Date()).toISOString(),
    daysTracked: days.length,
    botCount: botList.length || snapshot?.bots?.length || 0,
    timingEvents: timing?.eventCount || 0,
    officialCount: official.size,
    catalogSize: catalog.length,
    feedDays: (input.newFeedDays || []).length,
    traffic,
    when,
    combos,
    catalog,
    overserved: overserved.slice(0, 16),
    underserved: underserved.slice(0, 16),
    popularity,
  };
}

function buildPopularity(input: {
  days: NewFeedDayIn[];
  feedBots: NewFeedBotIn[];
  traffic: TagTrafficRow[];
  youId: string;
  youName: string;
  youBots: Array<{ id: string; name: string; chats: number; tags: string[] }>;
  rivalBots: RivalTagBotIn[];
}): TagPopularityRow[] {
  const days = [...input.days].sort((a, b) => a.date.localeCompare(b.date)).slice(-30);
  const tracked = new Set<string>();
  if (input.youId) tracked.add(input.youId);
  for (const b of input.rivalBots) {
    const id = String(b.userId || "").trim();
    if (id) tracked.add(id);
  }

  type Cell = { cards: number; known: number };
  const byTag = new Map<string, { tag: string; byDate: Map<string, Cell> }>();
  const bump = (raw: string, date: string, known: boolean) => {
    const k = tagKey(raw);
    if (!k) return;
    let row = byTag.get(k);
    if (!row) {
      row = { tag: displayTag(raw), byDate: new Map() };
      byTag.set(k, row);
    } else {
      row.tag = pickDisplay(row.tag, raw);
    }
    const cell = row.byDate.get(date) || { cards: 0, known: 0 };
    cell.cards += 1;
    if (known) cell.known += 1;
    row.byDate.set(date, cell);
  };

  for (const day of days) {
    const titles = day.titles || [];
    if (titles.length) {
      for (const t of titles) {
        const known = Boolean(t.userId && tracked.has(t.userId));
        for (const tag of uniqueTags(t.tags)) bump(tag, day.date, known);
      }
    } else {
      for (const tc of day.tagCounts || []) {
        const k = tagKey(tc.tag);
        if (!k) continue;
        let row = byTag.get(k);
        if (!row) {
          row = { tag: displayTag(tc.tag), byDate: new Map() };
          byTag.set(k, row);
        }
        const cell = row.byDate.get(day.date) || { cards: 0, known: 0 };
        cell.cards += tc.n || 0;
        row.byDate.set(day.date, cell);
      }
    }
  }

  const gainByTagDate = new Map<string, Map<string, number>>();
  for (const t of input.traffic) {
    const m = new Map<string, number>();
    for (const p of t.series) m.set(p.date, p.gain);
    gainByTagDate.set(tagKey(t.tag), m);
  }

  type AccCreator = TagCreatorHit;
  const creatorsByTag = new Map<string, Map<string, AccCreator>>();
  const tagLabel = new Map<string, string>();
  const addCreator = (
    tag: string,
    userId: string,
    userName: string,
    from: TagCreatorHit["from"],
    botName: string,
    chats: number,
    lastDate?: string | null,
  ) => {
    const k = tagKey(tag);
    if (!k || !userId) return;
    tagLabel.set(k, pickDisplay(tagLabel.get(k) || "", tag));
    let map = creatorsByTag.get(k);
    if (!map) {
      map = new Map();
      creatorsByTag.set(k, map);
    }
    const id = `${from}:${userId}`;
    const cur = map.get(id) || {
      userId,
      userName: userName || userId,
      from,
      bots: 0,
      chats: 0,
      names: [],
      lastDate: lastDate || null,
    };
    cur.bots += 1;
    cur.chats += chats || 0;
    if (userName && userName.length > (cur.userName?.length || 0)) cur.userName = userName;
    if (botName && cur.names.length < 4 && !cur.names.includes(botName)) cur.names.push(botName);
    if (lastDate && (!cur.lastDate || lastDate > cur.lastDate)) cur.lastDate = lastDate;
    map.set(id, cur);
  };

  for (const b of input.youBots) {
    for (const t of b.tags) {
      addCreator(t, input.youId || "you", input.youName, "you", b.name, b.chats);
    }
  }
  const rivalSeen = new Set<string>();
  for (const b of input.rivalBots) {
    const uid = String(b.userId || b.userName || "").trim();
    if (!uid) continue;
    const key = `${uid}:${b.characterId || b.characterName}`;
    if (rivalSeen.has(key)) continue;
    rivalSeen.add(key);
    for (const t of uniqueTags(b.tags)) {
      addCreator(t, uid, b.userName || uid, "rival", b.characterName || "", b.chats || 0);
    }
  }
  for (const b of input.feedBots) {
    const uid = String(b.userId || "").trim();
    if (!uid) continue;
    if (input.youId && uid === input.youId) continue;
    if (tracked.has(uid) && uid !== input.youId) continue;
    for (const t of uniqueTags(b.tags)) {
      addCreator(
        t,
        uid,
        b.userName || uid,
        "new-feed",
        b.characterName || "",
        b.chats || 0,
        b.lastDate,
      );
    }
  }

  const dates = days.map((d) => d.date);
  const cutoff7 = dates.length >= 8 ? dates[dates.length - 8]! : dates[0];
  const prev7Start = dates.length >= 15 ? dates[dates.length - 15]! : dates[0];
  const out: TagPopularityRow[] = [];

  const keys = new Set([...byTag.keys(), ...creatorsByTag.keys()]);
  for (const k of keys) {
    const row = byTag.get(k);
    const series: TagPopularityPoint[] = dates.map((date) => {
      const cell = row?.byDate.get(date);
      return {
        date,
        weekday: DAY_LABELS[weekdayOf(date)],
        cards: cell?.cards || 0,
        knownCards: cell?.known || 0,
        yourGain: gainByTagDate.get(k)?.get(date) || 0,
      };
    });
    let cards7 = 0;
    let cardsPrev7 = 0;
    let cards30 = 0;
    let known7 = 0;
    for (const p of series) {
      cards30 += p.cards;
      if (!cutoff7 || p.date > cutoff7) {
        cards7 += p.cards;
        known7 += p.knownCards;
      } else if (prev7Start && p.date > prev7Start) {
        cardsPrev7 += p.cards;
      }
    }
    const creators = [...(creatorsByTag.get(k)?.values() || [])].sort(
      (a, b) =>
        (a.from === "you" ? 0 : a.from === "rival" ? 1 : 2) -
          (b.from === "you" ? 0 : b.from === "rival" ? 1 : 2) ||
        b.chats - a.chats,
    );
    const trackedCreators = creators.filter((c) => c.from === "you" || c.from === "rival").length;
    if (!cards30 && !trackedCreators) continue;
    out.push({
      tag: row?.tag || tagLabel.get(k) || k,
      cards7,
      cards30,
      delta: cards7 - cardsPrev7,
      knownShare: cards7 > 0 ? known7 / cards7 : 0,
      trackedCreators,
      series,
      creators: creators.slice(0, 24),
    });
  }

  return out.sort((a, b) => b.cards7 - a.cards7 || b.trackedCreators - a.trackedCreators);
}

export function buildTagForensics(input?: {
  snapshot?: LoungeSnapshot | null;
  timing?: TimingAnalysis | null;
}): TagForensics {
  let forensicTags: Record<string, string[]> = {};
  try {
    const file = loadForensics();
    for (const [id, bot] of Object.entries(file.bots || {})) {
      if (bot.identity?.tags?.length) forensicTags[id] = bot.identity.tags;
    }
  } catch {
    forensicTags = {};
  }
  let timing = input?.timing ?? null;
  if (!timing) {
    try {
      timing = analyzeTiming();
    } catch {
      timing = null;
    }
  }
  let history: HistoryFile | null = null;
  try {
    history = loadHistory();
  } catch {
    history = null;
  }
  let officialTags: string[] = [];
  let pondTags: PondTagCount[] = [];
  let newFeedDays: NewFeedDayIn[] = [];
  let newFeedBots: NewFeedBotIn[] = [];
  try {
    const store = loadNewFeedStore();
    officialTags = store?.officialTags || [];
    const counts = new Map<string, PondTagCount>();
    for (const c of store?.latest || []) {
      for (const t of uniqueTags(c.tags)) {
        const k = tagKey(t);
        const cur = counts.get(k) || { tag: t, n: 0, chats: 0 };
        cur.n += 1;
        cur.chats = (cur.chats || 0) + (c.chatCount ?? 0);
        counts.set(k, cur);
      }
    }
    pondTags = [...counts.values()];
    newFeedDays = (store?.days || []).map((d) => ({
      date: d.date,
      tagCounts: d.tagCounts,
      titles: (d.titles || []).map((t) => ({
        characterId: t.characterId,
        characterName: t.characterName,
        userId: t.userId,
        userName: t.userName,
        tags: t.tags,
        chats: t.chats,
      })),
    }));
    newFeedBots = Object.values(store?.catalog || {}).map((b) => ({
      characterId: b.characterId,
      characterName: b.characterName,
      userId: b.userId,
      userName: b.userName,
      tags: b.tags,
      chats: b.chatCount,
      lastDate: b.lastSeenDate,
      own: b.own,
    }));
  } catch {
    officialTags = [];
    pondTags = [];
    newFeedDays = [];
    newFeedBots = [];
  }
  let rivalBots: RivalTagBotIn[] = [];
  try {
    const file = loadRivals();
    rivalBots = rivalBotsFromEntries([...(file.rivals || []), ...(file.alumni || [])]);
  } catch {
    rivalBots = [];
  }
  let snapshot = input?.snapshot ?? null;
  if (!snapshot) {
    try {
      const p = dataPath("creator-dashboard.json");
      if (existsSync(p)) {
        const d = JSON.parse(readFileSync(p, "utf8")) as { snapshot?: LoungeSnapshot | null };
        snapshot = d?.snapshot ?? null;
      }
    } catch {
      snapshot = null;
    }
  }
  return analyzeTagForensics({
    history,
    snapshot,
    timing,
    forensicTags,
    officialTags,
    pondTags,
    rivalBots,
    newFeedDays,
    newFeedBots,
  });
}

export function emptyTagForensics(): TagForensics {
  return {
    timezone: loungeTimezone(),
    generatedAt: new Date().toISOString(),
    daysTracked: 0,
    botCount: 0,
    timingEvents: 0,
    officialCount: 0,
    catalogSize: 0,
    traffic: [],
    when: [],
    combos: [],
    catalog: [],
    overserved: [],
    underserved: [],
    popularity: [],
    feedDays: 0,
  };
}
