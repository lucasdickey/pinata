// Client-safe helpers for the two mark kinds (D079): the draft shape the
// canvas reports to the workspace, the request shapes each kind sends, and
// the labels the panel, table, and export print. Since D078 the one name a
// mark goes by everywhere (markLabel) lives here too, so the wording cannot
// drift between surfaces. Pure functions only, so the exact text and
// payloads are unit-testable without a DOM.

import type {
  AnnotationView,
  PinAnnotationView,
  PinElementSnapshot,
  RectangleAnnotationView,
} from "../annotations";
import { pinExcerpt } from "../feedback-counts";
import type { NaturalPoint } from "./camera";
import type { NaturalRect } from "./rectangle";

/** A transient, unsaved mark: one pin tip or one rectangle, natural pixels. */
export type DraftMark =
  | { kind: "pin"; tip: NaturalPoint }
  | { kind: "rectangle"; rect: NaturalRect };

export type MarkKind = DraftMark["kind"];

/** The persisted geometry of one annotation, in the draft's shape. */
export function markOf(annotation: AnnotationView): DraftMark {
  return annotation.kind === "rectangle"
    ? { kind: "rectangle", rect: { ...annotation.rect } }
    : { kind: "pin", tip: { ...annotation.tip } };
}

/** The same annotation with new geometry (an optimistic local move). */
export function withMark(annotation: AnnotationView, mark: DraftMark): AnnotationView {
  if (annotation.kind === "rectangle" && mark.kind === "rectangle") {
    return { ...annotation, rect: { ...mark.rect } };
  }
  if (annotation.kind === "pin" && mark.kind === "pin") {
    return { ...annotation, tip: { ...mark.tip } };
  }
  return annotation;
}

/** The geometry fields a create or PATCH body carries for one mark. */
export function markPayload(mark: DraftMark): { tip: NaturalPoint } | { rect: NaturalRect } {
  return mark.kind === "rectangle" ? { rect: { ...mark.rect } } : { tip: { ...mark.tip } };
}

/**
 * The context route's query for one mark: `x=&y=` around a pin tip, or
 * `x=&y=&width=&height=` for the overlap ranking of a rectangle.
 */
export function contextQuery(mark: DraftMark): string {
  if (mark.kind === "rectangle") {
    const { x, y, width, height } = mark.rect;
    return `x=${x}&y=${y}&width=${width}&height=${height}`;
  }
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

/** Only the pins of a list, in the order given. */
export function pinsOf(annotations: readonly AnnotationView[]): PinAnnotationView[] {
  return annotations.filter(isPinView);
}

/** Only the rectangles of a list, in the order given. */
export function rectanglesOf(annotations: readonly AnnotationView[]): RectangleAnnotationView[] {
  return annotations.filter(isRectangleView);
}

/** The kind's reader-facing word: "Pin" or "Box". */
export function markKindLabel(kind: MarkKind): "Pin" | "Box" {
  return kind === "rectangle" ? "Box" : "Pin";
}

/** The kind's reader-facing word in lower case, for sentences and buttons. */
export function markKindNoun(kind: MarkKind): "pin" | "box" {
  return kind === "rectangle" ? "box" : "pin";
}

/** "Pin 3" or "Box 4": the kind and number that open every mark's name. */
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

/** The point a camera centers on to show a mark: a pin's tip, a box's middle. */
export function markCenter(mark: DraftMark): NaturalPoint {
  if (mark.kind === "rectangle") {
    return { x: mark.rect.x + mark.rect.width / 2, y: mark.rect.y + mark.rect.height / 2 };
  }
  return { x: mark.tip.x, y: mark.tip.y };
}

/** A rectangle's position and size, rounded for reading: "x, y · w × h". */
export function rectanglePosition(rect: NaturalRect): string {
  return `${Math.round(rect.x)}, ${Math.round(rect.y)} · ${Math.round(rect.width)} × ${Math.round(
    rect.height,
  )}`;
}

/**
 * Natural-pixel position of a mark, rounded for reading: "x, y" for a pin
 * tip, "x, y · w × h" for a rectangle.
 */
export function markPosition(annotation: AnnotationView): string {
  if (annotation.kind === "rectangle") return rectanglePosition(annotation.rect);
  return `${Math.round(annotation.tip.x)}, ${Math.round(annotation.tip.y)}`;
}
