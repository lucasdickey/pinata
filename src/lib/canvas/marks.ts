// Client-safe helpers for the mark kinds (D079, D082, D083): the draft shape the
// canvas reports to the workspace, the request shapes each kind sends, and
// the labels the panel, table, and export print. Since D078 the one name a
// mark goes by everywhere (markLabel) lives here too, so the wording cannot
// drift between surfaces. Pure functions only, so the exact text and
// payloads are unit-testable without a DOM.

import type {
  AnnotationView,
  ArrowAnnotationView,
  CircleAnnotationView,
  PinAnnotationView,
  PinElementSnapshot,
  RectangleAnnotationView,
} from "../annotations";
import { pinExcerpt } from "../feedback-counts";
import { arrowBounds, arrowMidpoint, type NaturalArrow } from "./arrow";
import type { NaturalPoint } from "./camera";
import { circleBounds, circleCenter, type NaturalCircle } from "./circle";
import type { NaturalRect } from "./rectangle";

/** A transient, unsaved mark: a pin tip, a rectangle, a circle, or an arrow. */
export type DraftMark =
  | { kind: "pin"; tip: NaturalPoint }
  | { kind: "rectangle"; rect: NaturalRect }
  | { kind: "circle"; circle: NaturalCircle }
  | { kind: "arrow"; arrow: NaturalArrow };

export type MarkKind = DraftMark["kind"];

/** The persisted geometry of one annotation, in the draft's shape. */
export function markOf(annotation: AnnotationView): DraftMark {
  if (annotation.kind === "rectangle") return { kind: "rectangle", rect: { ...annotation.rect } };
  if (annotation.kind === "circle") return { kind: "circle", circle: { ...annotation.circle } };
  if (annotation.kind === "arrow") {
    return {
      kind: "arrow",
      arrow: { start: { ...annotation.arrow.start }, end: { ...annotation.arrow.end } },
    };
  }
  return { kind: "pin", tip: { ...annotation.tip } };
}

/** The same annotation with new geometry (an optimistic local move). */
export function withMark(annotation: AnnotationView, mark: DraftMark): AnnotationView {
  if (annotation.kind === "rectangle" && mark.kind === "rectangle") {
    return { ...annotation, rect: { ...mark.rect } };
  }
  if (annotation.kind === "circle" && mark.kind === "circle") {
    return { ...annotation, circle: { ...mark.circle } };
  }
  if (annotation.kind === "arrow" && mark.kind === "arrow") {
    return {
      ...annotation,
      arrow: { start: { ...mark.arrow.start }, end: { ...mark.arrow.end } },
    };
  }
  if (annotation.kind === "pin" && mark.kind === "pin") {
    return { ...annotation, tip: { ...mark.tip } };
  }
  return annotation;
}

/** The geometry fields a create or PATCH body carries for one mark. */
export function markPayload(
  mark: DraftMark,
):
  | { tip: NaturalPoint }
  | { rect: NaturalRect }
  | { circle: NaturalCircle }
  | { arrow: NaturalArrow } {
  if (mark.kind === "rectangle") return { rect: { ...mark.rect } };
  if (mark.kind === "circle") return { circle: { ...mark.circle } };
  if (mark.kind === "arrow") {
    return { arrow: { start: { ...mark.arrow.start }, end: { ...mark.arrow.end } } };
  }
  return { tip: { ...mark.tip } };
}

/**
 * The context route's query for one mark, which is what chooses the ranking
 * by kind (D083): `x=&y=` asks for the point ranking, around a pin's tip or
 * an arrow's head, and `x=&y=&width=&height=` asks for the overlap ranking of
 * a region — a rectangle's box, or a circle's bounding square (D082). The
 * head is what an arrow is about, so that is the point it asks from.
 */
export function contextQuery(mark: DraftMark): string {
  if (mark.kind === "rectangle") {
    const { x, y, width, height } = mark.rect;
    return `x=${x}&y=${y}&width=${width}&height=${height}`;
  }
  if (mark.kind === "circle") {
    const { x, y, width, height } = circleBounds(mark.circle);
    return `x=${x}&y=${y}&width=${width}&height=${height}`;
  }
  if (mark.kind === "arrow") return `x=${mark.arrow.end.x}&y=${mark.arrow.end.y}`;
  return `x=${mark.tip.x}&y=${mark.tip.y}`;
}

/** Whether two drafts describe the same geometry. */
export function marksEqual(a: DraftMark | null, b: DraftMark | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.kind !== b.kind) return false;
  if (a.kind === "pin" && b.kind === "pin") return a.tip.x === b.tip.x && a.tip.y === b.tip.y;
  if (a.kind === "rectangle" && b.kind === "rectangle") {
    return (
      a.rect.x === b.rect.x &&
      a.rect.y === b.rect.y &&
      a.rect.width === b.rect.width &&
      a.rect.height === b.rect.height
    );
  }
  if (a.kind === "circle" && b.kind === "circle") {
    return (
      a.circle.x === b.circle.x && a.circle.y === b.circle.y && a.circle.size === b.circle.size
    );
  }
  if (a.kind === "arrow" && b.kind === "arrow") {
    return (
      a.arrow.start.x === b.arrow.start.x &&
      a.arrow.start.y === b.arrow.start.y &&
      a.arrow.end.x === b.arrow.end.x &&
      a.arrow.end.y === b.arrow.end.y
    );
  }
  return false;
}

export function isPinView(annotation: AnnotationView): annotation is PinAnnotationView {
  return annotation.kind === "pin";
}

export function isRectangleView(
  annotation: AnnotationView,
): annotation is RectangleAnnotationView {
  return annotation.kind === "rectangle";
}

export function isCircleView(annotation: AnnotationView): annotation is CircleAnnotationView {
  return annotation.kind === "circle";
}

export function isArrowView(annotation: AnnotationView): annotation is ArrowAnnotationView {
  return annotation.kind === "arrow";
}

/** Only the pins of a list, in the order given. */
export function pinsOf(annotations: readonly AnnotationView[]): PinAnnotationView[] {
  return annotations.filter(isPinView);
}

/** Only the rectangles of a list, in the order given. */
export function rectanglesOf(annotations: readonly AnnotationView[]): RectangleAnnotationView[] {
  return annotations.filter(isRectangleView);
}

/** Only the circles of a list, in the order given. */
export function circlesOf(annotations: readonly AnnotationView[]): CircleAnnotationView[] {
  return annotations.filter(isCircleView);
}

/** Only the arrows of a list, in the order given. */
export function arrowsOf(annotations: readonly AnnotationView[]): ArrowAnnotationView[] {
  return annotations.filter(isArrowView);
}

/** The kind's reader-facing word: "Pin", "Box", "Circle", or "Arrow". */
export function markKindLabel(kind: MarkKind): "Pin" | "Box" | "Circle" | "Arrow" {
  if (kind === "rectangle") return "Box";
  if (kind === "circle") return "Circle";
  if (kind === "arrow") return "Arrow";
  return "Pin";
}

/** The kind's reader-facing word in lower case, for sentences and buttons. */
export function markKindNoun(kind: MarkKind): "pin" | "box" | "circle" | "arrow" {
  if (kind === "rectangle") return "box";
  if (kind === "circle") return "circle";
  if (kind === "arrow") return "arrow";
  return "pin";
}

/** The kinds a mixed count names, in the order it names them. */
const COUNTED_KINDS: readonly { kind: MarkKind; one: string; many: string }[] = [
  { kind: "pin", one: "pin", many: "pins" },
  { kind: "rectangle", one: "box", many: "boxes" },
  { kind: "circle", one: "circle", many: "circles" },
  { kind: "arrow", one: "arrow", many: "arrows" },
];

/**
 * A reader-facing count of a mixed list of marks (D078/D079/D082/D083):
 * "3 pins" when they are all pins, "2 boxes" when all boxes, and
 * "2 pins · 1 box" when several kinds are present, in pin, box, circle,
 * arrow order. An empty list
 * reads "0 pins". Keeps summaries (the export headers, the copy toast)
 * honest once a capture holds more than pins, instead of calling every mark
 * a "pin".
 */
export function markCountLabel(marks: readonly Pick<AnnotationView, "kind">[]): string {
  const parts: string[] = [];
  for (const counted of COUNTED_KINDS) {
    const total = marks.filter((mark) => mark.kind === counted.kind).length;
    if (total === 0) continue;
    parts.push(`${total} ${total === 1 ? counted.one : counted.many}`);
  }
  return parts.length === 0 ? "0 pins" : parts.join(" · ");
}

/** "Pin 3", "Box 4", "Circle 5", "Arrow 6": what every name opens with. */
export function markTitle(annotation: Pick<AnnotationView, "kind" | "number">): string {
  return `${markKindLabel(annotation.kind)} ${annotation.number}`;
}

/** How much of the comment a mark's name quotes before it is cut. */
export const MARK_EXCERPT_MAX_CHARS = 60;

/** How much of the attached element's text a mark's name carries. */
export const MARK_ELEMENT_LABEL_MAX_CHARS = 40;

/** The fields of a snapshot a mark's name reads. */
export type MarkElementSource = Pick<PinElementSnapshot, "text" | "accessibleName" | "tag">;

/** The fields of an annotation a mark's name reads. */
export interface MarkLabelSource {
  kind: MarkKind;
  number: number;
  body: string;
  elementSnapshot: MarkElementSource | null;
}

/**
 * The attached element's short label (D078): its visible text, else its
 * accessible name, else its tag, collapsed to one line and cut with an
 * ellipsis. Null when nothing is attached or the snapshot has no words.
 */
export function elementShortLabel(element: MarkElementSource | null | undefined): string | null {
  if (!element) return null;
  const source = [element.text, element.accessibleName, element.tag].find(
    (candidate) => typeof candidate === "string" && candidate.trim() !== "",
  );
  if (!source) return null;
  const label = pinExcerpt(source, MARK_ELEMENT_LABEL_MAX_CHARS);
  return label === "" ? null : label;
}

/**
 * A mark's name (D078): what it says and what it points at, never where it
 * sits. "Pin 3 · “This toggle reads the same in both states” · Annual
 * (save 20%)" or "Box 2 · “More air around these” · pricing cards". The
 * kind and number come first so screen-reader order and number-based
 * queries stay stable; then the comment, cut to MARK_EXCERPT_MAX_CHARS
 * with an ellipsis; then, when an element is attached, its short label.
 * Coordinates never appear here; markPosition prints those, behind the
 * panel's Details.
 */
export function markLabel(mark: MarkLabelSource): string {
  const parts = [markTitle(mark)];
  const excerpt = pinExcerpt(mark.body ?? "", MARK_EXCERPT_MAX_CHARS);
  if (excerpt !== "") parts.push(`“${excerpt}”`);
  const element = elementShortLabel(mark.elementSnapshot);
  if (element) parts.push(element);
  return parts.join(" · ");
}

/**
 * The point a camera centers on to show a mark: a pin's tip, a box's middle,
 * or a circle's center.
 */
export function markCenter(mark: DraftMark): NaturalPoint {
  if (mark.kind === "rectangle") {
    return { x: mark.rect.x + mark.rect.width / 2, y: mark.rect.y + mark.rect.height / 2 };
  }
  if (mark.kind === "circle") return circleCenter(mark.circle);
  // An arrow centers on the middle of its shaft, so the whole mark comes
  // into view rather than only the end it points from.
  if (mark.kind === "arrow") return arrowMidpoint(mark.arrow);
  return { x: mark.tip.x, y: mark.tip.y };
}

/**
 * The box a reveal must fit on screen, or null for a mark with no area (a
 * pin), which only needs centering.
 */
export function markExtent(mark: DraftMark): NaturalRect | null {
  if (mark.kind === "rectangle") return mark.rect;
  if (mark.kind === "circle") return circleBounds(mark.circle);
  if (mark.kind === "arrow") return arrowBounds(mark.arrow);
  return null;
}

/** A rectangle's position and size, rounded for reading: "x, y · w × h". */
export function rectanglePosition(rect: NaturalRect): string {
  return `${Math.round(rect.x)}, ${Math.round(rect.y)} · ${Math.round(rect.width)} × ${Math.round(
    rect.height,
  )}`;
}

/** A circle's center and size, rounded for reading: "x, y · 80 wide". */
export function circlePosition(circle: NaturalCircle): string {
  const center = circleCenter(circle);
  return `${Math.round(center.x)}, ${Math.round(center.y)} · ${Math.round(circle.size)} wide`;
}

/** An arrow's two points, rounded for reading, tail first: "x, y → x, y". */
export function arrowPosition(arrow: NaturalArrow): string {
  const point = (value: { x: number; y: number }) =>
    `${Math.round(value.x)}, ${Math.round(value.y)}`;
  return `${point(arrow.start)} → ${point(arrow.end)}`;
}

/**
 * Natural-pixel position of a mark, rounded for reading: "x, y" for a pin
 * tip, "x, y · w × h" for a rectangle, the center and width for a circle,
 * and the tail and head for an arrow.
 */
export function markPosition(annotation: AnnotationView): string {
  if (annotation.kind === "rectangle") return rectanglePosition(annotation.rect);
  if (annotation.kind === "circle") return circlePosition(annotation.circle);
  if (annotation.kind === "arrow") return arrowPosition(annotation.arrow);
  return `${Math.round(annotation.tip.x)}, ${Math.round(annotation.tip.y)}`;
}
