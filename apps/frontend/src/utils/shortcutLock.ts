// While a blocking window (the payment modal) is open, every F-key shortcut in
// the app must stay quiet: only that window may be used. Shortcut handlers
// call `shortcutsLocked()` and bail out.
let locks = 0;

export function lockShortcuts() {
  locks++;
  let released = false;
  return () => {
    if (!released) { released = true; locks--; }
  };
}

export function shortcutsLocked() {
  return locks > 0;
}

export function isFunctionKey(e: KeyboardEvent) {
  return /^F\d{1,2}$/.test(e.key);
}
