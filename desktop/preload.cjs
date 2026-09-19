"use strict";
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("juicyDesktop", {
  isDesktop: true,
  checkUpdate: () => ipcRenderer.invoke("desktop:check-update"),
  installUpdate: () => ipcRenderer.invoke("desktop:install-update"),
  onUpdate: (cb) => {
    const fn = (_event, payload) => {
      try {
        cb(payload);
      } catch {
        /* */
      }
    };
    ipcRenderer.on("desktop:update", fn);
    return () => ipcRenderer.removeListener("desktop:update", fn);
  },
});
