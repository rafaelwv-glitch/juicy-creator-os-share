#!/usr/bin/env node
/**
 * Pull every own JuicyChat bot as-is: list + detail + images.
 * Writes under OUT_DIR (default /workspace/juicychat-retrieved/)
 */
import { createCipheriv, createDecipheriv } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  createWriteStream,
  statSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

const KEY = Buffer.from("yume1aJ83ZbPpkwb", "utf8");
const IV = Buffer.from("yume2024cccydnzc", "utf8");
const BASE = "https://www.juicychat.ai";
const APP_VERSION = "0.1.67";
const OUT = process.env.OUT_DIR || "/workspace/juicychat-retrieved";
const SESSION_PATH = "/workspace/data/juicy-session.json";
const FORCE = process.argv.includes("--force");
const PROBE_ONLY = process.argv.includes("--probe");
const START_AT = Number(process.env.START_AT || 0);

function encryptRequestPayload(plain) {
  const b64 = Buffer.from(plain, "utf8").toString("base64");
  const cipher = createCipheriv("aes-128-cbc", KEY, IV);
  return Buffer.concat([cipher.update(b64, "utf8"), cipher.final()]).toString("base64");
}

function decryptResponsePayload(b64cipher) {
  const decipher = createDecipheriv("aes-128-cbc", KEY, IV);
  const dec = Buffer.concat([
    decipher.update(Buffer.from(b64cipher, "base64")),
    decipher.final(),
  ]).toString("utf8");
  return Buffer.from(dec, "base64").toString("utf8");
}

function loadSession() {
  const s = JSON.parse(readFileSync(SESSION_PATH, "utf8"));
  if (!s.cookie) throw new Error("No JuicyChat session cookie");
  return s;
}

function headers(session) {
  return {
    "content-type": "application/json",
    Accept: "application/json, text/plain, */*",
    SecretKey: session.secretKey,
    client: "pc",
    system: "windows64",
    platformType: "web",
    appVersion: APP_VERSION,
    language: "en",
    nsfw: "1",
    voucher: "null",
    utm_source: "null",
    offsetnumber: "0",
    navigatorlang: "en-US",
    distinctId: session.distinctId || "19fdump",
    Origin: BASE,
    Referer: `${BASE}/`,
    Cookie: session.cookie,
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  };
}

async function post(session, path, data = {}) {
  const body = JSON.stringify({
    requestData: encryptRequestPayload(JSON.stringify(data ?? {})),
  });
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: headers(session),
    body,
    redirect: "manual",
  });
  const text = await res.text();
  try {
    const json = JSON.parse(text);
    if (json.responseData) {
      return JSON.parse(decryptResponsePayload(json.responseData));
    }
    return json;
  } catch {
    return { success: false, code: "parse", msg: text.slice(0, 200) };
  }
}

function ok(res) {
  return (
    res &&
    (res.success === true ||
      res.code === "200" ||
      res.code === 200 ||
      res.code === "0" ||
      res.code === 0)
  );
}

function slugify(name, id) {
  const s = String(name || "untitled")
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 60)
    .replace(/-$/, "")
    .toLowerCase();
  return `${s || "bot"}-${id}`;
}

function visLabel(v) {
  if (v === 2) return "public";
  if (v === 1) return "unlisted";
  if (v === 0) return "private";
  return "unknown";
}

function auditLabel(v) {
  if (v === 15) return "pending_release";
  if (v === 10) return "under_review";
  if (v === 20) return "rejected";
  if (v === 0) return "live";
  return v == null ? "unknown" : `audit_${v}`;
}

function genderLabel(v) {
  return { 0: "Female", 1: "Male", 2: "Non-binary", 3: "Male (FTM)", 4: "Female (MTF)" }[v] || null;
}

function ratingLabel(v) {
  if (v === 0 || v === "0") return "SFW";
  if (v === 1 || v === "1") return "NSFW";
  if (v === 2 || v === "2") return "18+";
  return v == null ? null : String(v);
}

function extFromUrl(url, fallback = ".bin") {
  try {
    const u = new URL(url);
    const p = u.pathname.toLowerCase();
    const m = p.match(/\.(webp|jpg|jpeg|png|gif|avif)$/i);
    if (m) return `.${m[1].toLowerCase() === "jpeg" ? "jpg" : m[1].toLowerCase()}`;
  } catch {
    /* ignore */
  }
  return fallback;
}

async function download(url, dest) {
  if (!url || typeof url !== "string" || !url.startsWith("http")) return null;
  if (!FORCE && existsSync(dest) && statSync(dest).size > 32) {
    return { ok: true, dest, url, bytes: statSync(dest).size, skipped: true };
  }
  mkdirSync(dirname(dest), { recursive: true });
  const res = await fetch(url, {
    headers: {
      Referer: `${BASE}/`,
      Origin: BASE,
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    },
  });
  if (!res.ok || !res.body) {
    return { ok: false, status: res.status, url };
  }
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
  return { ok: true, dest, url, bytes: statSync(dest).size };
}

function mdFence(s) {
  if (s == null) return "";
  if (typeof s !== "string") return JSON.stringify(s, null, 2);
  return String(s).replace(/```/g, "``\u200b`");
}

function tagsOf(bot) {
  const t = bot.characterTags;
  if (!Array.isArray(t)) return [];
  return t.map((x) => (typeof x === "string" ? x : String(x)));
}

function toMarkdown(bot, images) {
  const tags = tagsOf(bot);
  const lines = [];
  lines.push(`# ${bot.characterName || "Untitled"}`);
  lines.push("");
  lines.push(`- **characterId:** \`${bot.characterId}\``);
  lines.push(`- **visibility:** ${visLabel(bot.visibility)} (${bot.visibility})`);
  lines.push(`- **auditType:** ${auditLabel(bot.auditType)} (${bot.auditType})`);
  lines.push(`- **rating:** ${ratingLabel(bot.rating)} (${bot.rating})`);
  lines.push(`- **gender:** ${genderLabel(bot.gender) || bot.gender}`);
  lines.push(`- **age:** ${bot.characterAge ?? ""}`);
  lines.push(`- **publicDefinition:** ${bot.publicDefinition}`);
  lines.push(
    `- **chats:** ${bot.chatCount ?? 0} · **likes:** ${bot.likeCount ?? 0} · **favorites:** ${bot.favoriteCount ?? 0} · **shares:** ${bot.shareCount ?? 0}`,
  );
  lines.push(`- **created:** ${bot.gmtCreate ?? ""}`);
  lines.push(`- **firstPublish:** ${bot.gmtFirstPublish ?? ""}`);
  lines.push(`- **modified:** ${bot.gmtModified ?? ""}`);
  lines.push(`- **figureId:** ${bot.figureId ?? ""}`);
  lines.push(`- **tags:** ${tags.length ? tags.map((t) => `\`${t}\``).join(", ") : "_(none)_"}`);
  lines.push(`- **url:** https://www.juicychat.ai/character/${bot.characterId}`);
  lines.push("");
  if (images.photo) lines.push(`![PFP](images/${images.photo})`);
  if (images.thumb && images.thumb !== images.photo) lines.push(`![thumb](images/${images.thumb})`);
  if (images.scenePc) lines.push(`![scene pc](images/${images.scenePc})`);
  if (images.sceneMobile) lines.push(`![scene mobile](images/${images.sceneMobile})`);
  for (const g of images.gallery || []) lines.push(`![gallery](images/${g})`);
  lines.push("");
  lines.push("## Title");
  lines.push("");
  lines.push(bot.characterName || "");
  lines.push("");
  lines.push("## Bio");
  lines.push("");
  lines.push(typeof bot.introduction === "string" ? bot.introduction : mdFence(bot.introduction));
  lines.push("");
  lines.push("## Situation");
  lines.push("");
  lines.push("```");
  lines.push(mdFence(bot.setting));
  lines.push("```");
  lines.push("");
  lines.push("## World / Scene");
  lines.push("");
  lines.push("```");
  lines.push(mdFence(bot.scenario));
  lines.push("```");
  lines.push("");
  lines.push("## Opening");
  lines.push("");
  lines.push("```");
  lines.push(mdFence(bot.greeting));
  lines.push("```");
  lines.push("");
  if (bot.personality && !(Array.isArray(bot.personality) && bot.personality.length === 0)) {
    lines.push("## Personality");
    lines.push("");
    lines.push("```");
    lines.push(mdFence(bot.personality));
    lines.push("```");
    lines.push("");
  }
  if (bot.sceneCard) {
    lines.push("## Scene card");
    lines.push("");
    lines.push("```json");
    lines.push(JSON.stringify(bot.sceneCard, null, 2));
    lines.push("```");
    lines.push("");
  }
  lines.push("## Raw metadata");
  lines.push("");
  lines.push("See `bot.json` for the complete live payload (every API field, as-is).");
  lines.push("");
  return lines.join("\n");
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function listOwn(session) {
  const bots = [];
  let pageNo = 1;
  const pageSize = 50;
  let total = Infinity;
  while (bots.length < total && pageNo <= 40) {
    const res = await post(session, "/yume/api/user/v1/character/getOwnUserCharacterList", {
      pageNo,
      pageSize,
      sortGmtCreate: 0,
      visibility: null,
      searchContent: "",
    });
    if (!ok(res)) throw new Error(`list failed: ${res.msg || res.code}`);
    const batch = Array.isArray(res.data) ? res.data : [];
    total = typeof res.total === "number" ? res.total : bots.length + batch.length;
    bots.push(...batch);
    console.log(`list page ${pageNo}: +${batch.length} (total ${bots.length}/${total})`);
    if (batch.length < pageSize) break;
    pageNo += 1;
    await sleep(80);
  }
  return bots;
}

async function detail(session, characterId) {
  const res = await post(session, "/yume/api/user/v1/character/getCharacterDetail", {
    characterId,
  });
  if (!ok(res)) return { _error: res.msg || String(res.code), _raw: res };
  return res.data ?? res;
}

async function fetchGallery(session, characterId) {
  const items = [];
  let pageNo = 1;
  const pageSize = 50;
  let total = Infinity;
  while (items.length < total && pageNo <= 20) {
    const res = await post(session, "/yume/api/user/v1/character/picture/getCharacterPictureList", {
      characterId,
      pageNo,
      pageSize,
    });
    if (!ok(res)) break;
    const batch = Array.isArray(res.data) ? res.data : [];
    total = typeof res.total === "number" ? res.total : items.length + batch.length;
    items.push(...batch);
    if (batch.length < pageSize) break;
    pageNo += 1;
  }
  return items;
}

async function tryFigure(session, figureId, characterId) {
  if (!figureId) return null;
  const attempts = [
    ["/yume/api/user/v1/character/figure/getFigureDetail", { figureId, characterId }],
    ["/yume/api/user/v1/figure/getFigureDetail", { figureId }],
    ["/yume/api/user/v1/character/getCharacterFigure", { characterId, figureId }],
  ];
  for (const [path, body] of attempts) {
    try {
      const res = await post(session, path, body);
      if (ok(res) && res.data) return { path, data: res.data };
    } catch {
      /* ignore */
    }
  }
  return null;
}

function collectImageJobs(bot, dir) {
  const jobs = [];
  const photoUrl = bot.characterPhoto;
  const thumbUrl = bot.characterThumb;
  if (photoUrl) {
    const name = `photo${extFromUrl(photoUrl, ".webp")}`;
    jobs.push({ key: "photo", name, url: photoUrl, dest: join(dir, "images", name) });
  }
  if (thumbUrl && thumbUrl !== photoUrl) {
    const name = `thumb${extFromUrl(thumbUrl, ".jpg")}`;
    jobs.push({ key: "thumb", name, url: thumbUrl, dest: join(dir, "images", name) });
  }
  const scene = bot.sceneCard && typeof bot.sceneCard === "object" ? bot.sceneCard : null;
  if (scene?.pcImage) {
    const name = `scene-pc${extFromUrl(scene.pcImage, ".jpg")}`;
    jobs.push({ key: "scenePc", name, url: scene.pcImage, dest: join(dir, "images", name) });
  }
  if (scene?.mobileImage && scene.mobileImage !== scene.pcImage) {
    const name = `scene-mobile${extFromUrl(scene.mobileImage, ".jpg")}`;
    jobs.push({ key: "sceneMobile", name, url: scene.mobileImage, dest: join(dir, "images", name) });
  }
  const gallery = Array.isArray(bot._gallery) ? bot._gallery : [];
  gallery.forEach((item, i) => {
    const url =
      item?.pictureUrl ||
      item?.imageUrl ||
      item?.url ||
      item?.characterPicture ||
      item?.picture ||
      item?.photo;
    if (!url) return;
    const name = `gallery-${String(i + 1).padStart(2, "0")}${extFromUrl(url, ".jpg")}`;
    jobs.push({ key: "gallery", name, url, dest: join(dir, "images", name) });
  });
  return jobs;
}

async function main() {
  const session = loadSession();
  mkdirSync(OUT, { recursive: true });
  mkdirSync(join(OUT, "bots"), { recursive: true });

  if (PROBE_ONLY) {
    const list = await listOwn(session);
    const sample = list[0];
    const d = await detail(session, sample.characterId);
    writeFileSync(join(OUT, "_probe-list.json"), JSON.stringify(sample, null, 2));
    writeFileSync(join(OUT, "_probe-detail.json"), JSON.stringify(d, null, 2));
    const gal = await fetchGallery(session, sample.characterId);
    writeFileSync(join(OUT, "_probe-gallery.json"), JSON.stringify(gal, null, 2));
    const fig = await tryFigure(session, d.figureId, sample.characterId);
    writeFileSync(join(OUT, "_probe-figure.json"), JSON.stringify(fig, null, 2));
    console.log("DETAIL KEYS", Object.keys(d));
    console.log("gallery", gal.length, "figure", fig && fig.path);
    return;
  }

  const listed = await listOwn(session);
  const index = [];
  const errors = [];
  let figureEndpointLogged = false;

  for (let i = START_AT; i < listed.length; i++) {
    const row = listed[i];
    const id = String(row.characterId);
    const slug = slugify(row.characterName, id);
    const dir = join(OUT, "bots", slug);
    mkdirSync(join(dir, "images"), { recursive: true });
    process.stdout.write(`[${i + 1}/${listed.length}] ${row.characterName} … `);

    if (!FORCE && existsSync(join(dir, "bot.json")) && existsSync(join(dir, "card.md"))) {
      try {
        const prev = JSON.parse(readFileSync(join(dir, "bot.json"), "utf8"));
        index.push({
          characterId: id,
          slug,
          characterName: prev.characterName || row.characterName,
          visibility: visLabel(prev.visibility ?? row.visibility),
          auditType: auditLabel(prev.auditType ?? row.auditType),
          rating: ratingLabel(prev.rating ?? row.rating),
          tags: tagsOf(prev.characterTags ? prev : row),
          chats: prev.chatCount ?? row.chatCount ?? 0,
          likes: prev.likeCount ?? row.likeCount ?? 0,
          favorites: prev.favoriteCount ?? row.favoriteCount ?? 0,
          created: prev.gmtCreate ?? row.gmtCreate ?? null,
          firstPublish: prev.gmtFirstPublish ?? row.gmtFirstPublish ?? null,
          path: `bots/${slug}/`,
          resumed: true,
        });
        console.log("skip");
        continue;
      } catch {
        /* fall through */
      }
    }

    let det = null;
    try {
      det = await detail(session, id);
    } catch (e) {
      errors.push({ id, name: row.characterName, stage: "detail", error: String(e) });
      console.log("DETAIL FAIL", e.message || e);
      await sleep(250);
      continue;
    }

    const bot = {
      ...row,
      ...(typeof det === "object" && det && !Array.isArray(det) ? det : {}),
      characterId: id,
      liveUrl: `https://www.juicychat.ai/character/${id}`,
      retrievedAt: new Date().toISOString(),
    };

    try {
      if ((row.galleryCount || bot.galleryCount || 0) > 0) {
        bot._gallery = await fetchGallery(session, id);
      }
    } catch (e) {
      errors.push({ id, name: row.characterName, stage: "gallery", error: String(e) });
    }

    if (bot.figureId && !figureEndpointLogged) {
      figureEndpointLogged = true;
      try {
        bot._figure = await tryFigure(session, bot.figureId, id);
        writeFileSync(join(OUT, "_probe-figure.json"), JSON.stringify(bot._figure, null, 2));
      } catch {
        /* ignore */
      }
    }

    const images = { photo: null, thumb: null, scenePc: null, sceneMobile: null, gallery: [] };
    const jobs = collectImageJobs(bot, dir);
    for (const job of jobs) {
      try {
        const r = await download(job.url, job.dest);
        if (r?.ok) {
          if (job.key === "gallery") images.gallery.push(job.name);
          else images[job.key] = job.name;
        } else {
          errors.push({
            id,
            name: row.characterName,
            stage: "image",
            url: job.url,
            error: r?.status,
          });
        }
      } catch (e) {
        errors.push({ id, name: row.characterName, stage: "image", url: job.url, error: String(e) });
      }
    }

    writeFileSync(join(dir, "bot.json"), JSON.stringify(bot, null, 2));
    writeFileSync(join(dir, "card.md"), toMarkdown(bot, images));
    writeFileSync(join(dir, "images.json"), JSON.stringify({ ...images, jobs }, null, 2));

    index.push({
      characterId: id,
      slug,
      characterName: bot.characterName,
      visibility: visLabel(bot.visibility),
      auditType: auditLabel(bot.auditType),
      rating: ratingLabel(bot.rating),
      tags: tagsOf(bot),
      chats: bot.chatCount ?? 0,
      likes: bot.likeCount ?? 0,
      favorites: bot.favoriteCount ?? 0,
      created: bot.gmtCreate ?? null,
      firstPublish: bot.gmtFirstPublish ?? null,
      photo: images.photo,
      thumb: images.thumb,
      path: `bots/${slug}/`,
    });
    console.log("ok");
    await sleep(40);
  }

  const summary = {
    retrievedAt: new Date().toISOString(),
    account: {
      userId: session.userId,
      userName: session.userName,
      userNo: session.userNo,
    },
    counts: {
      listed: listed.length,
      dumped: index.length,
      errors: errors.length,
      public: index.filter((b) => b.visibility === "public").length,
      unlisted: index.filter((b) => b.visibility === "unlisted").length,
      private: index.filter((b) => b.visibility === "private").length,
      pending_release: index.filter((b) => b.auditType === "pending_release").length,
      under_review: index.filter((b) => b.auditType === "under_review").length,
    },
    errors,
    bots: index,
  };
  writeFileSync(join(OUT, "index.json"), JSON.stringify(summary, null, 2));
  writeFileSync(
    join(OUT, "README.md"),
    [
      `# JuicyChat retrieved — ${session.userName || "SampleCreator"}`,
      "",
      `Live dump of **${index.length}** own bots as they exist on juicychat.ai.`,
      "",
      `- Retrieved: ${summary.retrievedAt}`,
      `- Public ${summary.counts.public} · Unlisted ${summary.counts.unlisted} · Private ${summary.counts.private}`,
      `- Pending release ${summary.counts.pending_release} · Under review ${summary.counts.under_review}`,
      "",
      "Each folder under `bots/` is one character, pulled as-is:",
      "",
      "- `bot.json` — complete live payload (setting, scenario, greeting, tags, stats, scene card, models…)",
      "- `card.md` — Title / Bio / Situation / World / Opening + tags + stats",
      "- `images/photo.*` — PFP (`characterPhoto`)",
      "- `images/thumb.*` — thumbnail (`characterThumb`)",
      "- `images/scene-pc.*` / `scene-mobile.*` — scene card",
      "- `images/gallery-*` — extra gallery stills when present",
      "",
      "This is a retrieval archive of the live JuicyChat objects. It is not a 5-box remaster pack.",
      "",
      "## Index",
      "",
      "| Name | vis | audit | chats | tags | folder |",
      "|---|---|---|---:|---|---|",
      ...index.map(
        (b) =>
          `| ${String(b.characterName).replace(/\|/g, "/")} | ${b.visibility} | ${b.auditType} | ${b.chats} | ${(b.tags || []).slice(0, 6).join(", ")} | [\`${b.slug}\`](bots/${b.slug}/) |`,
      ),
      "",
    ].join("\n"),
  );
  console.log("DONE", summary.counts);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
