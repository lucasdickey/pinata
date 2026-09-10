import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { NewProjectPage } from "../../../src/components/new-project-page";
import { hasEditorSession } from "../../../src/lib/server/auth/editor-page";

export const metadata: Metadata = { title: "pinata — new project" };

// The project entry form on its own route (D069). It used to sit permanently
// above the workspace, which cost the working surface a screenful on every
// visit; giving it a route means /pins can link to it and get the space back.
export default async function NewProjectRoute() {
  if (!(await hasEditorSession())) {
    redirect("/");
  }
  return <NewProjectPage />;
}
