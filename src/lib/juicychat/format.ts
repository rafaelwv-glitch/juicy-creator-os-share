export function formatFull(n: number | null | undefined) {
  if (n == null || Number.isNaN(n)) return "—";
  return Math.round(Number(n)).toLocaleString("en-US");
}

export function formatDeltaFull(n: number | null | undefined) {
  if (n == null || Number.isNaN(n)) return "—";
  const v = Math.round(n);
  const body = Math.abs(v).toLocaleString("en-US");
  if (v > 0) return `+${body}`;
  if (v < 0) return `−${body}`;
  return "0";
}

export function formatNum(n: number | null | undefined) {
  if (n == null || Number.isNaN(n)) return "—";
  const v = Number(n);
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(Math.abs(v) >= 10_000_000 ? 0 : 1)}M`;
  if (Math.abs(v) >= 10_000) return `${(v / 1_000).toFixed(Math.abs(v) >= 100_000 ? 0 : 1)}k`;
  if (Math.abs(v) >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
  return String(Math.round(v));
}

export function formatDelta(n: number | null | undefined) {
  if (n == null || Number.isNaN(n)) return "—";
  if (n === 0) return "0";
  const sign = n > 0 ? "+" : "";
  return `${sign}${formatNum(n)}`;
}

export function formatRate(n: number | null | undefined, digits = 1) {
  if (n == null || Number.isNaN(n)) return "—";
  const v = Number(n);
  if (Math.abs(v) >= 10_000) return formatNum(v);
  if (Math.abs(v) >= 100) return Math.round(v).toLocaleString("en-US");
  return v.toFixed(digits);
}

export function formatPct(n: number | null | undefined, digits = 0) {
  if (n == null || Number.isNaN(n)) return "—";
  return `${(n * 100).toFixed(digits)}%`;
}

export function formatWhen(iso: string | number | null | undefined) {
  if (iso == null || iso === "") return "—";
  try {
    const d = typeof iso === "number" ? new Date(iso) : new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleString("en-GB", {
      timeZone: "Europe/Madrid",
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return String(iso);
  }
}

export function formatAgo(iso: string | number | null | undefined) {
  if (iso == null || iso === "") return "—";
  const t = typeof iso === "number" ? iso : Date.parse(String(iso));
  if (!Number.isFinite(t)) return "—";
  const sec = Math.round((Date.now() - t) / 1000);
  if (Math.abs(sec) < 45) return "just now";
  if (sec < 90) return "1 min ago";
  if (sec < 3600) return `${Math.round(sec / 60)} min ago`;
  if (sec < 5400) return "1h ago";
  if (sec < 86_400) return `${Math.round(sec / 3600)}h ago`;
  return formatWhen(iso);
}
