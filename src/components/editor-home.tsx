"use client";

// The authenticated editor shell: the project list read from the durable
// store, the project entry form, and the keyboard-operable logout control.
// The canvas workspace lands with later milestone features.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { EDITOR_CSRF_HEADER } from "../lib/auth-constants";
import { readCsrfProof } from "../lib/csrf";
import { ProjectCreateForm } from "./project-create-form";
import { ProjectWorkspace, type WorkspaceProject } from "./project-workspace";

type ListState =
  | { status: "loading" }
  | { status: "ready"; projects: WorkspaceProject[] }
  | { status: "failed" };

export function EditorHome() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [creating, setCreating] = useState(false);
  const [list, setList] = useState<ListState>({ status: "loading" });

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/projects", { cache: "no-store" });
      if (!response.ok) {
        setList({ status: "failed" });
        return;
      }
      const payload = (await response.json()) as { projects: WorkspaceProject[] };
      setList({ status: "ready", projects: payload.projects });
    } catch {
      setList({ status: "failed" });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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

  function onCreated() {
    setCreating(false);
    // The transaction already committed; read the hierarchy back from the
    // server rather than trusting the response as local state.
    void load();
  }

  return (
    <main className="home-main">
      <h1>pinata</h1>
      <p>Signed in as Lucas (editor).</p>

      <section aria-labelledby="projects-heading">
        <h2 id="projects-heading">Projects</h2>
        {list.status === "loading" ? <p>Loading projects…</p> : null}
        {list.status === "failed" ? (
          <p role="alert">Projects could not be loaded. Refresh to try again.</p>
        ) : null}
        {list.status === "ready" && list.projects.length === 0 ? (
          <p>No projects yet.</p>
        ) : null}
        {list.status === "ready" && list.projects.length > 0 ? (
          <ProjectWorkspace projects={list.projects} onChanged={() => void load()} />
        ) : null}
      </section>

      {creating ? (
        <ProjectCreateForm onCreated={onCreated} onCancel={() => setCreating(false)} />
      ) : (
        <button type="button" onClick={() => setCreating(true)}>
          New project
        </button>
      )}

      <p className="home-nav">
        <Link href="/reqs">Requirements, architecture, milestones, decisions, and evals</Link>
      </p>
      <button type="button" onClick={logout} disabled={pending}>
        {pending ? "Signing out…" : "Sign out"}
      </button>
    </main>
  );
}
