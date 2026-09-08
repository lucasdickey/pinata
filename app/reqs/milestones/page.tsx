import type { Metadata } from "next";
import { MarkdownArticle } from "../../../src/components/markdown-article";

export const metadata: Metadata = { title: "milestones" };

export default function MilestonesPage() {
  return <MarkdownArticle sourcePath="docs/MILESTONES.md" />;
}
