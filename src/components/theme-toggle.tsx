"use client";

// The light/dark switch (D104): one button whose pressed state says whether
// the dark theme is showing. It renders unpressed on the server and reads the
// real theme after mount, because only the browser knows the saved choice
// and the device setting; the <head> script has already painted the right
// colors, so nothing flashes while it catches up.

import { useEffect, useState } from "react";
import { applyTheme, currentTheme, type Theme } from "../lib/theme";

export function ThemeToggle({ className }: { className?: string }) {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    setTheme(currentTheme());
    // Follow the device while no choice is saved, so switching the system
    // theme with the page open keeps the button honest.
    // Older Safari's MediaQueryList has no addEventListener; there the
    // button simply catches up on the next page load.
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    if (typeof media.addEventListener !== "function") return;
    const onChange = () => setTheme(currentTheme());
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  const dark = theme === "dark";
  return (
    <button
      type="button"
      className={className ? `theme-toggle ${className}` : "theme-toggle"}
      aria-label="Dark mode"
      aria-pressed={dark}
      title={dark ? "Switch to the light theme" : "Switch to the dark theme"}
      onClick={() => {
        const next: Theme = dark ? "light" : "dark";
        applyTheme(next);
        setTheme(next);
      }}
    >
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
        {dark ? (
          // A sun: pressing it goes back to light.
          <>
            <circle cx="12" cy="12" r="4.2" />
            <path d="M12 2.5v2.2M12 19.3v2.2M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6" />
          </>
        ) : (
          // A moon: pressing it goes dark.
          <path d="M20 14.6A8 8 0 0 1 9.4 4a8 8 0 1 0 10.6 10.6Z" />
        )}
      </svg>
    </button>
  );
}
