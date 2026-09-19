#!/usr/bin/env node
/**
 * URL parser for juicychat.ai/chat/{id}. Isolated Vite, no live JuicyChat.
 */
import { createServer } from "vite";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  const vite = await createServer({
    root,
    configFile: false,
    cacheDir: join(root, "node_modules/.vite-smoke-followed"),
    server: { middlewareMode: true },
    appType: "custom",
    logLevel: "error",
    resolve: { alias: { "@": join(root, "src") } },
  });
  try {
    const mod = await vite.ssrLoadModule("/src/lib/juicychat/followed-bots-view.ts");
    assert(
      mod.parseBotLink("https://www.juicychat.ai/chat/2093062532363874305") === "2093062532363874305",
      "www chat url",
    );
    assert(
      mod.parseBotLink("https://juicychat.ai/chat/2094851409873244161?utm=x") === "2094851409873244161",
      "bare host + query",
    );
    assert(mod.parseBotLink("2093062532363874305") === "2093062532363874305", "bare id");
    assert(mod.parseBotLink("not a link") === "", "junk");
    assert(mod.botChatUrl("2093") === "https://www.juicychat.ai/chat/2093", "url builder");
    const decorated = mod.decorateFollowed({
      characterId: "1",
      url: mod.botChatUrl("1"),
      pinned: true,
      addedAt: "2026-09-01T00:00:00.000Z",
      lastScrapedAt: "2026-09-19T00:00:00.000Z",
      identity: { characterId: "1", characterName: "A", tags: [] },
      latest: { date: "2026-09-19", scrapedAt: "2026-09-19T00:00:00.000Z", chats: 120, likes: 10, favorites: 2 },
      days: [
        { date: "2026-09-18", scrapedAt: "2026-09-18T00:00:00.000Z", chats: 100, likes: 8, favorites: 2 },
        { date: "2026-09-19", scrapedAt: "2026-09-19T00:00:00.000Z", chats: 120, likes: 10, favorites: 2 },
      ],
    });
    assert(decorated.dChats === 20, `dChats ${decorated.dChats}`);
    assert(decorated.dLikes === 2, "dLikes");
    assert(decorated.dayCount === 2, "dayCount");
    console.log("SMOKE FOLLOWED BOTS OK", { id: mod.parseBotLink("https://www.juicychat.ai/chat/2093062532363874305") });
    await vite.close().catch(() => {});
  } catch (e) {
    await vite.close().catch(() => {});
    throw e;
  }
}

main().catch((e) => {
  console.error("SMOKE FOLLOWED BOTS FAIL", e);
  process.exit(1);
});
