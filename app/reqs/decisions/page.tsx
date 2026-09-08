import type { Metadata } from "next";
import { DecisionsCatalog } from "../../../src/components/decisions-catalog";

export const metadata: Metadata = { title: "decisions" };

export default function DecisionsPage() {
  return (
    <>
      <h1>Decisions</h1>
      <DecisionsCatalog />
    </>
  );
}
