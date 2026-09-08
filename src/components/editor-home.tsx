"use client";

// The authenticated editor shell. Project creation and the workspace land
// with later milestone features; this shell proves the session boundary and
// provides the keyboard-operable logout control.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { EDITOR_CSRF_COOKIE, EDITOR_CSRF_HEADER } from "../lib/auth-constants";

function readCsrfProof(): string {
  const prefix = `${EDITOR_CSRF_COOKIE}=`;
  for (const part of document.cookie.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith(prefix)) return trimmed.slice(prefix.length);
  }
  return "";
}

export function EditorHome() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function logout() {
    if (pending) return;
    setPending(true);
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        headers: { [EDITOR_CSRF_HEADER]: readCsrfProof() },
      });
    } finally {
      router.refresh();
    }
  }

  return (
    <main className="home-main">
      <h1>pinata</h1>
      <p>Signed in as Lucas (editor).</p>
      <p>No projects yet.</p>
      <p className="home-nav">
        <Link href="/reqs">Requirements, architecture, milestones, decisions, and evals</Link>
      </p>
      <button type="button" onClick={logout} disabled={pending}>
        {pending ? "Signing out…" : "Sign out"}
      </button>
    </main>
  );
}
