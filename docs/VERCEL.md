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

5. Deploy. Framework: Vite / TanStack Start (auto-detected).

## CLI

```bash
npm i -g vercel
vercel link
vercel env add VITE_AUTH_ENABLED
# value: false
vercel --prod
```

## After deploy

- `/` — sample dashboard
- `/api/health` — `{ "ok": true, "grokAuth": false, ... }`
- Connecting a real JuicyChat session on Vercel stores files in the function tmp dir (ephemeral). For a durable lounge, use the **local** or **desktop** branch.

## Cron (optional)

`vercel.json` keeps two daily ticks of `/api/cron/pull`. They are no-ops without a JuicyChat session.
