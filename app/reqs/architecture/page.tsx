import type { Metadata } from "next";
import { MarkdownArticle } from "../../../src/components/markdown-article";

export const metadata: Metadata = { title: "architecture" };

export default function ArchitecturePage() {
  return <MarkdownArticle sourcePath="docs/ARCHITECTURE.md" />;
}
