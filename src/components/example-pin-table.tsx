"use client";

// The landing example's details (D126): the app's own pin table, filled from
// the repo fixture, so the landing shows exactly what the workspace shows —
// page, device, badge, whole comment, status, position, element and path —
// and "Copy all as Markdown" copies the same Markdown the app would. Rows
// select like the app's; nothing is fetched and nothing is saved.

import { useState } from "react";
import type { AnnotationView, PinElementSnapshot } from "../lib/annotations";
import { EXAMPLE_CAPTURE, type ExampleMark } from "../lib/example-capture";
import { formatPinsAsMarkdown } from "../lib/pin-export";
import { PinTable, type PinTableRow } from "./pin-table";

function exampleSnapshot(mark: ExampleMark): PinElementSnapshot | null {
  const element = mark.element;
  if (!element) return null;
  return {
    id: `example-el-${mark.number}`,
    kind: element.kind,
    tag: element.tag,
    role: element.role,
    text: element.text,
    accessibleName: "",
    hints: { id: "", classes: [], alt: "", title: "", testId: "" },
    path: element.path,
    rect: element.rect,
  };
}

/** One fixture mark in the shape the app's views use. */
export function exampleAnnotation(mark: ExampleMark): AnnotationView {
  const base = {
    id: `example-${mark.number}`,
    captureId: "example-capture",
    number: mark.number,
    body: mark.body,
    elementSnapshot: exampleSnapshot(mark),
    revision: 1,
    // A founder reply in the thread is what makes a mark "Replied" (D075).
    status: mark.thread.some((entry) => entry.author === "founder") ? "replied" : "open",
    unreadReplies: 0,
    createdAt: 0,
  } as const;
  switch (mark.kind) {
    case "pin":
      return { ...base, kind: "pin", tip: mark.tip };
    case "rectangle":
      return { ...base, kind: "rectangle", rect: mark.rect };
    case "circle":
      return { ...base, kind: "circle", circle: mark.circle };
    case "arrow":
      return { ...base, kind: "arrow", arrow: mark.arrow };
  }
}

const ROWS: PinTableRow[] = EXAMPLE_CAPTURE.marks.map((mark) => ({
  pin: exampleAnnotation(mark),
  pageUrl: EXAMPLE_CAPTURE.pageUrl,
  variant: EXAMPLE_CAPTURE.device,
  attempt: EXAMPLE_CAPTURE.version,
}));

export function ExamplePinTable() {
  const [selected, setSelected] = useState<string | null>(ROWS[0]?.pin.id ?? null);
  return (
    <PinTable
      rows={ROWS}
      status="ready"
      heading="All pins in this example"
      markdown={() =>
        formatPinsAsMarkdown(
          ROWS.map((row) => row.pin),
          {
            pageUrl: EXAMPLE_CAPTURE.pageUrl,
            variant: EXAMPLE_CAPTURE.device,
            attempt: EXAMPLE_CAPTURE.version,
          },
        )
      }
      selectedPinId={selected}
      onSelectPin={setSelected}
    />
  );
}
