# Local installer

Run the creator dashboard on a laptop. No cloud account. No Docker required (PGLite file DB is the default). Hosted Vercel is not used.

## Linux / macOS

```bash
git clone https://github.com/rafaelwv-glitch/juicy-creator-os-share.git
cd juicy-creator-os-share
bash scripts/install-local.sh
npm run dev
```

Open http://127.0.0.1:8080 — you should see **SampleCreator**. Stop with Ctrl+C.

## Windows

```bat
git clone https://github.com/rafaelwv-glitch/juicy-creator-os-share.git
cd juicy-creator-os-share
scripts\install-local.cmd
npm run dev
```

Then open http://127.0.0.1:8080. Prefer the Electron zip/installer from [Releases](https://github.com/rafaelwv-glitch/juicy-creator-os-share/releases) if you do not want Node on the PATH.

The script checks Node 22+, installs deps, writes `.env.local` with auth off, seeds the sample warehouse, and prints the start command.

`npm run dev` and `npm run dev:local` are the same: file-backed PGLite, then Vite on port 8080.

## Production Node server

```bash
npm run build
npm start
```

`vite build` uses Nitro **`node-server`** (a local process). It does **not** emit a Vercel function bundle.

## Optional Postgres

```bash
# .env.local
# DATABASE_URL=postgres://juicy:juicy@localhost:5432/juicy
npm run db:up
npm run db:migrate
npm run dev
```

Leave `DATABASE_URL` unset unless you also turn auth on. This clone keeps auth off, so the shared `dev-user` must not sit on a shared Postgres.

## Where data lives

The local client **reads and writes** a file-backed PGLite database plus JSON warehouse files:

| OS | Folder |
| --- | --- |
| Linux | `~/.local/share/juicy-creator-os/` |
| Windows | `%APPDATA%\Juicy Creator OS\` |
| macOS | `~/Library/Application Support/Juicy Creator OS/` |

Inside that folder: `lounge/` (JSON) and `pglite/` (embedded Postgres). Copy the whole folder to back up. Config → Database shows the path.

If this checkout already has `./data/last-snapshot.json`, that folder is still used (older installs). Override with `JUICY_DATA_DIR` / `PGLITE_DATA_DIR`.

## Import your own warehouse

Export JSON from a private install, then:

```bash
npm run db:import-warehouse -- ~/Downloads/juicy-lounge-warehouse-YYYYMMDD.json
```

Never commit that file.

## Smoke

```bash
npm run smoke
npm run smoke:local
```
