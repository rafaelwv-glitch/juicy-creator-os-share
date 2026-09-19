# Audit notes (shareable clone)

Scanned source `rafaelwv-glitch/juicy-creator-os` before publishing this repo.

## Removed
- Live lounge `reports/*.json` (account id, display name)
- `public/dumps/` character dumps
- Android / Capacitor tree
- Better Auth / Grok preview OAuth client secret
- Personal mailbox and account identifiers in docs/scripts
- Cloud-pull GitHub Action aimed at a private Vercel URL

## Disabled
- App-level auth (`VITE_AUTH_ENABLED` is not `"true"`)
- Google / X / Grok identity providers (empty list)
- Hosted Vercel (project paused; Nitro preset is `node-server`; `vercel.json` skips deploys)


## Kept (not user secrets)
- JuicyChat AES envelope constants in `src/lib/juicychat/crypto.ts` (same as the public website JS)
- Anonymous `fixtures/warehouse-sample.json`

## Git identity
Commits on this repo use the GitHub noreply address, not a personal mailbox.
