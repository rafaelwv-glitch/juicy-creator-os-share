#!/usr/bin/env node
/**
 * Repro the Timing crash: sample events have no characterId, and the
 * dashboard used to call `.slice` on undefined. Runs analyzeTiming against
 * that shape plus empty / garbage stores.
 */
import { createServer } from "vite";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const incomplete = {
  version: 1,
  timezone: "Europe/Madrid",
  events: [
    { messageId: "sample-event-1", ts: 1756724400000, kind: "like", characterName: "Sample Bot One" },
    { messageId: "no-ts", kind: "favorite" },
    null,
    "junk",
    { messageId: "ok", ts: Date.now(), kind: "like", characterId: 1001, characterName: "NumId" },
  ],
  lastScrapedAt: null,
  lastApiTotal: null,
  pagesFetched: 0,
  lookbackDays: 30,
};

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  const vite = await createServer({
    root,
    server: { middlewareMode: true },
    appType: "custom",
    logLevel: "error",
  });
  try {
    const mod = await vite.ssrLoadModule("/src/lib/juicychat/notifications.ts");
    const repair = await vite.ssrLoadModule("/src/lib/juicychat/repair.ts");

    const repaired = repair.repairNotifs(incomplete);
    assert(repaired.events.every((e) => typeof e.characterId === "string" && e.characterId), "repairNotifs must backfill characterId");

    for (const store of [incomplete, repaired, { ...incomplete, events: [] }, undefined]) {
      const analysis = mod.analyzeTiming(store);
      assert(Array.isArray(analysis.bots), "bots array");
      assert(Array.isArray(analysis.tags), "tags array");
      assert(Array.isArray(analysis.overallBestSlots), "slots array");
      for (const b of analysis.bots) {
        const id = String(b.characterId || "unknown");
        id.slice(0, 12);
        (Array.isArray(b.tags) && b.tags.length ? b.tags : ["—"]).slice(0, 4);
        (Array.isArray(b.bestSlots) ? b.bestSlots : []).slice(0, 3);
        Number(b.bestSlots?.[0]?.score || 0).toFixed(1);
      }
      for (const t of analysis.tags) {
        (Array.isArray(t.bestSlots) ? t.bestSlots : []).slice(0, 2);
      }
    }

    const fromIncomplete = mod.analyzeTiming(incomplete);
    assert(fromIncomplete.eventCount === 5, `eventCount ${fromIncomplete.eventCount}`);
    assert(fromIncomplete.uniqueBots >= 1, "at least one bot from name fallback");
    assert(
      fromIncomplete.bots.every((b) => typeof b.characterId === "string"),
      "every bot has string characterId",
    );
    console.log("SMOKE TIMING OK", {
      bots: fromIncomplete.bots.map((b) => b.characterId),
      likes: fromIncomplete.likeCount,
      slots: fromIncomplete.overallBestSlots.length,
    });
    await vite.close().catch(() => {});
    process.exit(0);
  } finally {
    await vite.close();
  }
}

main().catch((err) => {
  console.error("SMOKE TIMING FAIL", err);
  process.exit(1);
});
