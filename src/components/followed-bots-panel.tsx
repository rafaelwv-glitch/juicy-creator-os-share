import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Loader2, Pin, PinOff, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import {
  followBotByUrl,
  listFollowedBots,
  pinFollowedBot,
  refreshAllFollowedBots,
  refreshFollowedBot,
  unfollowBot,
} from "@/lib/juicychat/actions";
import { rememberBrowserCache } from "@/lib/juicychat/browser-sync";
import { formatDelta, formatNum, formatWhen } from "@/lib/juicychat/format";
import {
  botChatUrl,
  decorateFollowedList,
  parseBotLink,
  type FollowedBot,
  type FollowedBotView,
} from "@/lib/juicychat/followed-bots-view";

const tooltipStyle = {
  background: "var(--color-surface)",
  border: "1px solid var(--color-border)",
  borderRadius: 10,
  fontSize: 12,
  color: "var(--color-fg)",
};

type FileShape = { version: 1; timezone: string; bots: FollowedBot[] };

const GENDER: Record<number, string> = {
  0: "Female",
  1: "Male",
  2: "NB",
  3: "FTM",
  4: "MTF",
};
const RATING: Record<string, string> = { "0": "SFW", "1": "NSFW", "2": "18+" };

function genderLabel(g?: number) {
  if (g == null || !Number.isFinite(g)) return null;
  return GENDER[g] || `g${g}`;
}

function ratingLabel(r?: string | number | null) {
  if (r == null || r === "") return null;
  return RATING[String(r)] || String(r);
}

export function FollowedBotsPanel() {
  const [file, setFile] = useState<FileShape | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [ok, setOk] = useState<boolean | null>(null);
  const [q, setQ] = useState("");

  const apply = useCallback((next: FileShape, pick?: string) => {
    setFile(next);
    const ids = (next.bots || []).map((b) => b.characterId);
    setSelected((cur) => {
      const want = pick || cur;
      if (want && ids.includes(want)) return want;
      return ids[0] || null;
    });
  }, []);

  const reload = useCallback(async () => {
    const f = (await listFollowedBots()) as FileShape;
    apply(f);
    return f;
  }, [apply]);

  useEffect(() => {
    void reload().catch((e) => {
      setMsg(e instanceof Error ? e.message : String(e));
      setOk(false);
    });
  }, [reload]);

  const bots = useMemo(() => decorateFollowedList(file?.bots || []), [file]);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return bots;
    return bots.filter(
      (b) =>
        b.identity.characterName.toLowerCase().includes(s) ||
        b.characterId.includes(s) ||
        b.identity.userName?.toLowerCase().includes(s) ||
        b.identity.tags.some((t) => t.toLowerCase().includes(s)),
    );
  }, [bots, q]);
  const current = bots.find((b) => b.characterId === selected) || shown[0] || null;

  const onFollow = async () => {
    const id = parseBotLink(link);
    if (!id && !link.trim()) {
      setMsg("Paste a juicychat.ai/chat/… link or a numeric bot id");
      setOk(false);
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const res = (await followBotByUrl({ data: { url: link.trim() } })) as {
        file: FileShape;
        entry: FollowedBot;
      };
      apply(res.file, res.entry.characterId);
      setLink("");
      setMsg(`Following ${res.entry.identity.characterName}`);
      setOk(true);
      void rememberBrowserCache();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
      setOk(false);
    } finally {
      setBusy(false);
    }
  };

  const onRefreshAll = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const f = (await refreshAllFollowedBots()) as FileShape;
      apply(f);
      setMsg(`Pulled ${f.bots.length} followed bot${f.bots.length === 1 ? "" : "s"}`);
      setOk(true);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
      setOk(false);
    } finally {
      setBusy(false);
    }
  };

  const onRefreshOne = async (id: string) => {
    setBusy(true);
    try {
      const res = (await refreshFollowedBot({ data: { characterId: id } })) as {
        file: FileShape;
        entry: FollowedBot;
      };
      apply(res.file, id);
      setMsg(`Updated ${res.entry.identity.characterName}`);
      setOk(true);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
      setOk(false);
    } finally {
      setBusy(false);
    }
  };

  const onPin = async (id: string, pinned: boolean) => {
    const f = (await pinFollowedBot({ data: { characterId: id, pinned } })) as FileShape;
    apply(f, id);
    void rememberBrowserCache();
  };

  const onUnfollow = async (id: string) => {
    if (!confirm("Stop following this bot? Day history on disk is dropped.")) return;
    const f = (await unfollowBot({ data: { characterId: id } })) as FileShape;
    apply(f);
    void rememberBrowserCache();
  };

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-primary/30 bg-primary/5 p-4">
        <h2 className="text-sm font-semibold">Follow a public bot</h2>
        <p className="mt-1 text-[12px] text-muted">
          Paste a chat URL. We pull the public card (name, creator, tags, intro, chats / likes /
          favs) and keep one row per lounge day so you can watch the counts move.
        </p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input
            value={link}
            onChange={(e) => setLink(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void onFollow();
            }}
            placeholder="https://www.juicychat.ai/chat/2093062532363874305"
            className="h-11 min-w-0 flex-1 rounded-xl border border-border bg-bg px-3 text-sm"
          />
          <button
            type="button"
            onClick={() => void onFollow()}
            disabled={busy}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-fg disabled:opacity-60"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            Follow
          </button>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void onRefreshAll()}
            disabled={busy || !bots.length}
            className="inline-flex h-11 items-center gap-2 rounded-xl border border-border bg-bg px-3 text-xs font-semibold disabled:opacity-50"
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
            Refresh all
          </button>
          <span className="text-[11px] text-faint">
            {bots.length} followed · scheduled scrapes also refresh this list
          </span>
        </div>
        {msg ? (
          <p className={`mt-2 text-xs ${ok ? "text-success" : "text-danger"}`}>{msg}</p>
        ) : null}
      </section>

      {!bots.length ? (
        <p className="rounded-2xl border border-dashed border-border bg-surface/50 px-4 py-10 text-center text-sm text-muted">
          No followed bots yet. Public cards work with your JuicyChat session connected.
        </p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,280px)_1fr]">
          <aside className="rounded-2xl border border-border bg-surface/90 p-3">
            <label className="relative mb-2 block">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-faint" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Filter followed"
                className="h-10 w-full rounded-lg border border-border bg-bg pl-8 pr-3 text-sm"
              />
            </label>
            <ul className="max-h-[28rem] space-y-1 overflow-y-auto">
              {shown.map((b) => (
                <li key={b.characterId}>
                  <button
                    type="button"
                    onClick={() => setSelected(b.characterId)}
                    className={`w-full rounded-xl px-2.5 py-2 text-left ${
                      current?.characterId === b.characterId
                        ? "bg-primary/15 text-fg"
                        : "hover:bg-bg/60"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {b.identity.characterThumb ? (
                        <img
                          src={b.identity.characterThumb}
                          alt=""
                          className="size-8 rounded-lg object-cover"
                        />
                      ) : (
                        <span className="grid size-8 place-items-center rounded-lg bg-bg text-[10px] text-faint">
                          bot
                        </span>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold">
                          {b.pinned ? <Pin className="mr-1 inline size-3 text-primary" /> : null}
                          {b.identity.characterName}
                        </div>
                        <div className="truncate text-[11px] text-muted">
                          {formatNum(b.latest?.chats)} chats · {formatDelta(b.dChats)}
                        </div>
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </aside>

          {current ? <FollowedDetail bot={current} busy={busy} onRefresh={onRefreshOne} onPin={onPin} onUnfollow={onUnfollow} /> : null}
        </div>
      )}
    </div>
  );
}

function FollowedDetail({
  bot,
  busy,
  onRefresh,
  onPin,
  onUnfollow,
}: {
  bot: FollowedBotView;
  busy: boolean;
  onRefresh: (id: string) => void;
  onPin: (id: string, pinned: boolean) => void;
  onUnfollow: (id: string) => void;
}) {
  const chart = bot.days.map((d) => ({
    date: d.date.slice(5),
    chats: d.chats,
    likes: d.likes,
    favorites: d.favorites,
  }));

  return (
    <div className="min-w-0 space-y-4">
      <section className="rounded-2xl border border-border bg-surface/90 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            {bot.identity.characterThumb || bot.identity.characterPhoto ? (
              <img
                src={bot.identity.characterThumb || bot.identity.characterPhoto}
                alt=""
                className="size-16 rounded-xl object-cover"
              />
            ) : null}
            <div className="min-w-0">
              <h2 className="font-display text-xl font-bold">{bot.identity.characterName}</h2>
              <p className="mt-0.5 text-sm text-muted">
                {bot.identity.userName ? `@${bot.identity.userName}` : "Creator —"}
                {bot.identity.gmtFirstPublish
                  ? ` · published ${formatWhen(
                      typeof bot.identity.gmtFirstPublish === "number"
                        ? bot.identity.gmtFirstPublish < 1e12
                          ? bot.identity.gmtFirstPublish * 1000
                          : bot.identity.gmtFirstPublish
                        : bot.identity.gmtFirstPublish,
                    )}`
                  : ""}
              </p>
              <a
                href={botChatUrl(bot.characterId)}
                target="_blank"
                rel="noreferrer"
                className="mt-1 inline-block text-[12px] text-primary hover:underline"
              >
                {botChatUrl(bot.characterId)}
              </a>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {bot.identity.tags.slice(0, 10).map((t) => (
                  <span key={t} className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] text-primary">
                    {t}
                  </span>
                ))}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => void onRefresh(bot.characterId)}
              disabled={busy}
              className="inline-flex h-11 items-center gap-1.5 rounded-xl border border-border px-3 text-xs font-semibold"
            >
              <RefreshCw className="size-3.5" /> Pull
            </button>
            <button
              type="button"
              onClick={() => void onPin(bot.characterId, !bot.pinned)}
              className="inline-flex h-11 items-center gap-1.5 rounded-xl border border-border px-3 text-xs font-semibold"
            >
              {bot.pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
              {bot.pinned ? "Unpin" : "Pin"}
            </button>
            <button
              type="button"
              onClick={() => void onUnfollow(bot.characterId)}
              className="inline-flex h-11 items-center gap-1.5 rounded-xl border border-danger/30 px-3 text-xs font-semibold text-danger"
            >
              <Trash2 className="size-3.5" /> Unfollow
            </button>
          </div>
        </div>
        {bot.identity.introduction ? (
          <p className="mt-3 line-clamp-4 text-sm text-muted">{bot.identity.introduction}</p>
        ) : null}
        {bot.identity.personality ? (
          <p className="mt-2 text-[12px] text-faint">
            Personality · {bot.identity.personality}
          </p>
        ) : null}
        {bot.lastError ? <p className="mt-2 text-xs text-danger">{bot.lastError}</p> : null}
        <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(
            [
              ["Rating", ratingLabel(bot.identity.rating)],
              ["Gender", genderLabel(bot.identity.gender)],
              ["Comments", bot.identity.commentCount ?? bot.latest?.comments],
              ["Shares", bot.latest?.shares],
              ["Score", bot.latest?.score10],
              ["Gallery", bot.identity.galleryCount],
              ["Memory", bot.identity.memoryCount],
              ["Days tracked", bot.dayCount],
            ] as const
          )
            .filter(([, v]) => v != null && v !== "")
            .map(([l, v]) => (
              <div key={l} className="rounded-lg border border-border bg-bg/40 px-2.5 py-1.5">
                <dt className="text-[10px] uppercase tracking-wide text-faint">{l}</dt>
                <dd className="text-sm font-medium">{typeof v === "number" ? formatNum(v) : v}</dd>
              </div>
            ))}
        </dl>
      </section>

      <section className="grid grid-cols-3 gap-2">
        {(
          [
            ["Chats", bot.latest?.chats, bot.dChats],
            ["Likes", bot.latest?.likes, bot.dLikes],
            ["Favs", bot.latest?.favorites, bot.dFavorites],
          ] as const
        ).map(([l, v, d]) => (
          <div key={l} className="rounded-xl border border-border bg-bg/40 px-3 py-2">
            <div className="text-[10px] uppercase tracking-wide text-faint">{l}</div>
            <div className="text-lg font-semibold">{formatNum(v)}</div>
            <div className={`text-[11px] ${d == null ? "text-faint" : d > 0 ? "text-success" : d < 0 ? "text-danger" : "text-muted"}`}>
              {d == null ? `${bot.dayCount} day${bot.dayCount === 1 ? "" : "s"}` : formatDelta(d)}
            </div>
          </div>
        ))}
      </section>

      <section className="rounded-2xl border border-border bg-surface/90 p-4">
        <h3 className="mb-2 text-sm font-semibold">Evolution</h3>
        {chart.length < 2 ? (
          <p className="text-sm text-muted">
            Need a second scrape on another lounge day before the line moves. Last pull{" "}
            {formatWhen(bot.lastScrapedAt)}.
          </p>
        ) : (
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: "var(--color-muted)" }} />
                <YAxis tick={{ fontSize: 10, fill: "var(--color-muted)" }} width={40} />
                <Tooltip contentStyle={tooltipStyle} />
                <Line type="monotone" dataKey="chats" name="Chats" stroke="var(--color-primary)" dot={false} strokeWidth={2} />
                <Line type="monotone" dataKey="likes" name="Likes" stroke="var(--color-chart-2)" dot={false} strokeWidth={2} />
                <Line type="monotone" dataKey="favorites" name="Favs" stroke="var(--color-chart-4)" dot={false} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
        {bot.days.length ? (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[28rem] text-left text-[12px]">
              <thead className="text-[10px] uppercase tracking-wide text-faint">
                <tr>
                  <th className="py-1 pr-2 font-medium">Day</th>
                  <th className="py-1 pr-2 font-medium">Chats</th>
                  <th className="py-1 pr-2 font-medium">Likes</th>
                  <th className="py-1 pr-2 font-medium">Favs</th>
                  <th className="py-1 font-medium">Comments</th>
                </tr>
              </thead>
              <tbody>
                {[...bot.days].slice(-14).reverse().map((d) => (
                  <tr key={d.date} className="border-t border-border/70">
                    <td className="py-1 pr-2 font-mono">{d.date}</td>
                    <td className="py-1 pr-2">{formatNum(d.chats)}</td>
                    <td className="py-1 pr-2">{formatNum(d.likes)}</td>
                    <td className="py-1 pr-2">{formatNum(d.favorites)}</td>
                    <td className="py-1">{d.comments == null ? "—" : formatNum(d.comments)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </div>
  );
}
