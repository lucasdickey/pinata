import type { Metadata } from "next";
import { MarkdownArticle } from "../../../src/components/markdown-article";

export const metadata: Metadata = { title: "evals" };

export default function EvalsPage() {
  return <MarkdownArticle sourcePath="docs/EVALS.md" />;
}
