/** Tiny client flags — imported by durable middleware without pulling actions.ts. */

let pulling = false;
let remember: (() => void) | null = null;

export function beginBrowserPull() {
  pulling = true;
}

export function endBrowserPull() {
  pulling = false;
}

export function isBrowserPulling() {
  return pulling;
}

export function setBrowserRememberScheduler(fn: () => void) {
  remember = fn;
}

export function scheduleRememberBrowserCache() {
  if (typeof window === "undefined" || pulling) return;
  remember?.();
}
