// Light and dark themes (D104). With no saved choice the page follows the
// device (prefers-color-scheme); the toggle saves an explicit "light" or
// "dark" in localStorage, and THEME_BOOT_SCRIPT applies it from <head> before
// the first paint, so a saved theme never flashes the other one first. The
// value lives only in the visitor's own browser and is never sent anywhere.

export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "pinata:theme";

/**
 * Runs synchronously in <head> (see app/layout.tsx and Next's "preventing
 * flash before hydration" guide): copies a saved theme onto <html
 * data-theme>. Anything else, including storage that throws in a private
 * window, leaves the attribute off and the device setting in charge.
 */
export const THEME_BOOT_SCRIPT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}})()`;

/** The theme the page is showing right now: the saved choice, else the device's. */
export function currentTheme(root: HTMLElement = document.documentElement): Theme {
  const set = root.getAttribute("data-theme");
  if (set === "light" || set === "dark") return set;
  return typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

/** Show a theme now and remember it; storage failures only cost the memory. */
export function applyTheme(theme: Theme, root: HTMLElement = document.documentElement): void {
  root.setAttribute("data-theme", theme);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Private windows and blocked storage: the page still switches.
  }
}
