# Desktop (Electron)

Same web app, in a native window. No sign-in wall.

Prebuilt installers: [GitHub Releases](https://github.com/rafaelwv-glitch/juicy-creator-os-share/releases).

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

- `Juicy-Creator-OS-<version>-linux-x64.AppImage`
- `Juicy-Creator-OS-<version>-linux-x64.tar.gz`
- `linux-unpacked/` (the raw executable)

Needs Node 22+ and the usual Linux desktop libs (`libgtk-3`, `libnotify`, `libnss3`, `libxss1`, `libxtst6`, `xdg-utils`).

## Build Windows packages

```bash
npm run desktop:build:win
```

Native Windows CI builds the NSIS installer and portable `.exe`. From Linux, `zip` always builds; Wine is required for NSIS/portable.

Outputs under `release/`:

- `Juicy-Creator-OS-<version>-win-x64-setup.exe` — one-click installer
- `Juicy-Creator-OS-<version>-win-x64-portable.exe` — single-file portable
- `Juicy-Creator-OS-<version>-win-x64.zip` — unpacked folder + `Juicy-Creator-OS.exe`

Unsigned. Windows SmartScreen may warn on first run — More info → Run anyway.

## Smoke

```bash
npm run smoke:desktop
```

Headless check: boots the bundled server, hits `/api/health`, exits.
