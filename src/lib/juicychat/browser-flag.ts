/** Tiny client flags — imported by durable middleware without pulling actions.ts. */

let pulling = 0;
let remember: (() => void) | null = null;
let flush: (() => void) | null = null;

export function beginBrowserPull() {
  pulling += 1;
}

export function endBrowserPull() {
  pulling = Math.max(0, pulling - 1);
}

export function isBrowserPulling() {
  return pulling > 0;
}

export function setBrowserRememberScheduler(fn: () => void, flushFn?: () => void) {
  remember = fn;
  flush = flushFn || fn;
}

export function scheduleRememberBrowserCache() {
  if (typeof window === "undefined" || pulling > 0) return;
  remember?.();
}

/** Immediate write-through after login / pin so a tab close does not race the debounce. */
export function flushRememberBrowserCache() {
  if (typeof window === "undefined" || pulling > 0) return;
  flush?.();
}
