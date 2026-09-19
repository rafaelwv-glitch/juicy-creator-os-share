#!/usr/bin/env node
/**
 * Electron shell around the TanStack Start app.
 * Spawns vite (preview if built, else dev) on 127.0.0.1:4310.
 * ELECTRON_RUN_AS_NODE lets the packaged Electron binary run vite as Node
 * on both Linux and Windows.
 *
 * Lounge DB lives under Electron userData (or next to a portable exe),
 * never the AppImage mount / Program Files.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { app, BrowserWindow, shell } = require("electron");

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.DESKTOP_PORT || 4310);
const HOST = "127.0.0.1";
const url = `http://${HOST}:${PORT}/`;
const isWin = process.platform === "win32";

function loungeRoot() {
  const portable = process.env.PORTABLE_EXECUTABLE_DIR;
  if (portable) return path.join(portable, "Juicy Creator OS Data");
  return app.getPath("userData");
}

function applyLoungeEnv() {
  const home = loungeRoot();
  const lounge = path.join(home, "lounge");
  const pglite = path.join(home, "pglite");
  mkdirSync(lounge, { recursive: true });
  mkdirSync(pglite, { recursive: true });
  const readme = path.join(home, "README.txt");
  if (!existsSync(readme)) {
    writeFileSync(
      readme,
      "Juicy Creator OS — local database\n\nlounge/   JSON warehouse\npglite/   embedded Postgres\n\nThe app reads and writes this folder. Copy it to back up.\n",
      "utf8",
    );
  }
  process.env.ELECTRON = "1";
  process.env.ELECTRON_USER_DATA = home;
  process.env.JUICY_DATA_DIR = lounge;
  process.env.PGLITE_DATA_DIR = pglite;
  process.env.VITE_AUTH_ENABLED = process.env.VITE_AUTH_ENABLED || "false";
  return { home, lounge, pglite };
}

function startServer() {
  const nitroJs = path.join(root, ".output", "server", "index.mjs");
  const viteJs = path.join(root, "node_modules", "vite", "bin", "vite.js");
  let args;
  const env = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",
    PORT: String(PORT),
    NITRO_PORT: String(PORT),
    HOST,
    NITRO_HOST: HOST,
  };
  if (existsSync(nitroJs)) {
    args = [nitroJs];
  } else {
    const built = existsSync(path.join(root, "dist"));
    args = built
      ? [viteJs, "preview", "--host", HOST, "--port", String(PORT)]
      : [viteJs, "dev", "--host", HOST, "--port", String(PORT)];
  }
  const child = spawn(process.execPath, args, {
    cwd: root,
    env,
    stdio: "inherit",
    windowsHide: true,
  });
  child.on("exit", (code) => {
    if (!app.isQuiting && code && code !== 0) {
      console.error("app server exited", code);
      app.quit();
    }
  });
  app.on("before-quit", () => {
    app.isQuiting = true;
    try {
      if (isWin) child.kill();
      else child.kill("SIGTERM");
    } catch {
      /* */
    }
  });
  return child;
}

function waitForServer(tries = 80) {
  return new Promise((resolve, reject) => {
    const tick = (n) => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve();
      });
      req.on("error", () => {
        if (n >= tries) reject(new Error("desktop server did not become ready"));
        else setTimeout(() => tick(n + 1), 250);
      });
    };
    tick(0);
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#0a0b14",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    title: "Juicy Creator OS",
  });
  win.removeMenu?.();
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    if (target.startsWith("file:") || target.startsWith("http://127.0.0.1") || target.startsWith("http://localhost")) {
      return { action: "allow" };
    }
    void shell.openExternal(target);
    return { action: "deny" };
  });
  void win.loadURL(url);
}

app.whenReady().then(async () => {
  const dirs = applyLoungeEnv();
  console.warn("[desktop] lounge DB", dirs.home);
  startServer();
  await waitForServer();
  createWindow();
});

app.on("window-all-closed", () => app.quit());
