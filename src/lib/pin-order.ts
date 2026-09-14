// The project-wide order of pins and the stepping through them (D077), kept
// pure so the order the Next and Previous controls (and J/K) follow is
// unit-testable without a DOM.
//
// Pins are numbered per capture, so "the next pin" across a project needs a
// second key: the plane. Planes are ordered the way the workspace lists
// them — pages in submitted order, Desktop before Mobile, then older
// attempts before newer ones — and pins inside a plane by their number.
// Stepping runs through that one sequence, switching plane whenever the
// neighbouring pin lives on another capture, and wraps only at the ends of
// the project.

import type { ProjectPinAnnotationView } from "./annotations";

/** The slice of a workspace project the ordering needs. */
export interface PlaneSource {
  pages: ReadonlyArray<{
    id: string;
    devices: ReadonlyArray<{
      variant: string;
      attempts: ReadonlyArray<{ id: string; attempt: number }>;
      usable: boolean;
    }>;
  }>;
}

/** Every capture id in the project, in the order the workspace visits them. */
export function planeOrder(project: PlaneSource): string[] {
  const ids: string[] = [];
  for (const page of project.pages) {
    for (const device of page.devices) {
      const attempts = [...device.attempts].sort((a, b) => a.attempt - b.attempt);
      for (const attempt of attempts) ids.push(attempt.id);
    }
  }
  return ids;
}

/** The project's pins in page, device, version, number order. */
export function orderProjectPins<T extends Pick<ProjectPinAnnotationView, "captureId" | "number">>(
  pins: readonly T[],
  planes: readonly string[],
): T[] {
  const rank = new Map(planes.map((id, index) => [id, index] as const));
  const planeRank = (pin: T) => rank.get(pin.captureId) ?? Number.MAX_SAFE_INTEGER;
  return [...pins].sort((a, b) => planeRank(a) - planeRank(b) || a.number - b.number);
}

export interface StepPosition {
  /** The capture currently shown, or null when no plane is open. */
  captureId: string | null;
  /** The selected pin, or null when nothing is selected. */
  pinId: string | null;
}

/**
 * The pin a step lands on, or null when the project has none. From a
 * selected pin the step is its neighbour in project order, wrapping at the
 * ends. With nothing selected, Next starts at the first pin of the open
 * plane (or the first pin on a later plane, or the project's first), and
 * Previous mirrors that from the end.
 */
export function stepProjectPin<T extends Pick<ProjectPinAnnotationView, "id" | "captureId">>(
  ordered: readonly T[],
  planes: readonly string[],
  position: StepPosition,
  direction: 1 | -1,
): T | null {
  if (ordered.length === 0) return null;
  const current = position.pinId ? ordered.findIndex((pin) => pin.id === position.pinId) : -1;
  if (current !== -1) {
    return ordered[(current + direction + ordered.length) % ordered.length]!;
  }
  const rank = new Map(planes.map((id, index) => [id, index] as const));
  const here = position.captureId ? (rank.get(position.captureId) ?? -1) : -1;
  const planeOf = (pin: T) => rank.get(pin.captureId) ?? Number.MAX_SAFE_INTEGER;
  if (direction === 1) {
    return ordered.find((pin) => planeOf(pin) >= here) ?? ordered[0]!;
  }
  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    if (planeOf(ordered[index]!) <= here) return ordered[index]!;
  }
  return ordered[ordered.length - 1]!;
}

/** The device a page opens on: Desktop, or Mobile when Desktop is not usable. */
export function preferredVariant(page: PlaneSource["pages"][number]): string | null {
  const usable = page.devices.find((device) => device.usable);
  return (usable ?? page.devices[0])?.variant ?? null;
}
