"use client";

// The landing page's sign-in, as one pop-up (D123, from PR #14). Every way
// in — the top bar, the hero button, the invitation card, and the footer —
// opens the same dialog, so the password form no longer sits in the page.
//
// It is the browser's own <dialog> opened with showModal(): the page behind
// is inert, keyboard focus stays inside, and Escape closes it. Opening moves
// focus to the password field; closing puts it back on the button that
// opened it. A link to /#editor-login still opens it, so older links and
// bookmarks keep working. Where showModal() is missing (the test DOM), the
// dialog is simply shown with the `open` attribute.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  type MouseEvent,
  type ReactNode,
} from "react";
import { LoginForm } from "./login-form";

const SignInContext = createContext<(() => void) | null>(null);

export function SignInProvider({ children }: { children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement | null>(null);
  const opener = useRef<HTMLElement | null>(null);

  const open = useCallback(() => {
    const element = dialog.current;
    if (!element || element.open) return;
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (typeof element.showModal === "function") element.showModal();
    else element.setAttribute("open", "");
    element.querySelector<HTMLInputElement>("input[type=password]")?.focus();
  }, []);

  // Back to the button that opened it, however the dialog closed.
  const onClose = useCallback(() => {
    opener.current?.focus();
    opener.current = null;
    if (window.location.hash === "#editor-login") {
      history.replaceState(null, "", window.location.pathname + window.location.search);
    }
  }, []);

  const close = useCallback(() => {
    const element = dialog.current;
    if (!element) return;
    if (typeof element.close === "function") element.close();
    else {
      // The fallback fires no close event, so run its steps here.
      element.removeAttribute("open");
      onClose();
    }
  }, [onClose]);

  // A click on the backdrop lands on the dialog element itself.
  const onClick = (event: MouseEvent<HTMLDialogElement>) => {
    if (event.target === event.currentTarget) close();
  };

  useEffect(() => {
    const fromHash = () => {
      if (window.location.hash === "#editor-login") open();
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, [open]);

  return (
    <SignInContext.Provider value={open}>
      {children}
      <dialog
        ref={dialog}
        className="login-dialog"
        aria-labelledby="editor-login-heading"
        onClose={onClose}
        onClick={onClick}
        onKeyDown={(event) => {
          // The fallback has no built-in Escape.
          if (event.key === "Escape" && typeof dialog.current?.showModal !== "function") close();
        }}
      >
        <button type="button" className="login-dialog-close" aria-label="Close sign in" onClick={close}>
          <svg viewBox="0 0 24 24" width={18} height={18} aria-hidden="true" focusable="false">
            <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
          </svg>
        </button>
        <LoginForm />
      </dialog>
    </SignInContext.Provider>
  );
}

/** A button that opens the sign-in dialog. */
export function SignInButton({ className, children }: { className?: string; children: ReactNode }) {
  const open = useContext(SignInContext);
  return (
    <button type="button" className={className} onClick={() => open?.()}>
      {children}
    </button>
  );
}
