# Deploy on Vercel

This branch is the hosted web app. Auth is **off**. There is no database requirement — the serverless function seeds the anonymous sample warehouse on a cold start.

## One-click

1. Fork or clone [rafaelwv-glitch/juicy-creator-os-share](https://github.com/rafaelwv-glitch/juicy-creator-os-share).
2. In Vercel: **Add New Project** → import that GitHub repo.
3. Set **Production Branch** to `vercel`.
4. Environment variables (optional — defaults are already safe):

   | Name | Value |
   | --- | --- |
   | `VITE_AUTH_ENABLED` | `false` |

   Do **not** set `DATABASE_URL`, `BETTER_AUTH_SECRET`, `GROK_AUTH_*`, or any JuicyChat cookie.

5. **Turn off Deployment Protection** (required). Vercel teams default this **on**. It 401/403s dashboard server functions, which the UI shows as **Unauthorized** when someone tries to connect JuicyChat.

   Project → **Settings → Deployment Protection**:
   - Vercel Authentication: **Disabled**
   - Password protection: **Off**
   - Standard Protection: **Off** for Production

6. Deploy. Framework: Vite / TanStack Start (auto-detected).

## CLI

```bash
npm i -g vercel
vercel link
vercel env add VITE_AUTH_ENABLED
# value: false
vercel --prod
```

Then disable Deployment Protection in the dashboard (CLI cannot flip that flag from this repo).

## After deploy

- `/` — sample dashboard (SampleCreator, 2 bots)
- `/api/health` — `{ "ok": true, "grokAuth": false, ... }`
- Connecting a real JuicyChat session: open **Config → JuicyChat source** (magic link / password / cookie). Do **not** use `/login` — app OAuth is off on this clone. A working connect returns JuicyChat’s own message (`Magic link sent`, `user not exist`, …), never a bare `Unauthorized`.
- The session is stored in HttpOnly cookies plus `/tmp` (ephemeral across cold starts). For a durable lounge, use the **local** or **desktop** branch.

If connect still says **Unauthorized** / **Forbidden**: the deploy still has Vercel Authentication on, or you are on the `/login` page. Fix protection, then use Config.

## Cron (optional)

`vercel.json` keeps two daily ticks of `/api/cron/pull`. They are no-ops without a JuicyChat session.
