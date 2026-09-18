# Local installer

Run the creator dashboard on a laptop. No cloud account. No Docker required (PGLite file DB is the default).

## Linux / macOS

```bash
git clone https://github.com/rafaelwv-glitch/juicy-creator-os-share.git
cd juicy-creator-os-share
git checkout local
bash scripts/install-local.sh
npm run dev:local
```

Open http://127.0.0.1:8080 — you should see **SampleCreator**. Stop with Ctrl+C.

## Windows

```bat
git clone https://github.com/rafaelwv-glitch/juicy-creator-os-share.git
cd juicy-creator-os-share
git checkout local
scripts\install-local.cmd
npm run dev:local
```

Then open http://127.0.0.1:8080. Prefer the Electron zip/installer from [Releases](https://github.com/rafaelwv-glitch/juicy-creator-os-share/releases) if you do not want Node on the PATH.

The script checks Node 22+, installs deps, writes `.env.local` with auth off, seeds the sample warehouse, and prints the start command.

## Optional Postgres

```bash
# .env.local
# DATABASE_URL=postgres://juicy:juicy@localhost:5432/juicy
npm run db:up
npm run db:migrate
npm run dev:local
```

Leave `DATABASE_URL` unset unless you also turn auth on. This clone keeps auth off, so the shared `dev-user` must not sit on a shared Postgres.

## Import your own warehouse

Export JSON from a private install, then:

```bash
npm run db:import-warehouse -- ~/Downloads/juicy-lounge-warehouse-YYYYMMDD.json
```

Never commit that file.

## Smoke

```bash
npm run smoke
```
