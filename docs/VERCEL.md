# Vercel — deprecated

Hosted Vercel is **no longer a supported way to run this clone**.

The shareable instance at `https://juicy-creator-os-share.vercel.app` is **paused**. Pushes to this repo do not deploy. `vite build` uses the Nitro **`node-server`** preset (a local Node process), not the Vercel preset.

Run it on a laptop or as the Electron app instead:

- [LOCAL.md](./LOCAL.md) — `npm install` then `npm run dev`
- [DESKTOP.md](./DESKTOP.md) — Windows / Linux packages from [Releases](https://github.com/rafaelwv-glitch/juicy-creator-os-share/releases)

Do **not** re-enable the Vercel project, add `DATABASE_URL`, or point GitHub at Vercel unless someone explicitly un-deprecates this path.
