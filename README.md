# Juicy Creator OS (shareable)

Clean, audited clone of the JuicyChat creator dashboard. **No app accounts, no OAuth, no API keys, no live sessions, no personal warehouse dumps.**

The UI boots on anonymous **sample bots** (`fixtures/warehouse-sample.json`). Connect your own JuicyChat lounge later with magic link / email code — that session stays on the machine (`./data`, gitignored).

| Branch | What it is |
| --- | --- |
| [`vercel`](./docs/VERCEL.md) | Hosted web app. One-click Vercel deploy. |
| [`local`](./docs/LOCAL.md) | Laptop installer (`scripts/install-local.sh`). |
| [`desktop`](./docs/DESKTOP.md) | Electron window + Linux AppImage / tarball + Windows exe. |

Default branch is `vercel`.

## What was stripped

- Better Auth / Google / X / Grok OAuth (preview client secret removed)
- Live lounge reports and character dumps
- Android / Capacitor tree
- Personal emails, account ids, and session files

JuicyChat’s public AES wire format still lives in `src/lib/juicychat/crypto.ts` — that is the site’s client-side envelope, not a user credential.

## Quick start (any branch)

```bash
git clone https://github.com/rafaelwv-glitch/juicy-creator-os-share.git
cd juicy-creator-os-share
npm install
npm run dev
```

Open the URL the dev server prints (port **8080**). You should see **SampleCreator** and two sample bots.

```bash
npm run smoke
```

## License

MIT. See [LICENSE](./LICENSE).
