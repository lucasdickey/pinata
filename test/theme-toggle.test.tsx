// @vitest-environment jsdom
// The light/dark switch and the <head> script that applies a saved choice
// before the first paint (D104).
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ThemeToggle } from "../src/components/theme-toggle";
import { THEME_BOOT_SCRIPT, THEME_STORAGE_KEY } from "../src/lib/theme";

function prefersDark(dark: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation(() => ({
      matches: dark,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  prefersDark(false);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the theme boot script", () => {
  test("applies a saved choice to <html> and ignores anything else", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    new Function(THEME_BOOT_SCRIPT)();
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");

    document.documentElement.removeAttribute("data-theme");
    localStorage.setItem(THEME_STORAGE_KEY, "purple");
    new Function(THEME_BOOT_SCRIPT)();
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });

  test("leaves the device in charge when nothing is saved", () => {
    new Function(THEME_BOOT_SCRIPT)();
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });
});

describe("ThemeToggle", () => {
  test("reflects the device's dark setting when no choice is saved", async () => {
    prefersDark(true);
    render(<ThemeToggle />);
    await act(async () => {});
    expect(screen.getByRole("button", { name: "Dark mode" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("switches, saves, and switches back", async () => {
    render(<ThemeToggle />);
    await act(async () => {});
    const button = screen.getByRole("button", { name: "Dark mode" });
    expect(button).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(button);
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(button).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(button);
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    expect(button).toHaveAttribute("aria-pressed", "false");
  });

  test("works where the media query cannot be listened to (older Safari)", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    render(<ThemeToggle />);
    await act(async () => {});
    const button = screen.getByRole("button", { name: "Dark mode" });
    expect(button).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(button);
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  test("still switches when storage is unavailable", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    render(<ThemeToggle />);
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "Dark mode" }));
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    vi.restoreAllMocks();
  });
});
