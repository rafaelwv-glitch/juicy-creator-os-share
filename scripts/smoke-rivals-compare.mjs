#!/usr/bin/env node
/**
 * Any-vs-any MRT: overlap and ratios must follow the left creator,
 * not a hardcoded lounge-owner baseline.
 */
import { createServer } from "vite";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function snap(id, name, bots) {
  const chats = bots.reduce((s, b) => s + b.chatCount, 0);
  const likes = bots.reduce((s, b) => s + b.likeCount, 0);
  return {
    scrapedAt: "2026-09-18T12:00:00.000Z",
    authenticated: false,
    userId: id,
    profile: {
      userId: id,
      userName: name,
      chatCount: chats,
      likeCount: likes,
      favoriteCount: 0,
      followersCount: 10,
    },
    space: null,
    stats: null,
    benefit: null,
    ownCharacterData: null,
    bots: bots.map((b) => ({
      characterId: b.id,
      characterName: b.name,
      chatCount: b.chatCount,
      likeCount: b.likeCount,
      favoriteCount: 0,
      visibility: 2,
      characterTags: b.tags,
      gmtFirstPublish: "2026-08-01T12:00:00.000Z",
    })),
    totals: {
      bots: bots.length,
      publicBots: bots.length,
      unlistedBots: 0,
      privateBots: 0,
      chats,
      likes,
      favorites: 0,
      followers: 10,
      interactions: chats + likes,
    },
    warnings: [],
    source: "cache",
  };
}

async function main() {
  const vite = await createServer({
    root,
    configFile: false,
    server: { middlewareMode: true },
    appType: "custom",
    logLevel: "error",
    resolve: { alias: { "@": join(root, "src") } },
  });
  try {
    const mrt = await vite.ssrLoadModule("/src/lib/juicychat/rival-mrt.ts");

    const alice = snap("111", "Alice", [
      { id: "a1", name: "A1", chatCount: 100, likeCount: 10, tags: ["romance", "slice-of-life"] },
      { id: "a2", name: "A2", chatCount: 50, likeCount: 5, tags: ["romance"] },
    ]);
    const bob = snap("222", "Bob", [
      { id: "b1", name: "B1", chatCount: 300, likeCount: 30, tags: ["romance", "fantasy"] },
      { id: "b2", name: "B2", chatCount: 20, likeCount: 2, tags: ["fantasy"] },
    ]);
    const cara = snap("333", "Cara", [
      { id: "c1", name: "C1", chatCount: 80, likeCount: 8, tags: ["comedy"] },
    ]);

    const vsSelf = mrt.analyzeRivalMrt({ rival: bob, you: bob });
    const vsAlice = mrt.analyzeRivalMrt({ rival: bob, you: alice });
    const vsCara = mrt.analyzeRivalMrt({ rival: bob, you: cara });
    assert(vsAlice.topics.overlap.some((t) => t.tag === "romance"), "Bob vs Alice should overlap on romance");
    assert(!vsAlice.topics.overlap.some((t) => t.tag === "fantasy"), "fantasy is Bob-only vs Alice");
    assert(vsAlice.topics.rivalOnly.some((t) => t.tag === "fantasy"), "fantasy rivalOnly vs Alice");
    assert(vsCara.topics.overlap.length === 0, "Bob vs Cara share no tags");
    assert(vsAlice.vsYou.chatRatio !== vsSelf.vsYou.chatRatio, "ratio must change when baseline changes");
    assert(Math.abs((vsAlice.vsYou.chatRatio || 0) - 320 / 150) < 0.02, `Bob/Alice chat ratio ${vsAlice.vsYou.chatRatio}`);

    const pair = mrt.pairMrtFromSnapshots(alice, bob);
    assert(pair.leftMrt.userId === "111", "left is Alice");
    assert(pair.rightMrt.userId === "222", "right is Bob");
    assert(
      pair.rightMrt.topics.overlap.some((t) => t.tag === "romance"),
      "pair overlap uses left (Alice) as baseline",
    );
    const swapped = mrt.pairMrtFromSnapshots(bob, alice);
    assert(
      swapped.rightMrt.vsYou.chatRatio !== pair.rightMrt.vsYou.chatRatio,
      "swapping sides recomputes ratios",
    );

    const board = {
      id: "c_30d_all",
      yourRank: 10,
      aroundYou: [
        { userId: "111", userName: "Alice", rank: 10, isYou: true },
        { userId: "222", userName: "Bob", rank: 8, isYou: false },
        { userId: "333", userName: "Cara", rank: 12, isYou: false },
        { userId: "444", userName: "Dan", rank: 7, isYou: false },
        { userId: "555", userName: "Eve", rank: 13, isYou: false },
      ],
      listings: [],
      top: [],
    };
    const aroundYou = mrt.pickNeighbors(board, 1);
    assert(aroundYou.you?.userId === "111", "default neighborhood is isYou");
    assert(aroundYou.above[0]?.userId === "222", "above you is Bob");
    const aroundBob = mrt.pickNeighbors(board, 1, "222");
    assert(aroundBob.you?.userId === "222", "center can be any tracked creator");
    assert(aroundBob.above[0]?.userId === "444", "Bob's above is Dan");
    assert(aroundBob.below[0]?.userId === "111", "Bob's below is Alice");

    console.log("SMOKE RIVALS COMPARE OK", {
      overlapAlice: pair.rightMrt.topics.overlap.map((t) => t.tag),
      bobVsAliceRatio: vsAlice.vsYou.chatRatio,
      center: aroundBob.you?.userName,
    });
    await vite.close().catch(() => {});
    process.exit(0);
  } finally {
    await vite.close().catch(() => {});
  }
}

main().catch((err) => {
  console.error("SMOKE RIVALS COMPARE FAIL", err);
  process.exit(1);
});
