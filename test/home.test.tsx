// @vitest-environment jsdom
// Smoke test proving the Vitest + jsdom + React Testing Library chain renders
// real components. Feature suites build on this path.
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { Home } from "../src/components/home";

describe("Home", () => {
  test("renders the product name and naming story", () => {
    render(<Home />);
    expect(screen.getByRole("heading", { level: 1, name: "pinata" })).toBeInTheDocument();
    expect(screen.getByText(/directional feedback/)).toBeInTheDocument();
  });
});
