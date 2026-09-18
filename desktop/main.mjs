#!/usr/bin/env node
/**
 * Electron shell around the TanStack Start app.
 * Spawns vite (preview if built, else dev) on 127.0.0.1:4310.
 * ELECTRON_RUN_AS_NODE lets the packaged Electron binary run vite as Node
 * on both Linux and Windows.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { app, BrowserWindow } = require("electron");

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.DESKTOP_PORT || 4310);
const HOST = "127.0.0.1";
const url = `http://${HOST}:${PORT}/`;
const isWin = process.platform === "win32";

function startServer() {
  const viteJs = path.join(root, "node_modules", "vite", "bin", "vite.js");
  const built = existsSync(path.join(root, "dist")) || existsSync(path.join(root, ".output"));
  const args = built
    ? [viteJs, "preview", "--host", HOST, "--port", String(PORT)]
    : [viteJs, "dev", "--host", HOST, "--port", String(PORT)];
  const child = spawn(process.execPath, args, {
    cwd: root,
    env: {
      ...process.env,
      VITE_AUTH_ENABLED: "false",
      ELECTRON: "1",
      ELECTRON_RUN_AS_NODE: "1",
    },
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
  void win.loadURL(url);
}

app.whenReady().then(async () => {
  startServer();
  await waitForServer();
  createWindow();
});

app.on("window-all-closed", () => app.quit());
