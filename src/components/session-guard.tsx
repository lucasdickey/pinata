"use client";

// Signing in again without losing work (D124).
//
// An editor session ends after a while. Before this, a tab left open past
// that point still showed its screenshots and pins, but every new request
// was refused, and the draft only said "could not be loaded" or "could not
// be saved". Now, while the editor is open, a request to the editor's own
// API that comes back 401 opens a sign-in dialog right where Lucas is. The
// page is not reloaded, so the draft, its comment, and everything else on
// screen stay as they were. Signing in sends the refused request again with
// the new session (and its new CSRF proof), so the save that failed simply
// completes. Several requests refused at once wait on the same sign-in.
// Closing the dialog instead lets them fail as before, draft still there.
//
// It wraps window.fetch for as long as it is mounted, which catches every
// editor request without changing each caller. Sign-in itself, the founder
// routes, and other sites are never touched.

import { useCallback, useEffect, useRef, useState } from "react";
import { EDITOR_CSRF_HEADER } from "../lib/auth-constants";
import { readCsrfProof } from "../lib/csrf";
import { LoginForm } from "./login-form";

/** True for this site's editor API, the only requests worth signing in for. */
export function isEditorApiRequest(input: RequestInfo | URL): boolean {
  const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  let url: URL;
  try {
    url = new URL(raw, window.location.href);
  } catch {
    return false;
  }
  if (url.origin !== window.location.origin) return false;
  if (!url.pathname.startsWith("/api/")) return false;
  return !url.pathname.startsWith("/api/auth/") && !url.pathname.startsWith("/api/founder/");
}

/** The same request options with the CSRF proof of the new session. */
export function withFreshCsrf(init: RequestInit | undefined): RequestInit | undefined {
  if (!init?.headers) return init;
  const headers = new Headers(init.headers);
  if (!headers.has(EDITOR_CSRF_HEADER)) return init;
  headers.set(EDITOR_CSRF_HEADER, readCsrfProof());
  return { ...init, headers };
}

export function SessionGuard() {
  const dialog = useRef<HTMLDialogElement | null>(null);
  // The sign-in every refused request is waiting on, if one is open.
  const pending = useRef<{ promise: Promise<boolean>; settle: (ok: boolean) => void } | null>(
    null,
  );
  // Remount the form for each sign-in so no old error lingers.
  const [round, setRound] = useState(0);

  const settle = useCallback((ok: boolean) => {
    const current = pending.current;
    pending.current = null;
    const element = dialog.current;
    if (element?.open) {
      if (typeof element.close === "function") element.close();
      else element.removeAttribute("open");
    }
    current?.settle(ok);
  }, []);

  const signInAgain = useCallback((): Promise<boolean> => {
    if (pending.current) return pending.current.promise;
    let resolve: (ok: boolean) => void = () => {};
    const promise = new Promise<boolean>((done) => {
      resolve = done;
    });
    pending.current = { promise, settle: resolve };
    setRound((value) => value + 1);
    const element = dialog.current;
    if (element && !element.open) {
      if (typeof element.showModal === "function") element.showModal();
      else element.setAttribute("open", "");
      requestAnimationFrame(() =>
        element.querySelector<HTMLInputElement>("input[type=password]")?.focus(),
      );
    }
    return promise;
  }, []);

  useEffect(() => {
    const original = window.fetch;
    const guarded: typeof fetch = async (input, init) => {
      const response = await original(input, init);
      if (response.status !== 401 || !isEditorApiRequest(input)) return response;
      const signedIn = await signInAgain();
      if (!signedIn) return response;
      return original(input, withFreshCsrf(init));
    };
    window.fetch = guarded;
    return () => {
      if (window.fetch === guarded) window.fetch = original;
    };
  }, [signInAgain]);

  return (
    <dialog
      ref={dialog}
      className="login-dialog"
      aria-labelledby="editor-login-heading"
      data-testid="session-guard"
      // Escape or the close button: the waiting requests fail as before.
      onClose={() => settle(false)}
      onKeyDown={(event) => {
        if (event.key === "Escape" && typeof dialog.current?.showModal !== "function") {
          settle(false);
        }
      }}
    >
      <button
        type="button"
        className="login-dialog-close"
        aria-label="Close sign in"
        onClick={() => settle(false)}
      >
        <svg viewBox="0 0 24 24" width={18} height={18} aria-hidden="true" focusable="false">
          <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
        </svg>
      </button>
      <LoginForm
        key={round}
        title="Sign in again"
        intro="Your sign-in has expired. Sign in to keep going — your work is still here and will save."
        onSignedIn={() => settle(true)}
      />
    </dialog>
  );
}
