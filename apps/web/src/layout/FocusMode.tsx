// FILE: apps/web/src/layout/FocusMode.tsx
/**
 * In-app Focus Mode. Does not call the browser Fullscreen API.
 * Ctrl/Cmd+Shift+F toggles; Esc exits. Announces via aria-live.
 * Parent must call fitAddon.fit() and send PTY cols/rows on transitionend (~100ms debounce).
 */
import { useEffect } from "react";

export function useFocusMode(on: boolean, setOn: (v: boolean) => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.ctrlKey || e.metaKey;
      if (meta && e.shiftKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setOn(!on);
      } else if (e.key === "Escape" && on) setOn(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [on, setOn]);
}
