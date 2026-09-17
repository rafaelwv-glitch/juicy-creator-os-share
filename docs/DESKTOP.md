# Desktop (Electron)

Same web app, in a native window. No sign-in wall.

## Run from source

```bash
git clone https://github.com/rafaelwv-glitch/juicy-creator-os-share.git
cd juicy-creator-os-share
git checkout desktop
npm install
npm run desktop
```

This starts the Vite preview server on `127.0.0.1:4310` and opens an Electron window.

## Build Linux packages

```bash
npm run desktop:build
```

Outputs under `release/`:

- `Juicy Creator OS-<version>.AppImage`
- `juicy-creator-os-share-<version>.tar.gz`
- `linux-unpacked/` (the raw executable)

Needs Node 22+ and the usual Linux desktop libs (`libgtk-3`, `libnotify`, `libnss3`, `libxss1`, `libxtst6`, `xdg-utils`).

## Smoke

```bash
npm run smoke:desktop
```

Headless check: boots the bundled server, hits `/api/health`, exits.
