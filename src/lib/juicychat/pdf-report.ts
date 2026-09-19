/**
 * Multi-page Juicy Lounge analytics PDF — cover, KPIs, and every insight we have.
 * Browser-safe (no Node Buffer). Helvetica + Helvetica-Bold, A4.
 */
import type { GrowthAnalysis, LoungeSnapshot } from "./types";
import type { TimingAnalysis } from "./notifications";
import type { CreatorInsights } from "./insights";
import type { DeepSignals } from "./deep-signals";
import type { PublishAnalysis } from "./publish-analysis";
import type { RivalCompareResult } from "./rivals";
import type { ForensicIndex } from "./forensics";
import type { FollowerAnalysis } from "./followers";
import type { EconomySnapshot } from "./economy";
import { analyzeProduction, LIFECYCLE_LABEL, DEFAULT_HOURS, formatScore10 } from "./production";
import { deriveCommentPulse } from "./comment-pulse";
import { deriveTagCompetition } from "./tag-competition";
import { analyzeExposure, EXPOSURE_LABEL, formatExposureRatio, formatLiftPts } from "./exposure";
import type { NewFeedView } from "./new-feed";
import type { DashboardSignals } from "./dashboard-signals";
import type { TagForensics } from "./tag-forensics";
import { getDisplayTimezone, timezoneCity } from "./timezone";

export type PdfReportInput = {
  snapshot: LoungeSnapshot | null;
  growth: GrowthAnalysis | null;
  timing: TimingAnalysis | null;
  insights: CreatorInsights | null;
  deep?: DeepSignals | null;
  publish?: PublishAnalysis | null;
  rivals?: RivalCompareResult | null;
  forensics?: ForensicIndex | null;
  followers?: FollowerAnalysis | null;
  economy?: EconomySnapshot | null;
  newFeed?: NewFeedView | null;
  signals?: DashboardSignals | null;
  tagForensics?: TagForensics | null;
  accountLabel?: string;
  lookbackDays?: number;
};

type RGB = [number, number, number];

const INK: RGB = [0.07, 0.075, 0.16];
const MUTED: RGB = [0.36, 0.38, 0.55];
const FAINT: RGB = [0.62, 0.64, 0.76];
const PRIMARY: RGB = [0.545, 0.486, 1];
const PRIMARY_DARK: RGB = [0.27, 0.22, 0.58];
const ACCENT: RGB = [1, 0.42, 0.71];
const SUCCESS: RGB = [0.15, 0.62, 0.42];
const TILE: RGB = [0.945, 0.94, 1];
const HEAD: RGB = [0.93, 0.92, 0.99];
const LINE: RGB = [0.86, 0.87, 0.93];
const WHITE: RGB = [1, 1, 1];
const PAPER: RGB = [0.988, 0.988, 1];

function esc(s: string) {
  const latin1 = String(s ?? "")
    .replace(/[—–]/g, "-")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/…/g, "...")
    .replace(/→/g, "->")
    .replace(/←/g, "<-")
    .replace(/×/g, "x")
    .replace(/★/g, "*")
    .replace(/·/g, " | ")
    .replace(/[^\x00-\xff]/g, "?");
  return latin1.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function formatNum(n: number | null | undefined) {
  if (n == null || Number.isNaN(n)) return "—";
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(Math.round(n));
}

function formatFull(n: number | null | undefined) {
  if (n == null || Number.isNaN(n)) return "—";
  return Number(n).toLocaleString("en-US");
}

function formatDelta(n: number | null | undefined) {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${formatNum(n)}`;
}

function fmtScore(n: number | null | undefined) {
  if (n == null || Number.isNaN(n)) return "—";
  if (n > 1000) return (n / 100_000).toFixed(2);
  return n.toFixed(1);
}

function clip(s: string, n: number) {
  const t = String(s || "");
  return t.length > n ? `${t.slice(0, n - 1)}...` : t;
}

function rgb(c: RGB) {
  return `${c[0].toFixed(3)} ${c[1].toFixed(3)} ${c[2].toFixed(3)}`;
}

class PdfBuilder {
  pageW = 595;
  pageH = 842;
  margin = 40;
  y = 800;
  pages: string[] = [];
  buf: string[] = [];
  chrome = true;

  paintChrome() {
    this.buf.push(`q ${rgb(PAPER)} rg 0 0 ${this.pageW} ${this.pageH} re f Q`);
    this.buf.push(`q ${rgb(PRIMARY_DARK)} rg 0 ${this.pageH - 28} ${this.pageW} 28 re f Q`);
    this.buf.push(
      `BT /F2 9 Tf ${rgb(WHITE)} rg ${this.margin} ${this.pageH - 18} Td (${esc("Juicy Lounge  ·  Creator analytics")}) Tj ET`,
    );
    this.y = this.pageH - 48;
  }

  flush() {
    if (!this.buf.length) return;
    const n = this.pages.length + 1;
    this.buf.push(`q ${rgb(LINE)} RG 0.4 w ${this.margin} 28 m ${this.pageW - this.margin} 28 l S Q`);
    this.buf.push(
      `BT /F1 8 Tf ${rgb(FAINT)} rg ${this.margin} 16 Td (${esc(`No credentials  ·  ${getDisplayTimezone()}  ·  Juicy Lounge warehouse`)}) Tj ET`,
    );
    this.buf.push(
      `BT /F2 8 Tf ${rgb(MUTED)} rg ${this.pageW - this.margin - 50} 16 Td (${esc(`Page ${n}`)}) Tj ET`,
    );
    this.pages.push(this.buf.join("\n"));
    this.buf = [];
  }

  need(h: number) {
    if (!this.buf.length) this.paintChrome();
    if (this.y - h < 44) {
      this.flush();
      this.paintChrome();
    }
  }

  fill(x: number, y: number, w: number, h: number, c: RGB) {
    this.buf.push(`q ${rgb(c)} rg ${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f Q`);
  }

  stroke(x: number, y: number, w: number, h: number, c: RGB, lw = 0.6) {
    this.buf.push(
      `q ${rgb(c)} RG ${lw} w ${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re S Q`,
    );
  }

  at(str: string, x: number, y: number, opts?: { size?: number; bold?: boolean; color?: RGB }) {
    const size = opts?.size ?? 9;
    const font = opts?.bold ? "F2" : "F1";
    const color = opts?.color ?? INK;
    this.buf.push(
      `BT /${font} ${size} Tf ${rgb(color)} rg ${x.toFixed(2)} ${y.toFixed(2)} Td (${esc(str)}) Tj ET`,
    );
  }

  text(str: string, opts?: { size?: number; gap?: number; x?: number; bold?: boolean; color?: RGB }) {
    const size = opts?.size ?? 9;
    const x = opts?.x ?? this.margin;
    this.need(size + 6);
    this.at(str, x, this.y, { size, bold: opts?.bold, color: opts?.color });
    this.y -= size + (opts?.gap ?? 4);
  }

  heading(str: string, size = 13) {
    this.need(size + 22);
    this.y -= 8;
    this.fill(this.margin, this.y - 4, 3.5, size + 6, PRIMARY);
    this.at(str, this.margin + 10, this.y, { size, bold: true, color: PRIMARY_DARK });
    this.y -= size + 10;
  }

  kv(k: string, v: string) {
    this.need(14);
    this.at(k, this.margin, this.y, { size: 8, color: MUTED });
    this.at(v, this.margin + 130, this.y, { size: 9, bold: true, color: INK });
    this.y -= 13;
  }

  para(str: string, size = 9) {
    const width = 90;
    const words = String(str || "").split(/\s+/);
    let line = "";
    for (const w of words) {
      const next = line ? `${line} ${w}` : w;
      if (next.length > width) {
        this.text(line, { size, gap: 3, color: MUTED });
        line = w;
      } else line = next;
    }
    if (line) this.text(line, { size, gap: 5, color: MUTED });
  }

  rule() {
    this.need(10);
    this.buf.push(
      `q ${rgb(LINE)} RG 0.5 w ${this.margin} ${this.y} m ${this.pageW - this.margin} ${this.y} l S Q`,
    );
    this.y -= 10;
  }

  kpiRow(items: Array<{ label: string; value: string; sub?: string }>) {
    const n = items.length;
    const gap = 8;
    const usable = this.pageW - this.margin * 2;
    const w = (usable - gap * (n - 1)) / n;
    const h = 52;
    this.need(h + 8);
    const top = this.y;
    items.forEach((it, i) => {
      const x = this.margin + i * (w + gap);
      const y = top - h;
      this.fill(x, y, w, h, TILE);
      this.stroke(x, y, w, h, LINE, 0.5);
      this.fill(x, y, 3, h, i % 2 === 0 ? PRIMARY : ACCENT);
      this.at(it.label.toUpperCase(), x + 10, y + h - 14, { size: 7, color: MUTED });
      this.at(it.value, x + 10, y + 16, { size: 14, bold: true, color: INK });
      if (it.sub) this.at(it.sub, x + 10, y + 6, { size: 7, color: SUCCESS });
    });
    this.y = top - h - 12;
  }

  barChart(
    items: Array<Record<string, unknown>>,
    valueKey: string,
    labelKey: string,
    title: string,
  ) {
    const rows = (items || []).slice(0, 24);
    if (!rows.length) {
      this.text(`${title} — no data`, { size: 9, color: MUTED });
      return;
    }
    let max = 1;
    for (const it of rows) {
      const v = Number(it[valueKey] || 0);
      if (v > max) max = v;
    }
    const chartH = 88;
    const chartW = this.pageW - this.margin * 2;
    this.need(chartH + 32);
    this.at(title, this.margin, this.y, { size: 10, bold: true, color: PRIMARY_DARK });
    this.y -= 14;
    const baseY = this.y - chartH;
    const bw = Math.max(4, (chartW / rows.length) * 0.62);
    this.buf.push(
      `q ${rgb(LINE)} RG 0.4 w ${this.margin} ${baseY} m ${this.margin + chartW} ${baseY} l S Q`,
    );
    for (let i = 0; i < rows.length; i++) {
      const v = Number(rows[i][valueKey] || 0);
      const bh = (v / max) * chartH;
      const x = this.margin + (i + 0.5) * (chartW / rows.length) - bw / 2;
      this.fill(x, baseY, bw, Math.max(1.2, bh), i % 3 === 1 ? ACCENT : PRIMARY);
      if (rows.length <= 14 || i % Math.ceil(rows.length / 10) === 0) {
        this.at(clip(String(rows[i][labelKey] ?? i), 6), x, baseY - 10, { size: 6.5, color: MUTED });
      }
    }
    this.y = baseY - 18;
  }

  table(headers: string[], rows: string[][], colWeights?: number[]) {
    const usable = this.pageW - this.margin * 2;
    const weights = colWeights || headers.map(() => 1);
    const sumW = weights.reduce((a, b) => a + b, 0);
    const widths = weights.map((w) => (w / sumW) * usable);
    const rowH = 13;
    const drawRow = (cells: string[], header: boolean, alt: boolean) => {
      this.need(rowH + 2);
      const y = this.y - 3;
      if (header) this.fill(this.margin, y - 2, usable, rowH, PRIMARY_DARK);
      else if (alt) this.fill(this.margin, y - 2, usable, rowH, TILE);
      let x = this.margin + 4;
      for (let i = 0; i < cells.length; i++) {
        const t = clip(String(cells[i] ?? ""), header ? 36 : 42);
        this.at(t, x, y + 2, {
          size: header ? 7.5 : 7.5,
          bold: header,
          color: header ? WHITE : INK,
        });
        x += widths[i] || 60;
      }
      this.y -= rowH;
    };
    drawRow(headers, true, false);
    rows.forEach((r, i) => drawRow(r, false, i % 2 === 1));
    this.y -= 8;
  }

  cover(input: PdfReportInput) {
    this.buf = [];
    this.fill(0, 0, this.pageW, this.pageH, PAPER);
    this.fill(0, this.pageH - 168, this.pageW, 168, PRIMARY_DARK);
    this.fill(0, this.pageH - 172, this.pageW, 4, ACCENT);
    this.at("JUICY LOUNGE", this.margin, this.pageH - 48, { size: 10, bold: true, color: ACCENT });
    this.at("Creator analytics report", this.margin, this.pageH - 82, {
      size: 22,
      bold: true,
      color: WHITE,
    });
    this.at(input.accountLabel || "Creator", this.margin, this.pageH - 108, {
      size: 12,
      color: WHITE,
    });
    const when = new Date().toLocaleString("en-GB", {
      timeZone: getDisplayTimezone(),
      dateStyle: "full",
      timeStyle: "short",
    });
    this.at(`Generated ${when}  ·  ${getDisplayTimezone()}`, this.margin, this.pageH - 128, {
      size: 9,
      color: [0.82, 0.8, 1],
    });
    this.at("Warehouse extract — no cookies, tokens, or login secrets.", this.margin, this.pageH - 146, {
      size: 8,
      color: [0.72, 0.7, 0.92],
    });
    this.y = this.pageH - 196;
  }

  build(): Uint8Array {
    this.flush();
    if (!this.pages.length) {
      this.paintChrome();
      this.at("Empty report", this.margin, 800, { size: 12, bold: true });
      this.flush();
    }
    const pageCount = this.pages.length;
    const catalogId = 1;
    const pagesId = 2;
    const fontId = 3;
    const fontBoldId = 4;
    const pageIds = Array.from({ length: pageCount }, (_, i) => 5 + i);
    const contentIds = Array.from({ length: pageCount }, (_, i) => 5 + pageCount + i);
    const kidsStr = pageIds.map((id) => `${id} 0 R`).join(" ");

    const chunks: string[] = ["%PDF-1.4\n"];
    const offsets: Record<number, number> = {};
    const sizeSoFar = () => chunks.join("").length;
    const writeObj = (id: number, body: string) => {
      offsets[id] = sizeSoFar();
      chunks.push(`${id} 0 obj\n${body}\nendobj\n`);
    };

    writeObj(catalogId, `<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
    writeObj(pagesId, `<< /Type /Pages /Kids [${kidsStr}] /Count ${pageCount} >>`);
    writeObj(fontId, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
    writeObj(fontBoldId, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");
    for (let p = 0; p < pageCount; p++) {
      writeObj(
        pageIds[p],
        `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] /Contents ${contentIds[p]} 0 R /Resources << /Font << /F1 ${fontId} 0 R /F2 ${fontBoldId} 0 R >> >> >>`,
      );
    }
    for (let p = 0; p < pageCount; p++) {
      const st = this.pages[p];
      writeObj(contentIds[p], `<< /Length ${st.length} >>\nstream\n${st}\nendstream`);
    }
    const xrefPos = sizeSoFar();
    const maxId = 4 + pageCount * 2;
    chunks.push(`xref\n0 ${maxId + 1}\n`);
    chunks.push("0000000000 65535 f \n");
    for (let i = 1; i <= maxId; i++) {
      const o = offsets[i] || 0;
      chunks.push(`${String(o).padStart(10, "0")} 00000 n \n`);
    }
    chunks.push(
      `trailer\n<< /Size ${maxId + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefPos}\n%%EOF`,
    );
    const pdfStr = chunks.join("");
    const bytes = new Uint8Array(pdfStr.length);
    for (let i = 0; i < pdfStr.length; i++) bytes[i] = pdfStr.charCodeAt(i) & 0xff;
    return bytes;
  }
}

export function buildAnalyticsPdf(input: PdfReportInput): Uint8Array {
  const pdf = new PdfBuilder();
  const { snapshot, growth, timing, insights, deep, publish, rivals, forensics, followers, economy } = input;
  const lookback = input.lookbackDays ?? timing?.lookbackDays ?? 30;
  const totals = snapshot?.totals;
  const dod = growth?.dayOverDay || growth?.sinceLastRefresh || growth?.last7Days;
  const trending = deep?.leaderboards?.find((b) => b.rankingType === 1);
  const allTime = deep?.leaderboards?.find((b) => b.rankingType === 3);

  pdf.cover(input);
  pdf.kpiRow([
    { label: "Chats", value: formatNum(totals?.chats), sub: dod ? formatDelta(dod.chats) : undefined },
    { label: "Likes", value: formatNum(totals?.likes), sub: dod ? formatDelta(dod.likes) : undefined },
    { label: "Favorites", value: formatNum(totals?.favorites), sub: dod ? formatDelta(dod.favorites) : undefined },
  ]);
  pdf.kpiRow([
    { label: "Followers", value: formatNum(totals?.followers ?? followers?.count), sub: followers?.dailyDelta != null ? formatDelta(followers.dailyDelta) : undefined },
    { label: "Bots", value: formatNum(totals?.bots ?? snapshot?.bots?.length) },
    { label: "Trending", value: trending?.yourRank != null ? `#${trending.yourRank}` : "—" },
  ]);

  pdf.heading("Contents");
  pdf.table(
    ["#", "Section", "What is in it"],
    [
      ["1", "Snapshot", "Totals, visibility mix, quality"],
      ["2", "Growth", "Day-over-day, 7d, daily chats, gainers"],
      ["3", "Creator ranking", "Trending / all-time boards around you"],
      ["4", "Portfolio", "Every bot: chats, likes, favs, score"],
      ["5", "Tags & topics", "Forensics lift vs the rest of the lounge"],
      ["6", "Why bots moved", "Top why-signal per bot"],
      ["7", "Tag competition", "Your bots vs feed ranks"],
      ["8", "Timing", "Weekday, hour, best slots, tag mix"],
      ["9", "Publish timing", "When live bots were published"],
      ["10", "Discovery", "Popular / recent / trending / immersive / new / editor"],
      ["11", "Bot depth", "Memory, gen pics, gallery"],
      ["12", "Audience", "Followers, wallet, comments, gifts"],
      ["13", "Rivals", "30d neighbours + pinned, launches, cadence, overlap, MRT archive"],
      ["14", "Comment pulse", "Named comments per bot, likes on samples"],
      ["15", "Economy & inventory", "VIP, gems, frozen, check-in, space, campaigns"],
      ["16", "Recurring audience", "Who liked / starred, crossover fans, patterns"],
      ["17", "Production yield", "3.5h cost, chats/h, accel, score, images, lifecycle"],
      ["18", "Exposure-adjusted", "Chat % vs discovery %, gems, overperformers, amplified"],
      ["19", "New-feed creation", "Homepage New: who posts, when, tags, dated snapshots"],
      ["20", "Dashboard signals", "Pond 72h, rival 48h velocity, own mix, leftover coins, variety, event watch"],
    ],
    [0.5, 2.2, 4.2],
  );

  pdf.heading("1  Snapshot");
  if (!snapshot) {
    pdf.para("No lounge snapshot in this warehouse. Refresh the lounge, then export again.");
  } else {
    pdf.kv("Account", input.accountLabel || snapshot.profile?.userName || snapshot.userId || "—");
    pdf.kv("Scraped", snapshot.scrapedAt || "—");
    pdf.kv("Interactions", formatFull(totals?.interactions));
    pdf.kv("Public / private / unlisted", `${totals?.publicBots ?? "—"} / ${totals?.privateBots ?? "—"} / ${totals?.unlistedBots ?? "—"}`);
    if (growth) {
      pdf.kv("Days tracked", String(growth.daysTracked ?? 0));
      pdf.kv("Latest / previous", `${growth.latestDate || "—"}  ->  ${growth.previousDate || "—"}`);
    }
    if (deep?.quality) {
      pdf.kv("Avg score10", fmtScore(deep.quality.avgScore10));
      pdf.kv("Median chats", formatFull(deep.quality.medianChats));
      pdf.kv(
        "Top-10 chat share",
        deep.quality.top10ChatShare != null ? `${(deep.quality.top10ChatShare * 100).toFixed(0)}%` : "—",
      );
      pdf.kv(
        "Engagement (likes+favs)/chats",
        deep.quality.engagementRate != null ? deep.quality.engagementRate.toFixed(3) : "—",
      );
    }
  }

  pdf.heading("2  Growth");
  if (!growth || (growth.daysTracked || 0) < 1) {
    pdf.para("Need two scrape days before day-over-day growth appears.");
  } else {
    const rows = [
      ["Day over day", growth.dayOverDay],
      ["Last 7 days", growth.last7Days],
      ["Since refresh", growth.sinceLastRefresh],
    ] as const;
    pdf.table(
      ["Window", "Chats", "Likes", "Favs", "Followers", "Bots"],
      rows.map(([label, d]) => [
        label,
        formatDelta(d?.chats),
        formatDelta(d?.likes),
        formatDelta(d?.favorites),
        formatDelta(d?.followers),
        formatDelta(d?.bots),
      ]),
      [2, 1.2, 1.2, 1.2, 1.4, 1],
    );
    if (growth.dailyGrowth?.length) {
      pdf.barChart(
        growth.dailyGrowth.slice(-21).map((d) => ({ label: d.date.slice(5), total: d.chats })),
        "total",
        "label",
        "Daily chat delta (last 21 days)",
      );
    }
    if (growth.topGainers?.chats?.length) {
      pdf.text("Top gainers (chats)", { size: 10, bold: true, color: PRIMARY_DARK, gap: 6 });
      pdf.table(
        ["Bot", "Δ chats", "Current"],
        growth.topGainers.chats.slice(0, 12).map((g) => [
          g.characterName,
          formatDelta(g.delta),
          formatFull(g.current),
        ]),
        [3.5, 1.4, 1.4],
      );
    }
  }

  pdf.heading("3  Creator ranking");
  if (!deep?.leaderboards?.length) {
    pdf.para("Ranklist boards appear after a rank refresh.");
  } else {
    pdf.table(
      ["Board", "Your rank", "Score", "Scanned"],
      deep.leaderboards.map((b) => [
        b.label,
        b.yourRank != null ? `#${b.yourRank}` : "—",
        formatFull(b.yourScore),
        String(b.scanned),
      ]),
      [2.4, 1.2, 1.4, 1],
    );
    const board = trending || allTime || deep.leaderboards[0];
    if (board?.listings?.length) {
      pdf.text(`${board.label} — around you`, { size: 10, bold: true, color: PRIMARY_DARK, gap: 6 });
      const you = board.yourRank ?? 0;
      const slice = board.listings.filter((r) => {
        if (r.isYou) return true;
        if (!you) return r.rank <= 12;
        return Math.abs(r.rank - you) <= 6;
      }).slice(0, 16);
      pdf.table(
        ["#", "Creator", "Chats", "You"],
        slice.map((r) => [
          String(r.rank),
          r.userName,
          formatFull(r.chatCount),
          r.isYou ? "* you" : "",
        ]),
        [0.6, 3, 1.4, 0.8],
      );
    }
  }

  pdf.heading("4  Portfolio");
  const bots = [...(snapshot?.bots || [])].sort((a, b) => (b.chatCount || 0) - (a.chatCount || 0));
  if (!bots.length) {
    pdf.para("No bots in the snapshot.");
  } else {
    pdf.table(
      ["Bot", "Chats", "Likes", "Favs", "Score", "Vis"],
      bots.slice(0, 45).map((b) => [
        b.characterName || b.characterId,
        formatFull(b.chatCount),
        formatFull(b.likeCount),
        formatFull(b.favoriteCount),
        fmtScore(b.score10),
        b._visibilityLabel || String(b.visibility ?? "—"),
      ]),
      [3.2, 1.2, 1, 1, 0.9, 0.8],
    );
  }

  pdf.heading("5  Tags & topics");
  if (!forensics?.tagBoard?.length) {
    pdf.para("Forensics archive is empty — open Forensics once after a scrape to backfill.");
  } else {
    pdf.kv("Archive bots", String(forensics.botCount));
    pdf.kv("Archive days", String(forensics.daysTracked));
    pdf.kv("Follow / creator days", `${forensics.followDays} / ${forensics.creatorDays}`);
    if (forensics.audience?.uniquePeople) {
      pdf.kv(
        "Known people (likes / stars)",
        `${formatFull(forensics.audience.uniquePeople)} people · ${formatFull(forensics.audience.uniqueLikers)} likers · ${formatFull(forensics.audience.uniqueStarrers)} starrers`,
      );
      pdf.kv(
        "Recurring audience",
        `${formatFull(forensics.audience.recurringPeople)} people on 2+ bots · ${formatFull(forensics.audience.likeThenStar)} liked then starred`,
      );
    }
    pdf.table(
      ["Tag", "Bots", "Chats", "Δ", "Lift"],
      forensics.tagBoard.slice(0, 22).map((t) => [
        t.tag,
        String(t.bots),
        formatFull(t.chats),
        formatDelta(t.dChats),
        `${t.lift.toFixed(2)}x`,
      ]),
      [2.4, 0.8, 1.3, 1, 0.8],
    );
    if (forensics.topicBoard?.length) {
      pdf.text("Topics", { size: 10, bold: true, color: PRIMARY_DARK, gap: 6 });
      pdf.table(
        ["Topic", "Bots", "Chats", "Lift"],
        forensics.topicBoard.slice(0, 16).map((t) => [
          t.topic,
          String(t.bots),
          formatFull(t.chats),
          `${t.lift.toFixed(2)}x`,
        ]),
        [3, 0.8, 1.4, 0.8],
      );
    }
  }

  pdf.heading("6  Why bots moved");
  if (!forensics?.bots?.length) {
    pdf.para("No forensic why-signals yet.");
  } else {
    pdf.table(
      ["Bot", "Chats", "Δ", "Chats/day", "Why"],
      forensics.bots.slice(0, 28).map((b) => [
        b.characterName,
        formatFull(b.chats),
        formatDelta(b.dChats),
        b.chatsPerDay.toFixed(1),
        b.topWhy || "—",
      ]),
      [2.6, 1.1, 1, 1, 2.2],
    );
  }

  const tagRows =
    deep?.tagCompetition?.length
      ? deep.tagCompetition
      : deriveTagCompetition({
          bots: snapshot?.bots,
          enrichment: deep?.botEnrichment,
          existing: deep?.tagCompetition,
          maxTags: 16,
        });
  if (tagRows.length) {
    pdf.heading("7  Tag competition");
    pdf.table(
      ["Tag", "Your bots", "Your chats", "Best #", "Sample"],
      tagRows.slice(0, 16).map((t) => [
        t.tag,
        String(t.yourBots),
        formatFull(t.yourChats),
        t.yourBestRank != null ? `#${t.yourBestRank}` : "—",
        t.sampleSize ? String(t.sampleSize) : t.rivalBots ? `${t.rivalBots} n` : "—",
      ]),
      [2.0, 1.1, 1.3, 0.9, 0.9],
    );
  }

  const tagFx = input.tagForensics;
  if (tagFx && (tagFx.traffic.length || tagFx.combos.length)) {
    pdf.heading("7b  Tag forensics");
    pdf.kv("Warehouse days", String(tagFx.daysTracked));
    pdf.kv("Timing events", formatFull(tagFx.timingEvents));
    if (tagFx.traffic.length) {
      pdf.table(
        ["Tag", "7d chats", "30d", "Lift", "When"],
        tagFx.traffic.slice(0, 16).map((t) => {
          const w = tagFx.when.find((x) => x.tag === t.tag);
          return [
            t.tag,
            formatDelta(t.gain7),
            formatDelta(t.gain30),
            `${t.lift.toFixed(2)}x`,
            w?.successWhen || t.peakWeekday || "—",
          ];
        }),
        [2.0, 1.1, 1.1, 0.8, 2.2],
      );
    }
    if (tagFx.combos.length) {
      pdf.text("Successful combinations", { size: 10, bold: true, color: PRIMARY_DARK, gap: 6 });
      pdf.table(
        ["Pair", "Bots", "Chats", "Lift"],
        tagFx.combos.slice(0, 12).map((c) => [
          `${c.a} + ${c.b}`,
          String(c.bots),
          formatFull(c.chats),
          `${c.lift.toFixed(2)}x`,
        ]),
        [3.4, 0.8, 1.2, 0.8],
      );
    }
    if (tagFx.underserved?.length || tagFx.overserved?.length) {
      pdf.text("Coverage gaps", { size: 10, bold: true, color: PRIMARY_DARK, gap: 6 });
      const gapRows = [
        ...(tagFx.underserved || []).slice(0, 8).map((g) => ["Under", g.tag, g.why]),
        ...(tagFx.overserved || []).slice(0, 6).map((g) => ["Over", g.tag, g.why]),
      ];
      pdf.table(["Kind", "Tag / pair", "Why"], gapRows, [0.9, 2.2, 3.1]);
    }
    if (tagFx.popularity?.length) {
      pdf.text("Tag popularity vs warehouse creators", { size: 10, bold: true, color: PRIMARY_DARK, gap: 6 });
      pdf.table(
        ["Tag", "7d New", "Tracked %", "Creators"],
        tagFx.popularity.slice(0, 12).map((p) => [
          p.tag,
          String(p.cards7),
          `${Math.round(p.knownShare * 100)}%`,
          p.creators
            .slice(0, 3)
            .map((c) => c.userName)
            .join(", ") || "—",
        ]),
        [2.0, 1.0, 1.1, 3.1],
      );
    }
  }

  pdf.heading("8  Timing");
  if (!timing || !timing.eventCount) {
    pdf.para("No timing events. Pull notifications on the Timing tab.");
  } else {
    pdf.kv("Events", formatFull(timing.eventCount));
    pdf.kv("Lookback", `${lookback} days`);
    pdf.kv(
      "Mix",
      `likes ${formatNum(timing.likeCount)} · favs ${formatNum(timing.favoriteCount)} · comments ${formatNum(timing.commentCount)} · follows ${formatNum(timing.followCount)} · gifts ${formatNum(timing.giftCount)}`,
    );
    pdf.barChart(
      (timing.byDayOfWeek || []).map((d) => ({ label: d.dayLabel, total: d.total })),
      "total",
      "label",
      "Activity by weekday",
    );
    pdf.barChart(
      (timing.byHour || []).map((h) => ({ label: String(h.hour).padStart(2, "0"), total: h.total })),
      "total",
      "label",
      `Activity by hour (${timezoneCity(getDisplayTimezone())})`,
    );
    if (timing.overallBestSlots?.length) {
      pdf.table(
        ["#", "Slot", "Total", "Likes", "Favs"],
        timing.overallBestSlots.slice(0, 12).map((s, i) => [
          String(i + 1),
          s.label,
          String(s.total),
          String(s.likes),
          String(s.favorites),
        ]),
        [0.5, 2.6, 1, 1, 1],
      );
    }
    if (timing.tags?.length) {
      pdf.table(
        ["Tag", "Events", "Best slots"],
        timing.tags.slice(0, 16).map((tg) => [
          tg.tag,
          String(tg.total),
          (tg.bestSlots || []).slice(0, 2).map((s) => s.label).join(", "),
        ]),
        [2, 1, 3],
      );
    }
    if (timing.bots?.length) {
      pdf.text("Bots by engagement events", { size: 10, bold: true, color: PRIMARY_DARK, gap: 6 });
      pdf.table(
        ["Bot", "Likes", "Favs", "Total"],
        [...timing.bots]
          .sort((a, b) => b.total - a.total)
          .slice(0, 18)
          .map((b) => [b.characterName, String(b.likes), String(b.favorites), String(b.total)]),
        [3.2, 1, 1, 1],
      );
    }
  }

  pdf.heading("9  Publish timing");
  if (!publish || !publish.botCount) {
    pdf.para("Publish-slot analysis appears after a lounge scrape with gmtFirstPublish.");
  } else {
    pdf.kv("Bots dated", `${publish.withPublish} publish · ${publish.withCreateOnly} create-only · ${publish.missing} missing`);
    pdf.kv("Average age", `${publish.avgAgeDays.toFixed(0)} days`);
    if (publish.insight) pdf.para(publish.insight);
    if (publish.bestSlots?.length) {
      pdf.table(
        ["Best slot", "n", "Avg chats/day", "Median"],
        publish.bestSlots.slice(0, 8).map((s) => [
          s.label,
          String(s.n),
          s.avgChatsPerDay.toFixed(1),
          s.medianChatsPerDay.toFixed(1),
        ]),
        [2.4, 0.7, 1.5, 1.2],
      );
    }
    if (publish.byDayOfWeek?.length) {
      pdf.barChart(
        publish.byDayOfWeek.map((d) => ({ label: d.label, total: d.avgChatsPerDay })),
        "total",
        "label",
        "Avg chats/day by publish weekday",
      );
    }
    if (publish.topByChatsPerDay?.length) {
      pdf.table(
        ["Bot", "Published", "Chats/day", "Age"],
        publish.topByChatsPerDay.slice(0, 12).map((b) => [
          b.characterName,
          b.publishedLocal,
          b.chatsPerDay.toFixed(1),
          `${b.ageDays.toFixed(0)}d`,
        ]),
        [2.6, 2.2, 1.1, 0.8],
      );
    }
  }

  pdf.heading("10  Discovery");
  const matrix = insights?.discovery?.matrix || [];
  if (!matrix.length) {
    pdf.para("No discovery placements cached. Refresh insights while logged in.");
  } else {
    const summary = insights?.discovery?.summary;
    if (summary) {
      pdf.kv(
        "Feeds hit",
        Object.entries(summary)
          .map(([k, v]) => `${k} ${v}`)
          .join(" · "),
      );
    }
    pdf.table(
      ["Bot", "Pop", "Rec", "Trend", "Imm", "New", "Ed"],
      matrix.slice(0, 36).map((row) => {
        const r = (feed: "popular" | "recent" | "trending" | "immersive" | "new" | "editor") => {
          const v = row.ranks?.[feed];
          return v != null ? `#${v}` : "—";
        };
        return [row.characterName || "—", r("popular"), r("recent"), r("trending"), r("immersive"), r("new"), r("editor")];
      }),
      [2.2, 0.8, 0.8, 0.8, 0.8, 0.8, 0.7],
    );
  }

  if (insights?.botDepth?.length) {
    pdf.heading("11  Bot depth");
    const depth = [...insights.botDepth].sort((a, b) => (b.chats || 0) - (a.chats || 0));
    pdf.table(
      ["Bot", "Chats", "Mem", "Gen", "Gal", "Score"],
      depth.slice(0, 36).map((b) => [
        b.characterName || "—",
        formatFull(b.chats),
        formatFull(b.memoryCount),
        formatFull(b.genPictureCount),
        formatFull(b.galleryCount),
        fmtScore(b.score10 ?? b.score20),
      ]),
      [2.6, 1.2, 0.8, 0.8, 0.8, 0.9],
    );
  }

  pdf.heading("12  Audience");
  if (followers) {
    pdf.kv("Followers", formatFull(followers.count));
    pdf.kv("Source", followers.source || "—");
    pdf.kv("Δ day / week / month", `${formatDelta(followers.dailyDelta)} / ${formatDelta(followers.weeklyDelta)} / ${formatDelta(followers.monthlyDelta)}`);
    pdf.kv("Follow events today / 7d", `${followers.follows1d} / ${followers.follows7d}`);
    if (followers.pendingFollows) {
      pdf.kv(
        "Pending follows",
        `${followers.pendingFollows} named follow events since JuicyChat total last moved (total may lag)`,
      );
    }
    if (followers.series?.length) {
      pdf.barChart(
        followers.series.slice(-21).map((p) => ({ label: p.date.slice(5), total: p.count })),
        "total",
        "label",
        "Follower level (last 21 days)",
      );
    }
  } else {
    pdf.para("No follower series cached.");
  }
  if (insights) {
    pdf.kv("Insight followers listed", String(insights.followers?.length ?? 0));
    pdf.kv("Comments sampled", String(insights.comments?.length ?? 0));
    pdf.kv("Gifts / rewards", String(insights.giftsRewards?.length ?? 0));
    pdf.kv("Follow notifs", String(insights.follows?.length ?? 0));
    pdf.kv("Audits", String(insights.audits?.length ?? 0));
    if (insights.benefit) {
      const b = insights.benefit;
      pdf.kv(
        "Image / video remain",
        `${b.imageRemain ?? "—"} / ${b.videoRemain ?? "—"}  (used ${b.imageUsed ?? "—"} / ${b.videoUsed ?? "—"})`,
      );
    }
    if (insights.wallet?.length) {
      pdf.text("Wallet (latest)", { size: 10, bold: true, color: PRIMARY_DARK, gap: 6 });
      pdf.table(
        ["When", "Type", "Amount", "Remark"],
        insights.wallet.slice(0, 12).map((w) => [
          w.ts ? new Date(w.ts).toISOString().slice(0, 16).replace("T", " ") : "—",
          String(w.type ?? "—"),
          formatFull(w.amount ?? w.gems),
          clip(String(w.remark || ""), 28),
        ]),
        [2, 1, 1, 2.4],
      );
    }
    if (insights.comments?.length) {
      pdf.text("Recent comments", { size: 10, bold: true, color: PRIMARY_DARK, gap: 6 });
      pdf.table(
        ["When", "Bot", "From"],
        insights.comments.slice(0, 14).map((c) => [
          new Date(c.ts).toISOString().slice(0, 16).replace("T", " "),
          c.characterName,
          c.senderName || "—",
        ]),
        [2, 2.4, 2],
      );
    }
  }

  if (rivals?.rows?.length) {
    pdf.heading("13  Rivals");
    pdf.para(
      "30-day ALL neighbours (3 above / 3 below) are auto-tracked and replaced when the window moves. Pinned creators stay. Dropped auto-neighbours keep their MRT in the warehouse (alumni). Each scrape appends a compact daily MRT (traffic, cadence, overlap, top bots) so later questions have history. Public profile, space bots, launch cadence, and tag overlap vs your portfolio. ~ auto neighbour, * you.",
    );
    pdf.table(
      ["Creator", "30d #", "Chats", "Δ day", "Launches", "Cadence", "Overlap"],
      rivals.rows.slice(0, 18).map((r) => [
        `${r.isYou ? "* " : r.source === "neighbor" ? "~ " : ""}${r.userName}`,
        r.rank30d != null ? String(r.rank30d) : "—",
        formatFull(r.totals.chats),
        formatDelta(r.dayOverDay?.chats),
        r.launches30 != null ? String(r.launches30) : "—",
        r.cadence && r.cadence !== "unknown" ? r.cadence : "—",
        r.overlapTags?.length ? r.overlapTags.slice(0, 3).join(", ") : r.overlapN != null ? String(r.overlapN) : "—",
      ]),
      [1.7, 0.6, 1.0, 0.8, 0.8, 0.8, 1.6],
    );
    const fights = rivals.rows.filter((r) => !r.isYou && (r.overlapTags?.length || 0) > 0).slice(0, 8);
    if (fights.length) {
      pdf.text("Topic fight", { size: 10, bold: true, color: PRIMARY_DARK, gap: 6 });
      pdf.para(
        fights
          .map(
            (r) =>
              `${r.userName}: ${(r.overlapTags || []).join(", ")}${r.bestSlot ? ` | slot ${r.bestSlot}` : ""}`,
          )
          .join("  /  "),
      );
    }
  }

  const commentPulse = deep?.commentPulse?.length
    ? deep.commentPulse
    : deriveCommentPulse({
        enrichment: deep?.botEnrichment,
        comments: insights?.comments,
        bots: snapshot?.bots,
        limit: 16,
      });
  pdf.heading("14  Comment pulse");
  if (!commentPulse.length) {
    pdf.para(
      "No comments in the notification archive yet. They fill on lounge refresh while JuicyChat is connected.",
    );
  } else {
    pdf.kv("Bots with comments", String(commentPulse.length));
    pdf.kv(
      "Named comments",
      formatFull(commentPulse.reduce((s, c) => s + (c.commentsFetched || 0), 0)),
    );
    pdf.kv(
      "Likes on comment samples",
      formatFull(commentPulse.reduce((s, c) => s + (c.likesOnComments || 0), 0)),
    );
    pdf.table(
      ["Bot", "Named", "≈ total", "Likes", "People"],
      commentPulse.slice(0, 16).map((c) => [
        c.characterName,
        String(c.commentsFetched),
        c.approxTotal != null ? String(c.approxTotal) : "—",
        String(c.likesOnComments),
        c.uniqueSenders != null ? String(c.uniqueSenders) : "—",
      ]),
      [2.4, 0.9, 0.9, 0.8, 0.8],
    );
  }

  pdf.heading("15  Economy & inventory");
  if (!economy) {
    pdf.para("No economy snapshot yet. Refresh the lounge while logged in to pull VIP, gems, inventory, and campaign KPIs.");
  } else {
    pdf.kv("Pulled", economy.scrapedAt);
    pdf.kv("VIP", `${economy.vip.userVipId || "—"}  ·  coins ${formatFull(economy.vip.coin)} / ${formatFull(economy.vip.vipMaxCoin)}`);
    pdf.kv(
      "Daily coins",
      `${formatFull(economy.vip.dailyCoin)} / ${formatFull(economy.vip.dailyMaxCoin)}`,
    );
    const leftover = economy.vip.leftover
      ? Object.entries(economy.vip.leftover)
          .filter(([, v]) => v != null && v !== "")
          .slice(0, 16)
      : [];
    if (leftover.length) {
      pdf.kv(
        "Leftover coin fields",
        leftover.map(([k, v]) => `${k} ${v}`).join("  ·  "),
      );
    }
    pdf.kv(
      "Gems",
      `wallet ${formatFull(economy.vip.gems)}  ·  lifetime ${formatFull(economy.vip.gemsTotal)}  ·  income ${formatFull(economy.vip.incomeGems)}  ·  frozen ${formatFull(economy.vip.frozenGems)}`,
    );
    pdf.kv("Check-in streak", economy.checkInStreak != null ? String(economy.checkInStreak) : "—");
    pdf.kv(
      "Free quota",
      `figures ${formatFull(economy.quota.freeFigure)}  ·  pics ${formatFull(economy.quota.freePicture)}  ·  video ${formatFull(economy.quota.freeVideo)}`,
    );
    const inv = economy.inventory;
    pdf.kv(
      "Public space",
      `chars ${formatFull(inv.spacePublicChars)}  ·  figures ${formatFull(inv.spaceFigures)}  ·  galleries ${formatFull(inv.spaceGalleries)}  ·  images ${formatFull(inv.spacePublicImages)}  ·  videos ${formatFull(inv.spaceVideos)}`,
    );
    pdf.kv(
      "Owned inventory",
      `plaza pics ${formatFull(inv.plazaUserPics)}  ·  figures ${formatFull(inv.figuresOwned)}  ·  videos ${formatFull(inv.videosOwned)}  ·  gen pics ${formatFull(inv.genPicsOwned)}  ·  backpack ${formatFull(inv.backpackItems)}  ·  coupons ${formatFull(inv.coupons)}`,
    );
    pdf.kv(
      "Memories / personas",
      `public ${formatFull(inv.memoriesPublic)}  ·  private ${formatFull(inv.memoriesPrivate)}  ·  all ${formatFull(inv.memoriesAll)}  ·  personas ${formatFull(inv.personas)}`,
    );
    pdf.kv("Unread", `comments ${economy.unread.commentsNew ?? 0}  ·  follows ${economy.unread.followerNew ?? 0}  ·  interactions ${economy.unread.interactionNew ?? 0}`);
    pdf.kv("Revenue campaigns", String(economy.campaignCount ?? economy.campaigns.length));
    if (economy.campaigns.length) {
      pdf.table(
        ["Campaign", "Status", "Gems now", "Lifetime", "Entries"],
        economy.campaigns.slice(0, 16).map((c) => [
          c.name,
          c.status != null ? String(c.status) : "—",
          formatFull(c.revenueGems),
          formatFull(c.totalRevenueGems),
          formatFull(c.entityCount),
        ]),
        [2.6, 0.9, 1.2, 1.2, 1],
      );
    }
    if (economy.botSignals.length) {
      pdf.text("Per-bot leftover KPIs (top by chats)", { size: 10, bold: true, color: PRIMARY_DARK, gap: 6 });
      pdf.table(
        ["Bot", "Share", "Text", "Gallery views", "Rev gems"],
        economy.botSignals.slice(0, 12).map((b) => [
          b.characterName,
          formatFull(b.shareCount),
          formatFull(b.textLength),
          formatFull(b.galleryPageView),
          formatFull(b.revenueGems),
        ]),
        [2.6, 1, 1.1, 1.4, 1.1],
      );
    }
  }

  pdf.heading("16  Recurring audience");
  const aud = forensics?.audience;
  if (!aud || !aud.uniquePeople) {
    pdf.para("No named likers or starrers archived yet. Pull notifications, then rebuild forensics — people persist after the 30-day live feed expires.");
  } else {
    pdf.kv("Known people", formatFull(aud.uniquePeople));
    pdf.kv("Likers / starrers", `${formatFull(aud.uniqueLikers)} / ${formatFull(aud.uniqueStarrers)}`);
    pdf.kv("Recurring (2+ bots)", formatFull(aud.recurringPeople));
    pdf.kv("Liked then starred", formatFull(aud.likeThenStar));
    pdf.kv("Events attributed", formatFull(aud.events));
    if (aud.patterns?.length) {
      for (const p of aud.patterns.slice(0, 6)) {
        pdf.kv(p.label, p.detail);
      }
    }
    if (aud.crossovers?.length) {
      pdf.table(
        ["Bot A", "Bot B", "Shared people", "Likes", "Stars"],
        aud.crossovers.slice(0, 14).map((c) => [
          c.aName,
          c.bName,
          String(c.shared),
          formatFull(c.likes),
          formatFull(c.stars),
        ]),
        [2.2, 2.2, 1.2, 0.9, 0.9],
      );
    }
    if (aud.topFans?.length) {
      pdf.text("Top returning people", { size: 10, bold: true, color: PRIMARY_DARK, gap: 6 });
      pdf.table(
        ["Person", "Likes", "Stars", "Bots"],
        aud.topFans.slice(0, 18).map((p) => [
          p.senderName || p.senderId,
          formatFull(p.likes),
          formatFull(p.favorites),
          String(p.bots),
        ]),
        [3.2, 1.1, 1.1, 0.8],
      );
    }
  }

  pdf.heading("17  Production yield");
  if (!snapshot?.bots?.length) {
    pdf.para("No bots in this warehouse, so no production yield.");
  } else {
    const prod = analyzeProduction({
      bots: snapshot.bots,
      growth,
      enrichment: deep?.botEnrichment,
      hours: DEFAULT_HOURS,
    });
    pdf.kv("Assumption", `${DEFAULT_HOURS} hours per bot (toggle 3 / 3.5 / 4 in the lounge)`);
    pdf.kv("Hours invested", `${prod.hoursInvested.toFixed(0)}h across ${prod.botCount} bots`);
    pdf.kv("Chats / hour", prod.chatsPerHour.toFixed(1));
    pdf.kv("Favorites / hour", prod.favoritesPerHour.toFixed(1));
    pdf.kv("Likes / hour", prod.likesPerHour.toFixed(1));
    pdf.kv("Median chats / hour", prod.medianChatsPerHour.toFixed(1));
    const mix = (Object.entries(prod.lifecycle) as Array<[keyof typeof LIFECYCLE_LABEL, number]>)
      .filter(([, n]) => n > 0)
      .map(([k, n]) => `${LIFECYCLE_LABEL[k]} ${n}`)
      .join(" · ");
    if (mix) pdf.kv("Lifecycle mix", mix);
    pdf.table(
      ["Bot", "Chats/h", "Favs/h", "Chats/d", "Accel", "Score", "Images", "Life"],
      prod.rows.slice(0, 24).map((r) => [
        r.characterName,
        r.chatsPerHour.toFixed(1),
        r.favoritesPerHour.toFixed(1),
        r.recentChatsPerDay != null ? r.recentChatsPerDay.toFixed(1) : "—",
        r.acceleration == null ? "—" : `${r.acceleration >= 0 ? "+" : ""}${(r.acceleration * 100).toFixed(0)}%`,
        r.scoreLabel,
        r.images.label,
        LIFECYCLE_LABEL[r.lifecycle],
      ]),
      [2.0, 0.8, 0.8, 0.8, 0.7, 0.7, 1.2, 0.9],
    );
  }

  pdf.heading("18  Exposure-adjusted performance");
  if (!snapshot?.bots?.length) {
    pdf.para("No bots in this warehouse, so chat vs discovery percentiles cannot be computed.");
  } else {
    const commentCounts: Record<string, number> = {};
    for (const c of insights?.comments || []) {
      if (!c.characterId) continue;
      commentCounts[c.characterId] = (commentCounts[c.characterId] || 0) + 1;
    }
    const exp = analyzeExposure({
      bots: snapshot.bots,
      discovery: insights?.discovery,
      botDepth: insights?.botDepth,
      commentCounts,
    });
    pdf.para(
      "Relative only: a bot's chat percentile versus its discovery percentile on editor / trending / immersive / popular / recent / new. Expected chats are the roster quantile at the same discovery rank (unlisted bots: median chats of other unlisted bots). Ratio = observed / expected. Lift = chat% minus discovery%.",
    );
    pdf.kv("Public pool", String(exp.pool));
    pdf.kv("On a scanned feed", `${exp.listed} of ${exp.pool}`);
    pdf.kv("Underexposed gems", String(exp.counts.gem));
    pdf.kv("Overperformers", String(exp.counts.over));
    pdf.kv("Platform-amplified", String(exp.counts.amplified));
    pdf.kv("Feed-heavy (high discovery, lagging chats)", String(exp.counts["feed-heavy"]));
    pdf.kv("Median chats among unlisted", formatFull(exp.medianUnexposedChats));

    pdf.text("Underexposed gems (highest-value: quality/attachment, almost no feed)", {
      size: 10,
      bold: true,
      color: PRIMARY_DARK,
      gap: 6,
    });
    if (!exp.gems.length) {
      pdf.para("None this scrape — either everything listed is converting, or quality scores are thin.");
    } else {
      pdf.table(
        ["Bot", "Chats", "Expected", "Ratio", "Chat%", "Disc%", "Lift", "Score"],
        exp.gems.slice(0, 16).map((r) => [
          r.characterName,
          formatFull(r.chats),
          formatFull(r.expectedChats),
          formatExposureRatio(r.ratio),
          `${Math.round(r.chatPct * 100)}%`,
          `${Math.round(r.exposurePct * 100)}%`,
          formatLiftPts(r.lift),
          formatScore10(r.score10),
        ]),
        [2.2, 0.8, 0.9, 0.7, 0.7, 0.7, 0.6, 0.6],
      );
    }

    pdf.text("Overperformers (chats well above expected from exposure)", {
      size: 10,
      bold: true,
      color: PRIMARY_DARK,
      gap: 6,
    });
    if (!exp.overperformers.length) {
      pdf.para("None this scrape.");
    } else {
      pdf.table(
        ["Bot", "Chats", "Expected", "Ratio", "Lift", "Feeds"],
        exp.overperformers.slice(0, 14).map((r) => [
          r.characterName,
          formatFull(r.chats),
          formatFull(r.expectedChats),
          formatExposureRatio(r.ratio),
          formatLiftPts(r.lift),
          r.feeds.length
            ? r.feeds.map((f) => (r.ranks[f] != null ? `${f}#${r.ranks[f]}` : f)).join(" ")
            : "—",
        ]),
        [2.4, 0.8, 0.9, 0.7, 0.6, 1.4],
      );
    }

    pdf.text("Platform-amplified (on a feed and converting with it)", {
      size: 10,
      bold: true,
      color: PRIMARY_DARK,
      gap: 6,
    });
    if (!exp.amplified.length) {
      pdf.para("No bots both high in discovery and high in chats this scrape.");
    } else {
      pdf.table(
        ["Bot", "Chats", "Expected", "Ratio", "Disc%", "Feeds"],
        exp.amplified.slice(0, 12).map((r) => [
          r.characterName,
          formatFull(r.chats),
          formatFull(r.expectedChats),
          formatExposureRatio(r.ratio),
          `${Math.round(r.exposurePct * 100)}%`,
          r.feeds.map((f) => (r.ranks[f] != null ? `${f}#${r.ranks[f]}` : f)).join(" "),
        ]),
        [2.4, 0.8, 0.9, 0.7, 0.7, 1.3],
      );
    }
  }

  pdf.heading("19  New-feed creation");
  const nf = input.newFeed;
  if (!nf?.lastScrapedAt) {
    pdf.para(
      "No New-feed snapshot in this warehouse. Open the New tab and refresh there — it is never part of Lounge Refresh all or scheduled jobs.",
    );
  } else {
    pdf.kv(`Snapshot date (${timezoneCity(getDisplayTimezone())})`, nf.lastDate || "—");
    pdf.kv("Scraped", nf.lastScrapedAt);
    pdf.kv(
      "Window",
      nf.firstDate && nf.lastDate && nf.firstDate !== nf.lastDate
        ? `${nf.firstDate} -> ${nf.lastDate} (${nf.dayCount} dated pulls)`
        : nf.lastDate || "—",
    );
    pdf.kv("This pull / first seen / accrued / creators", `${formatFull(nf.lastCount)} / ${formatFull(nf.lastNewCount)} / ${formatFull(nf.catalogSize)} / ${formatFull(nf.creatorCount)}`);
    if (nf.volume.length > 1) {
      pdf.table(
        ["Date", "In New", "First seen", "Returning"],
        nf.volume.slice(-16).map((d) => [
          d.date,
          formatFull(d.count),
          formatFull(d.newCount),
          formatFull(d.returningCount),
        ]),
        [2.0, 1.4, 1.5, 1.6],
      );
    }
    if (nf.topCreators.length) {
      pdf.text("Who posts (accrued)", { size: 10, bold: true, color: PRIMARY_DARK, gap: 6 });
      pdf.table(
        ["Creator", "Bots", "First", "Last"],
        nf.topCreators.slice(0, 16).map((c) => [
          `@${c.userName || c.userId}`,
          formatFull(c.bots),
          c.firstDate,
          c.lastDate,
        ]),
        [2.6, 1.0, 1.5, 1.5],
      );
    }
    if (nf.tagShift.length) {
      pdf.text("Topic shift (this pull vs previous)", { size: 10, bold: true, color: PRIMARY_DARK, gap: 6 });
      pdf.table(
        ["Tag", "Prev", "Now", "Delta"],
        nf.tagShift.slice(0, 14).map((t) => [
          t.tag,
          formatFull(t.prev),
          formatFull(t.now),
          t.delta > 0 ? `+${t.delta}` : String(t.delta),
        ]),
        [2.8, 1.2, 1.2, 1.2],
      );
    }
    if (nf.topTags.length) {
      pdf.kv("Accrued tags", nf.topTags.slice(0, 18).map((t) => `${t.tag} ${t.n}`).join(" · "));
    }
    if (nf.latest.length) {
      pdf.text(`Titles this snapshot (${nf.lastDate})`, { size: 10, bold: true, color: PRIMARY_DARK, gap: 6 });
      pdf.table(
        ["#", "Title", "Creator", "Published", "Tags"],
        nf.latest.slice(0, 24).map((r) => [
          String(r.rank),
          r.characterName,
          `@${r.userName || r.userId}`,
          r.gmtFirstPublish || r.gmtCreate
            ? new Date(r.gmtFirstPublish || r.gmtCreate || 0).toISOString().slice(0, 16).replace("T", " ")
            : "—",
          (r.tags || []).slice(0, 4).join(", ") || "—",
        ]),
        [0.5, 2.2, 1.4, 1.4, 1.4],
      );
    }
  }

  pdf.heading("20  Dashboard signals");
  const sig = input.signals;
  if (!sig) {
    pdf.para("No derived dashboard signals in this warehouse yet. Open the lounge to rebuild pond, 48h velocity, mix, leftover coins, variety, and event watch from existing files.");
  } else {
    pdf.kv("Pond window", `last ${sig.pond.windowHours}h first-publish · ${sig.pond.cards} cards`);
    if (sig.pond.hint) pdf.kv("Pond", sig.pond.hint);
    if (sig.pond.tagRows.length) {
      pdf.table(
        ["Tag", "n", "Median", "p90", "Chats"],
        sig.pond.tagRows.slice(0, 12).map((r) => [
          r.tag,
          String(r.n),
          formatFull(r.median),
          formatFull(r.p90),
          formatFull(r.chats),
        ]),
        [2.4, 0.8, 1.0, 1.0, 1.2],
      );
    }
    pdf.kv(
      "Clone tropes",
      sig.pond.clones.map((c) => `${c.label} ${c.n}`).join("  ·  ") || "—",
    );

    pdf.text("Rival 48h velocity (not lifetime)", { size: 10, bold: true, color: PRIMARY_DARK, gap: 6 });
    if (!sig.rivalVelocity.length) {
      pdf.para("No 48h rival rows. Track neighbours, then refresh so history can delta.");
    } else {
      pdf.table(
        ["Creator", "48h chats", "likes", "follows", "launches", "chats/h", "lifetime"],
        sig.rivalVelocity.slice(0, 12).map((r) => [
          r.isYou ? `You (${r.userName})` : r.userName,
          r.chats48h == null ? "—" : formatFull(r.chats48h),
          r.likes48h == null ? "—" : formatFull(r.likes48h),
          r.followers48h == null ? "—" : formatFull(r.followers48h),
          String(r.launches48h),
          r.chatsPerHour == null ? "—" : r.chatsPerHour.toFixed(1),
          formatFull(r.lifetimeChats),
        ]),
        [1.8, 1.0, 0.8, 0.8, 0.8, 0.8, 0.9],
      );
    }

    pdf.text("Own mix · last 14 ships", { size: 10, bold: true, color: PRIMARY_DARK, gap: 6 });
    if (!sig.ownMix.ships.length) {
      pdf.para("No dated publishes in the lounge snapshot.");
    } else {
      pdf.table(
        ["Bot", "Gender", "Rating", "Tags"],
        sig.ownMix.ships.map((s) => [
          s.characterName,
          s.gender,
          s.rating,
          s.tags.slice(0, 5).join(", ") || "—",
        ]),
        [2.4, 1.0, 0.9, 2.6],
      );
    }

    pdf.text("Coin field", { size: 10, bold: true, color: PRIMARY_DARK, gap: 6 });
    pdf.kv(
      "Mapped",
      `coin ${formatFull(sig.coin.coin)} / ${formatFull(sig.coin.vipMaxCoin)}  ·  total ${formatFull(sig.coin.coinTotal)}  ·  vip ${formatFull(sig.coin.vipCoin)}  ·  daily ${formatFull(sig.coin.dailyCoin)} / ${formatFull(sig.coin.dailyMaxCoin)}`,
    );
    if (sig.coin.leftover.length) {
      pdf.kv("Leftover", sig.coin.leftover.map((x) => `${x.key} ${x.value}`).join("  ·  "));
    } else {
      pdf.para("No unmapped VIP/coin keys in the last economy scrape.");
    }

    pdf.text("Variety-health (stars, 7d, 3+ lanes)", { size: 10, bold: true, color: PRIMARY_DARK, gap: 6 });
    pdf.kv("Week stars", String(sig.variety.weekStars));
    pdf.kv("Regulars", String(sig.variety.regulars));
    if (sig.variety.people.length) {
      pdf.table(
        ["Person", "Lanes", "Stars"],
        sig.variety.people.slice(0, 12).map((p) => [
          p.senderName,
          p.lanes.join(", "),
          String(p.stars),
        ]),
        [2.2, 3.4, 0.8],
      );
    }

    pdf.text("Event watch", { size: 10, bold: true, color: PRIMARY_DARK, gap: 6 });
    pdf.kv("Official tags", `${sig.eventWatch.officialCount}  ·  ${sig.eventWatch.officialAt || "no catalog yet"}`);
    if (!sig.eventWatch.tags.length) {
      pdf.para("No new official tags or uncatalogued tags on other people's New cards this snapshot.");
    } else {
      pdf.table(
        ["Kind", "Tag", "Cards", "Creators", "Sample"],
        sig.eventWatch.tags.slice(0, 16).map((t) => [
          t.kind === "new-official" ? "new official" : "not in catalog",
          t.tag,
          String(t.cards),
          String(t.creators),
          t.sample.slice(0, 2).join(" / ") || "—",
        ]),
        [1.4, 1.6, 0.7, 0.8, 2.4],
      );
    }
  }

  pdf.heading("Notes");
  pdf.para(
    "This PDF is a snapshot of the data warehouse: lounge scrape, growth history, ranklist, forensics (tags/topics/why/when/audience), timing, publish slots, discovery, insights, followers, rivals, economy/inventory (including leftover coin fields), production yield (3.5h per bot), exposure-adjusted performance (chat % vs discovery %), New-feed creation analytics (dated homepage New snapshots), and dashboard signals (72h pond, rival 48h velocity, own mix, leftover coins, variety-health, event watch). It never includes JuicyChat cookies or webhook secrets. Re-import the warehouse JSON to restore the same signals later.",
  );
  if (snapshot?.warnings?.length) {
    pdf.text(`Snapshot warnings: ${snapshot.warnings.slice(0, 4).join(" · ")}`, {
      size: 8,
      color: MUTED,
    });
  }

  return pdf.build();
}

export function stampFilename(prefix: string, ext: string) {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${prefix}-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.${ext}`;
}

export function downloadBytes(filename: string, bytes: Uint8Array, mime: string) {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const blob = new Blob([copy], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    try {
      document.body.removeChild(a);
    } catch {
      /* */
    }
    try {
      URL.revokeObjectURL(url);
    } catch {
      /* */
    }
  }, 1500);
}

export function downloadJson(filename: string, data: unknown) {
  const json = JSON.stringify(data, null, 2);
  const bytes = new TextEncoder().encode(json);
  downloadBytes(filename, bytes, "application/json");
}
