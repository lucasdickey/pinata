"use client";

// The single editor entry point: one labeled, masked password prompt that
// posts to the same-origin server login route. No username, email, sign-up,
// reset, or third-party control exists by design (VAL-AUTH-001). The
// submitted value is cleared after every attempt and never stored anywhere
// but component state for the life of the request.

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

export function LoginForm() {
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
        router.refresh();
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
    <section aria-labelledby="editor-login-heading" className="login-section">
      <h2 id="editor-login-heading">Editor sign in</h2>
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
