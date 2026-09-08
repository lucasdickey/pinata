import { notFound } from "next/navigation";

// Any unknown /reqs/* path lands here and renders the segment's bounded
// not-found page (with a working link back to the hub) at HTTP 404.
export default function UnknownRequirementsRoute() {
  notFound();
}
