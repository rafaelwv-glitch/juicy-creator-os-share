# JuicyChat Yume API

**Canonical API reference:** [`API.md`](API.md) (all endpoints, auth, email OTP / magic-link). **Transport spec:** [`juicychat-yume-api-spec.md`](juicychat-yume-api-spec.md). This file is the bot-post operational map.

**Locked:** 2026-08-29
**This shareable clone ships with anonymous sample data only.**
**Base:** `https://www.juicychat.ai`
**Sources:** lounge client (`src/lib/juicychat/*`).

This is the endpoint map for the private bot-dev repo. It is **not** a licence to publish.

Related: [`archive-endpoint-map.md`](archive-endpoint-map.md) · [`juicychat-figure-api.md`](juicychat-figure-api.md) · skill [`skills/bot-post/SKILL.md`](../skills/bot-post/SKILL.md)

---

## 1. Envelope

Almost every JSON call wraps the payload:

```
encrypt:  base64(utf8(plain JSON)) → AES-128-CBC-PKCS7 → base64
decrypt:  reverse
```

| | JuicyChat | CharacterWorld (images, out of bot-post scope) |
|---|---|---|
| key | `yume1aJ83ZbPpkwb` | `word7Kp2mQx9vRt4` |
| iv | `yume2024cccydnzc` | `word2026imgvimgc` |

These 16-byte strings are **public client obfuscation**. They are safe to document. The **session is not**.

Request body:

```json
{ "requestData": "<ciphertext>" }
```

Response body (typical):

```json
{ "responseData": "<ciphertext>" }
```

Decrypt to `{ code, msg, data, success, total?, pageNo? }`. Treat as OK when `code` is `0` / `"0"` / `200` / `"200"` or `success === true`.

GET endpoints (`getUserInfo`, `signOut`, magic-link redeem) usually return the same envelope without a request body.

---

## 2. Auth

| Mechanism | Where it lives |
|---|---|
| Session cookie | `yume_voucher=...` (also sent as header `voucher` by some clients) |
| `SecretKey` | Per-request header. UUID without dashes + 2 inserted chars (34 chars). Not the account password. |
| Distinct id | Analytics-ish `distinctId` header |

**Never commit** `yume_voucher`, JWTs, or `/workspace/data/juicy-session.json` to this repo.

Typical headers (PC web):

```
Content-Type: application/json
SecretKey: <34-char>
Cookie: yume_voucher=<secret>
client: pc
system: windows64
platformType: web
appVersion: 0.1.67 | 0.1.68
language: en
nsfw: 1
Origin: https://www.juicychat.ai
Referer: https://www.juicychat.ai/
```

---

## 3. Enums

### visibility

| value | label | notes |
|---:|---|---|
| 0 | private | **bot-post default.** Owner-only. |
| 1 | unlisted | Link-only. `package-poster` uses this as a fake "draft". |
| 2 | public | Feed-visible after publish. |

JuicyChat has **no draft enum**. A private create with `gmtFirstPublish == null` is the closest thing.

### publicDefinition

| value | meaning |
|---:|---|
| 0 | definition (setting/scenario/greeting) hidden on the public card |
| 1 | definition public |

### rating

| value | label |
|---:|---|
| 0 | SFW |
| 1 | NSFW |
| 2 | 18+ |

### gender

| value | label |
|---:|---|
| 0 | Female |
| 1 | Male |
| 2 | Non-binary |
| 3 | Male (FTM) |
| 4 | Female (MTF) |

### auditType (list/detail; not set by create)

| value | label | publish? |
|---:|---|---|
| 0 | live / idle | already public, or never submitted |
| 10 | under_review | no |
| 15 | pending_release (approved, waiting) | **only** via `userPublishCharacter` |
| 20 | rejected | no |

`gmtFirstPublish` empty ⇒ never gone live. Lounge classifies that as draft when audit is also 0.

---

## 4. Character write (the only mutating surface bot-post needs)

| Method | Path | bot-post |
|---|---|---|
| POST | `/yume/api/user/v1/character/createCharacter` | **YES** — Bio + Situation + World, visibility 0 |
| POST | `/yume/api/user/v1/character/updateCharacter` | only if the user later says "patch this private bot"; still no greeting/tags/photos/publish |
| POST | `/yume/api/user/v1/character/userPublishCharacter` | **NEVER** body `{ characterId }` — this is what actually publishes |

Create body (plain JSON, then envelope): see [`skills/bot-post/references/payload.md`](../skills/bot-post/references/payload.md).

Field limits: name 40, introduction 500, setting / scenario / greeting 10000.

### 5-box → API

| Archive | API | bot-post |
|---|---|---|
| Title | `characterName` | send (address) |
| Bio | `introduction` | **send** |
| Situation | `setting` | **send** |
| World / Scene | `scenario` | **send** |
| Opening | `greeting` | **null** |
| Reply Style | — | drop |
| Tags | `characterTags` | `[]` |
| Photos | `characterPhoto` / `characterThumb` | `null` |

---

## 5. Character read (mapping + idempotence)

| Method | Path | Body | Use |
|---|---|---|---|
| POST | `/yume/api/user/v1/character/getOwnUserCharacterList` | `{ pageNo, pageSize }` | owner list including private/unlisted — **source for the archive map** |
| POST | `/yume/api/user/v1/character/getUserSpaceCharacterList` | `{ userId, pageNo, pageSize }` | public space listing |
| POST | `/yume/api/user/v1/character/getOwnUserCharacterData` | `{}` | aggregate owner stats |
| POST | `/yume/api/user/v1/character/getCharacterDetail` | `{ characterId }` | verify a post (vis, greeting, tags) |
| POST | `/yume/api/user/v1/character/getCharacterList` | `{ sortName, pageNo, pageSize, ... }` | public discovery |
| POST | `/yume/api/user/v1/character/getCharacterListByTag` | tag + paging | public discovery |
| POST | `/yume/api/user/v1/character/getCharacterRankingList` | `{ pageNo, pageSize, rankingType? }` | ranking |
| POST | `/yume/api/user/v1/character/comment/getCommentPage` | `{ characterId, pageNo, pageSize }` | comments |
| GET | `/yume/api/user/v1/getLaunchData` | — | **tag catalog** (`characterTag` / `figureTag` / `pictureTag` / `galleryTag` as JSON strings) |

Live tag snapshot: [`juicychat-tags.md`](juicychat-tags.md). `createCharacterConfig` is models + reply styles, **not** tags.

Snapshot used by the 2026-08-29 map: lounge scrape 2026-08-28T21:43:22Z, **254** owner bots (own-list, not space-list).

---

## 6. Auth / login endpoints (used by bot-post)

bot-post logs in with **email + OTP** or **email + magic link**. Procedure: [`skills/bot-post/references/auth.md`](../skills/bot-post/references/auth.md). Default mailbox `you@example.com`.

| Method | Path | Body / query | bot-post |
|---|---|---|---|
| POST | `/yume/api/login/v1/sendLoginUserCodeByEmail` | `{ emailAddress }` | **YES** — send OTP |
| POST | `/yume/api/login/v1/appUserLogin` | `{ emailAddress, emailCode, loginType: "email" }` | **YES** — redeem OTP → `data.voucher` |
| POST | `/yume/api/login/v1/sendRegisterUserEmail` | `{ emailAddress, cfToken }` | **YES** — send magic link (`cfToken` = `browser-unsupported-cf-turnstile`) |
| GET | `/yume/api/emailLoginBack?param=` | — | **YES** — redeem magic link (sets `yume_voucher`) |
| GET | `/yume/api/user/v1/getUserInfo` | — | **YES** — verify session is SampleCreator |
| POST | `/yume/api/login/v1/userPasswordLogin` | `{ userNo, password }` | no (not the bot-post path) |
| POST | `/yume/api/login/v1/googleSignUp` | `{ idToken }` | no |
| GET | `/yume/api/login/v1/signOut` | — | — |
| POST | `/yume/api/user/v1/createOauthCode` | `{ client }` e.g. `characterword` | no |

---

## 7. Account / creator / social (lounge)

| Method | Path | Body |
|---|---|---|
| GET | `/yume/api/user/v1/getUserInfo` | — (session ping) |
| POST | `/yume/api/user/v1/getOtherUserInfo` | `{ userId }` |
| POST | `/yume/api/user/v1/getUserSpace` | `{ userId? }` |
| POST | `/yume/api/user/v1/getUserStatisticsData` | `{}` |
| POST | `/yume/api/user/v1/getUserInfoCount` | `{}` |
| POST | `/yume/api/user/v1/getUserFollowersList` | `{ pageNo, pageSize }` |
| POST | `/yume/api/user/v1/creator/getBenefitSummary` | `{}` |
| POST | `/yume/api/user/v1/creator/ranking/getCreatorRanking` | ranking payload |
| POST | `/yume/api/user/v1/creator/ranking/getDataCreatorRankingMonthly` | monthly ranking |
| POST | `/yume/api/user/v1/message/getMessageList` | notifications |
| POST | `/yume/api/user/v1/wallet/gemsTransactionRecord` | `{ pageNo, pageSize }` |

---

## 8. bot-post vs publish vs package-poster

```
createCharacter(visibility=0, greeting=null, tags=[])     ← bot-post
createCharacter(visibility=1, greeting=Opening, …)        ← package-poster "draft"
userPublishCharacter({ characterId })                     ← FORBIDDEN here (makes it live)
```

A bot with `auditType=15` is **already approved** and one publish call away from the feed. Mapping those ids is for **avoiding duplicates**, not for publishing them.

---

## 10. Figure / plaza / PFP (live 2026-08-29)

Full payloads, model enums, S3 attach, and the Pip demo ids: [`juicychat-figure-api.md`](juicychat-figure-api.md).

Skill prompts **do** drive generation — but only on the custom-figure and plaza endpoints, not the wizard.

| Skill mode | Endpoint | Prompt sink |
|---|---|---|
| Clean Figure | `POST /yume/api/user/v1/figure/customFigureImage` | `appearance` / `clothing` / `action` / `negative` + `artStyle` enum + cfg/steps |
| Text PFP | `POST /yume/api/user/v1/image/userGenerateImage` `{ createType: 2 }` | `inputContent` + `picModelType` + cfg/steps |
| Remix | same, `{ createType: 3, figureId }` | `inputContent` = clothes/pose; no picModelType |
| Wizard | `POST /yume/api/user/v1/figure/generateFigureImage` | dropdowns only (`race`/`bodyType` required). Skill prompts ignored |

Poll: `figureImageStatus` / `getUserGenImageStatus`. Retrieve: `GET` the `url` / `clearPictureUrl` (public CDN).

**Attach to a bot:** figure/plaza URLs are the wrong prefix. `getS3Sts { type: "character" }` → S3 PutObject → `characterPhoto = https://cdn.juicychat.ai/${uploadPath}${fileId}.jpg`. Send photo + optional `figureId` on **createCharacter**. Photo-only `updateCharacter` is a full replace and wiped private demo `2093598071156482049`. Restored demo: `2093623654847655937` (visibility 0, photo stuck, never published).

**Never:** `publishFigure`, `userPublishCharacter`.


| May live in git | Must not live in git |
|---|---|
| AES key/IV (public obfuscation) | `yume_voucher` / session cookie |
| Endpoint paths, enums, field limits | JWT / magic-link `param` |
| characterIds, visibility, auditType | `/workspace/data/juicy-session.json` |
| Archive markdown | Any `.env` with JC credentials |
