"use client";

// The single editor entry point: one labeled, masked password prompt that
// posts to the same-origin server login route. No username, email, sign-up,
// reset, or third-party control exists by design (VAL-AUTH-001). The
// submitted value is cleared after every attempt and never stored anywhere
// but component state for the life of the request.

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

export function LoginForm({
  title = "Editor sign in",
  intro,
  onSignedIn,
}: {
  title?: string;
  intro?: string;
  /**
   * Stay on the page after signing in and hand control back, instead of
   * going to /pins: signing in again mid-edit keeps the work on screen
   * (D124).
   */
  onSignedIn?: () => void;
} = {}) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (response.ok) {
        if (onSignedIn) {
          onSignedIn();
          return;
        }
        // Since the route split (D069) the editor surface has its own
        // address, so sign-in navigates rather than re-rendering in place.
        // Creating a project lives behind sign-in (D103), so everyone goes
        // straight to work.
        router.replace("/pins");
        router.refresh();
        return;
      }
      if (response.status === 429) {
        // Durable login throttling (VAL-AUTH-006): bounded generic guidance
        // from the Retry-After header; never a password-correctness hint.
        const retryAfter = Number(response.headers.get("retry-after"));
        const minutes =
          Number.isFinite(retryAfter) && retryAfter > 0 ? Math.ceil(retryAfter / 60) : null;
        setError(
          minutes === null
            ? "Too many attempts. Please try again later."
            : `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
        );
        return;
      }
      // The server's failure is deliberately generic; mirror that here.
      setError("The password did not match.");
    } catch {
      setError("Sign-in failed. Check your connection and try again.");
    } finally {
      setPassword("");
      setPending(false);
    }
  }

  return (
    <section id="editor-login" aria-labelledby="editor-login-heading" className="login-section">
      <h2 id="editor-login-heading">{title}</h2>
      {intro ? <p className="login-intro">{intro}</p> : null}
      <form onSubmit={onSubmit}>
        <label htmlFor="editor-password">Password</label>
        <input
          id="editor-password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <button type="submit" disabled={pending}>
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </form>
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}
