# Juicy Creator OS (shareable)

Clean, audited clone of the JuicyChat creator dashboard. **No app accounts, no OAuth, no API keys, no live sessions, no personal warehouse dumps.**

This clone is **local-only**. Hosted Vercel is paused and deprecated — do not deploy it.

The UI boots on anonymous **sample bots** (`fixtures/warehouse-sample.json`). Connect your own JuicyChat lounge later with magic link / email code. Session + warehouse live in a **file-backed PGLite** database on this machine (see [LOCAL.md](./docs/LOCAL.md)).

| How to run | Docs |
| --- | --- |
| Laptop (`npm run dev`) | [LOCAL.md](./docs/LOCAL.md) |
| Electron (Windows / Linux) | [DESKTOP.md](./docs/DESKTOP.md) · [Releases](https://github.com/rafaelwv-glitch/juicy-creator-os-share/releases) |

Default branch is `main`. The old `vercel` branch is a leftover; `vercel.json` skips every deploy.

## Quick start

```bash
git clone https://github.com/rafaelwv-glitch/juicy-creator-os-share.git
cd juicy-creator-os-share
npm install
npm run dev
```

Open http://127.0.0.1:8080 — you should see **SampleCreator** and two sample bots.

Linux/macOS installer: `bash scripts/install-local.sh`  
Windows installer: `scripts\install-local.cmd`

Production Node server (after a local build):

```bash
npm run build
npm start
```

```bash
npm run smoke
npm run smoke:local
```

## What was stripped

- Better Auth / Google / X / Grok OAuth (preview client secret removed)
- Live lounge reports and character dumps
- Android / Capacitor tree
- Personal emails, account ids, and session files
- Vercel Nitro preset, hosted crons, and the public shareable Vercel instance

JuicyChat’s public AES wire format still lives in `src/lib/juicychat/crypto.ts` — that is the site’s client-side envelope, not a user credential.

## License

MIT. See [LICENSE](./LICENSE).
