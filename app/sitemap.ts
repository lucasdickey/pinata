import type { MetadataRoute } from "next";

const origin = "https://yourpinata.dev";
const publicPaths = [
  "/",
  "/walkthrough",
  "/reqs",
  "/reqs/architecture",
  "/reqs/milestones",
  "/reqs/decisions",
  "/reqs/evals",
];

export default function sitemap(): MetadataRoute.Sitemap {
  return publicPaths.map((path) => ({ url: new URL(path, origin).href }));
}
