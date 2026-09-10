import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { EditorHome } from "../../src/components/editor-home";
import { hasEditorSession } from "../../src/lib/server/auth/editor-page";

export const metadata: Metadata = { title: "pinata — pins" };

// The working surface (D069): the project rail, the capture canvas, the pin
// panel, and the pin table. Everything here is editor-only data, so an
// unverified visitor is sent back to the public landing rather than shown an
// empty shell — the redirect is the boundary, not a hidden component.
export default async function PinsPage() {
  if (!(await hasEditorSession())) {
    redirect("/");
  }
  return <EditorHome />;
}
