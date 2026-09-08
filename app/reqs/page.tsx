import type { Metadata } from "next";
import { MarkdownArticle } from "../../src/components/markdown-article";

export const metadata: Metadata = { title: "requirements" };

export default function RequirementsPage() {
  return <MarkdownArticle sourcePath="docs/REQUIREMENTS.md" />;
}
