"use client";

// The project → page → device navigation and capture-status panel
// (VAL-PROJECT-003, VAL-PROJECT-005).
//
// Every page shown here was explicitly submitted and is listed only under the
// project that owns it, in submitted order. Each page exposes exactly Desktop
// and Mobile, exactly one of which is active at a time, and the panel shows
// the selected version of that one capture. A failing device never removes a
// sibling that succeeded: the sibling stays listed, usable, and in order.
//
// The screenshot stage is deliberately inert — it renders a static capture,
// never live source markup, so there is no link, iframe, or handler here that
// could navigate to the captured site.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CAPTURE_OUTCOMES } from "../lib/boundaries";
import { EDITOR_CSRF_HEADER } from "../lib/auth-constants";
import { readCsrfProof } from "../lib/csrf";
import type {
  FeedbackCounts,
  PinAnnotationView,
  PinContextResponse,
  PinElementSnapshot,
  PinListResponse,
  PinMutationResponse,
  PinStatusResponse,
} from "../lib/annotations";
import type { NaturalPoint } from "../lib/canvas/camera";
import {
  captureFeedback,
  feedbackBadge,
  feedbackSummary,
  pinFeedbackPath,
  projectFeedback,
  type SeenAdjustments,
} from "../lib/feedback-counts";
import type { ThreadAppendResponse, ThreadEntryView, ThreadListResponse } from "../lib/threads";
import { CaptureCanvas, type CaptureCameraState } from "./capture-canvas";
import { CaptureProgress, type ProjectProgress } from "./capture-progress";
import type { ContextRect } from "../lib/canvas/flow-model";
import { CapturePanel, STATE_LABELS, variantLabel } from "./capture-panel";
import { FounderShareControl } from "./founder-share";
import type { DraftCandidates } from "./pin-composer";
import { PinTable } from "./pin-table";
import type { ReplySendState, ThreadStatus } from "./thread-view";

export interface AttemptView {
  id: string;
  variant: string;
  attempt: number;
  state: "pending" | "capturing" | "stale" | "ready" | "failed";
  errorCode: string | null;
  imageHash: string | null;
  /** Natural screenshot dimensions; null until the capture is ready. */
  documentWidth: number | null;
  documentHeight: number | null;
}

export interface DeviceView {
  variant: string;
  attempts: AttemptView[];
  latest: AttemptView | null;
  selectedCaptureId: string | null;
  selectedAttempt: number | null;
  usable: boolean;
  retryable: boolean;
}

export interface WorkspacePage {
  id: string;
  normalizedUrl: string;
  sortIndex: number;
  devices: DeviceView[];
}

export interface WorkspaceProject {
  projectId: string;
  publicId: string;
  title: string;
  rootUrl: string;
  pages: WorkspacePage[];
  counts: { pages: number; attempts: number; ready: number; failed: number; inProgress: number };
  /** Server-computed capture progress (D076); absent on older payloads. */
  progress?: ProjectProgress;
  /**
   * Feedback counts for the requesting role (D075): the project total and
   * per capture attempt for captures with live pins. Optional so a hierarchy
   * read from an older server still renders, with no badges.
   */
  feedback?: FeedbackCounts;
  captureFeedback?: Record<string, FeedbackCounts>;
}

interface Selection {
  pageId: string;
  variant: string;
  /** Explicitly chosen version, or null to follow the server default. */
  captureId: string | null;
}

const outcomeMessages = new Map(
  CAPTURE_OUTCOMES.map((outcome) => [outcome.code, outcome.publicMessage] as const),
);

/** What the device row shows: the usable capture wins over a later failure. */
function deviceStatus(device: DeviceView): string {
  if (device.usable && device.latest?.state !== "ready") {
    return `Ready (v${device.selectedAttempt}) · newest ${STATE_LABELS[
      device.latest?.state ?? "pending"
    ].toLowerCase()}`;
  }
  return device.latest ? STATE_LABELS[device.latest.state] : "Not captured";
}

function findDevice(project: WorkspaceProject | undefined, selection: Selection | null) {
  if (!project || !selection) return null;
  const page = project.pages.find((candidate) => candidate.id === selection.pageId);
  if (!page) return null;
  const device = page.devices.find((candidate) => candidate.variant === selection.variant);
  if (!device) return null;
  return { page, device };
}

export function ProjectWorkspace({
  projects,
  onChanged,
}: {
  projects: WorkspaceProject[];
  onChanged: () => void;
}) {
  const [selection, setSelection] = useState<Selection | null>(null);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  // Rail disclosure state (D070), session-only and deliberately unpersisted:
  // it is a view preference, not project data, and storing it would mean
  // reasoning about a stale rail after the project list changes underneath.
  // `openProjects` holds only projects the reader has explicitly toggled;
  // anything absent falls back to "open when it holds the selection".
  const [railOpen, setRailOpen] = useState(true);
  const [openProjects, setOpenProjects] = useState<Record<string, boolean>>({});
  // Per-capture session camera memory: each plane restores its own camera
  // when revisited, and no camera is ever shared between planes or written
  // anywhere. Reload clears it (in-memory only).
  const cameras = useRef(new Map<string, CaptureCameraState>());
  // The active plane's transient draft tip, mirrored here so the save can
  // carry it and the composer state below can follow it. The canvas remains
  // the source of truth and clears it on switch via the keyed remount.
  const [draftTip, setDraftTip] = useState<NaturalPoint | null>(null);
  // One idempotency key per draft intent: generated when the draft appears,
  // held across safe retries of the same save, and released when the draft
  // resolves (saved, cancelled, or escaped).
  const [draftKey, setDraftKey] = useState<string | null>(null);
  const [draftBody, setDraftBody] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "failed">("idle");
  // The draft's explicit context decision: undefined = not settled yet (Save
  // is disabled), null = "No element", otherwise a candidate's capture-local
  // element id. Candidates come from the capture's own persisted manifest
  // via the authorized context route, resolved once per settled draft
  // position (placement click, the N shortcut, or draft-drag end) — never
  // per drag frame — and the top-ranked one is pre-selected when they
  // arrive (D074).
  const [draftChoice, setDraftChoice] = useState<string | null | undefined>(undefined);
  const [draftCandidates, setDraftCandidates] = useState<
    (DraftCandidates & { captureId: string }) | null
  >(null);
  // The transient candidate highlight: exactly the hovered/focused/touched
  // candidate's manifest rectangle in natural pixels, rendered on the canvas
  // as a pointer-transparent box. Pure local UI state — it never writes,
  // never re-queries, and clears on replacement, blur, choice, Cancel,
  // Escape, capture switch, and save (all of which flow through the draft
  // lifecycle effects below).
  const [previewRect, setPreviewRect] = useState<ContextRect | null>(null);
  // Saved-pin edit/delete lifecycle. Edit keeps its text across failures; a
  // conflict means another session wrote first and the authoritative list
  // is reloaded instead of overwriting.
  const [editing, setEditing] = useState(false);
  const [editBody, setEditBody] = useState("");
  const [editState, setEditState] = useState<"idle" | "saving" | "failed" | "conflict">("idle");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteState, setDeleteState] = useState<"idle" | "deleting" | "failed" | "conflict">(
    "idle",
  );
  // Incremented to make the canvas drop its unsaved draft (after a save or
  // a Cancel); the canvas reports the cleared draft back through
  // onDraftChange.
  const [draftResetSignal, setDraftResetSignal] = useState(0);
  // This plane's persisted pins, loaded per selection and scoped strictly to
  // the capture id they were fetched for — another plane's pins can never
  // render here.
  const [pinsState, setPinsState] = useState<{
    captureId: string;
    status: "loading" | "ready" | "failed";
    pins: PinAnnotationView[];
  } | null>(null);
  const [selectedPinId, setSelectedPinId] = useState<string | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  // The selected pin's append-only thread (REQUIREMENTS 6): loaded per
  // selection and scoped to the pin it was fetched for, with one follow-up
  // composer whose idempotency key lives exactly as long as the draft text.
  const [threadState, setThreadState] = useState<{
    annotationId: string;
    status: ThreadStatus;
    entries: ThreadEntryView[];
  } | null>(null);
  const [replyBody, setReplyBody] = useState("");
  const [replyKey, setReplyKey] = useState<string | null>(null);
  const [replyState, setReplyState] = useState<ReplySendState>("idle");
  // Feedback loop (D075). Opening a thread marks the pin seen on the server
  // and lowers the local unread counts by that pin's unread replies until
  // the next hierarchy read (which resets these adjustments) confirms them.
  const [seenAdjust, setSeenAdjust] = useState<SeenAdjustments>({});
  const [statusState, setStatusState] = useState<"idle" | "saving" | "failed">("idle");
  const pinsStateRef = useRef(pinsState);
  pinsStateRef.current = pinsState;
  useEffect(() => {
    setSeenAdjust({});
  }, [projects]);
  // One idempotency key per retry intent: it is refreshed only after the
  // server has accepted or conflicted, so a double click cannot schedule two.
  const retryKeys = useRef(new Map<string, string>());

  const fallback = useMemo<Selection | null>(() => {
    const page = projects[0]?.pages[0];
    const variant = page?.devices[0]?.variant;
    return page && variant ? { pageId: page.id, variant, captureId: null } : null;
  }, [projects]);

  const active = useMemo(() => {
    const chosen = selection ?? fallback;
    const owner = projects.find((project) =>
      project.pages.some((page) => page.id === chosen?.pageId),
    );
    const found = findDevice(owner, chosen);
    return found && chosen ? { ...found, project: owner!, selection: chosen } : null;
  }, [projects, selection, fallback]);

  const retry = useCallback(
    async (pageId: string, variant: string) => {
      if (retrying) return;
      const target = `${pageId}:${variant}`;
      const key = retryKeys.current.get(target) ?? crypto.randomUUID();
      retryKeys.current.set(target, key);
      setRetrying(true);
      setRetryError(null);
      try {
        const response = await fetch(`/api/pages/${encodeURIComponent(pageId)}/captures`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            [EDITOR_CSRF_HEADER]: readCsrfProof(),
          },
          body: JSON.stringify({ variant, idempotencyKey: key }),
        });
        if (response.ok || response.status === 409) retryKeys.current.delete(target);
        if (!response.ok) {
          setRetryError("That capture could not be retried. Reload and try again.");
          return;
        }
        // The attempt is committed; re-read the hierarchy rather than
        // patching local state.
        setSelection((current) => (current ? { ...current, captureId: null } : current));
        onChanged();
      } catch {
        setRetryError("That capture could not be retried. Reload and try again.");
      } finally {
        setRetrying(false);
      }
    },
    [onChanged, retrying],
  );

  if (projects.length === 0) return null;

  // The shown attempt is the explicit selection or the server default; when
  // a device has no ready capture at all, its latest attempt still names the
  // unavailable state (failed/stale/queued) rather than a bare "not
  // captured".
  const selectedAttempt =
    (active?.device.attempts.find(
      (attempt) => attempt.id === (active.selection.captureId ?? active.device.selectedCaptureId),
    ) ??
      active?.device.latest) ||
    null;

  // A draft belongs to exactly one plane: switching page, device, or version
  // drops the panel's mirror (the canvas drops its own on remount), along
  // with the pin selection and any move error.
  const selectedCaptureId = selectedAttempt?.id ?? null;
  const selectedReady =
    selectedAttempt?.state === "ready" &&
    selectedAttempt.documentWidth !== null &&
    selectedAttempt.documentHeight !== null
      ? selectedAttempt
      : null;

  // The id of the load the panel is allowed to show. A plane switch starts
  // a new fetch while the old plane's may still be in flight; without this
  // guard a late answer from the old plane would overwrite the new plane's
  // state and leave the panel mismatched (blank) for the current capture.
  const pinsRequestRef = useRef<string | null>(null);
  const loadPins = useCallback(async (captureId: string) => {
    pinsRequestRef.current = captureId;
    setPinsState({ captureId, status: "loading", pins: [] });
    try {
      const response = await fetch(
        `/api/captures/${encodeURIComponent(captureId)}/annotations`,
        { cache: "no-store" },
      );
      if (pinsRequestRef.current !== captureId) return;
      if (!response.ok) {
        setPinsState({ captureId, status: "failed", pins: [] });
        return;
      }
      const payload = (await response.json()) as PinListResponse;
      if (pinsRequestRef.current !== captureId) return;
      setPinsState({
        captureId,
        status: "ready",
        pins: Array.isArray(payload.annotations) ? payload.annotations : [],
      });
    } catch {
      if (pinsRequestRef.current !== captureId) return;
      setPinsState({ captureId, status: "failed", pins: [] });
    }
  }, []);

  useEffect(() => {
    setDraftTip(null);
    setSelectedPinId(null);
    setMoveError(null);
    setSaveState("idle");
    setPreviewRect(null);
    if (selectedReady) {
      void loadPins(selectedReady.id);
    } else {
      pinsRequestRef.current = null;
      setPinsState(null);
    }
  }, [selectedCaptureId, selectedReady, loadPins]);

  // The draft's intent — idempotency key, context decision, candidates —
  // lives exactly as long as the draft. A null→tip transition is a brand
  // new draft: fresh key, undecided context. A drag only moves the tip, so
  // the key and decision survive it; a retried save replays the same intent
  // and a double submit can never create two pins. Resolving the draft
  // (saved, cancelled, escaped, or a plane switch) releases everything.
  const hadDraft = useRef(false);
  useEffect(() => {
    const isNew = draftTip !== null && !hadDraft.current;
    hadDraft.current = draftTip !== null;
    if (isNew) {
      setDraftKey(crypto.randomUUID());
      setDraftChoice(undefined);
      setDraftCandidates(null);
      setPreviewRect(null);
    } else if (!draftTip) {
      setDraftKey(null);
      setDraftBody("");
      setSaveState("idle");
      setDraftChoice(undefined);
      setDraftCandidates(null);
      setPreviewRect(null);
    }
  }, [draftTip]);

  // A selection change closes any edit/delete in flight: the panel's
  // editable state always belongs to one specific pin record.
  useEffect(() => {
    setEditing(false);
    setEditState("idle");
    setConfirmingDelete(false);
    setDeleteState("idle");
  }, [selectedPinId, selectedCaptureId]);

  // Reading a thread marks the pin seen for the editor (D075). On success
  // the pin's own unread count drops to zero locally and the capture's
  // count is lowered by the same amount; a failure changes nothing and the
  // next hierarchy read tells the truth.
  const markThreadSeen = useCallback(async (captureId: string, annotationId: string) => {
    const pin = pinsStateRef.current?.pins.find((candidate) => candidate.id === annotationId);
    const unread =
      pinsStateRef.current?.captureId === captureId ? (pin?.unreadReplies ?? 0) : 0;
    try {
      const response = await fetch(pinFeedbackPath(captureId, annotationId, "seen"), {
        method: "POST",
        headers: { [EDITOR_CSRF_HEADER]: readCsrfProof() },
      });
      if (!response.ok || unread === 0) return;
      setPinsState((current) =>
        current && current.captureId === captureId
          ? {
              ...current,
              pins: current.pins.map((candidate) =>
                candidate.id === annotationId ? { ...candidate, unreadReplies: 0 } : candidate,
              ),
            }
          : current,
      );
      setSeenAdjust((current) => ({
        ...current,
        [captureId]: (current[captureId] ?? 0) + unread,
      }));
    } catch {
      // Marking seen is best effort; the counts stay as the server last said.
    }
  }, []);

  // The thread follows the selected pin: a fresh read per selection, scoped
  // to that pin so a late answer for a previous selection can never render
  // under the current one, and the follow-up draft resets with it.
  const threadRequestRef = useRef<string | null>(null);
  const loadThread = useCallback(
    async (captureId: string, annotationId: string) => {
      threadRequestRef.current = annotationId;
      setThreadState({ annotationId, status: "loading", entries: [] });
      try {
        const response = await fetch(
          `/api/captures/${encodeURIComponent(captureId)}/annotations/${encodeURIComponent(annotationId)}/thread`,
          { cache: "no-store" },
        );
        if (threadRequestRef.current !== annotationId) return;
        if (!response.ok) {
          setThreadState({ annotationId, status: "failed", entries: [] });
          return;
        }
        const payload = (await response.json()) as ThreadListResponse;
        if (threadRequestRef.current !== annotationId) return;
        setThreadState({
          annotationId,
          status: "ready",
          entries: Array.isArray(payload.entries) ? payload.entries : [],
        });
        void markThreadSeen(captureId, annotationId);
      } catch {
        if (threadRequestRef.current !== annotationId) return;
        setThreadState({ annotationId, status: "failed", entries: [] });
      }
    },
    [markThreadSeen],
  );

  useEffect(() => {
    setReplyBody("");
    setReplyKey(null);
    setReplyState("idle");
    if (selectedPinId && selectedCaptureId) {
      void loadThread(selectedCaptureId, selectedPinId);
    } else {
      threadRequestRef.current = null;
      setThreadState(null);
    }
  }, [selectedPinId, selectedCaptureId, loadThread]);

  const sendFollowUp = useCallback(async () => {
    const captureId = selectedReady?.id;
    if (!captureId || !selectedPinId || replyState === "sending") return;
    if (replyBody.trim().length === 0) return;
    // One key per drafted follow-up: a retry of the same text replays the
    // same intent instead of appending twice.
    const key = replyKey ?? crypto.randomUUID();
    setReplyKey(key);
    setReplyState("sending");
    try {
      const response = await fetch(
        `/api/captures/${encodeURIComponent(captureId)}/annotations/${encodeURIComponent(selectedPinId)}/thread`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            [EDITOR_CSRF_HEADER]: readCsrfProof(),
          },
          body: JSON.stringify({ body: replyBody, idempotencyKey: key }),
        },
      );
      if (!response.ok) {
        setReplyState(response.status === 429 ? "throttled" : "failed");
        return;
      }
      const payload = (await response.json()) as ThreadAppendResponse;
      setThreadState((current) =>
        current && current.annotationId === selectedPinId
          ? {
              ...current,
              status: "ready",
              entries: current.entries.some((entry) => entry.id === payload.entry.id)
                ? current.entries
                : [...current.entries, payload.entry],
            }
          : current,
      );
      setReplyBody("");
      setReplyKey(null);
      setReplyState("idle");
    } catch {
      setReplyState("failed");
    }
  }, [selectedReady, selectedPinId, replyState, replyBody, replyKey]);

  // Resolve or reopen the selected pin (D075): one POST, then the returned
  // record replaces the listed pin, the status entry joins the thread, and
  // the hierarchy is re-read so the rail's open counts follow.
  const setPinStatus = useCallback(
    async (action: "resolve" | "reopen") => {
      const captureId = selectedReady?.id;
      if (!captureId || !selectedPinId || statusState === "saving") return;
      setStatusState("saving");
      try {
        const response = await fetch(pinFeedbackPath(captureId, selectedPinId, action), {
          method: "POST",
          headers: { [EDITOR_CSRF_HEADER]: readCsrfProof() },
        });
        if (!response.ok) {
          setStatusState("failed");
          return;
        }
        const payload = (await response.json()) as PinStatusResponse;
        setPinsState((current) =>
          current && current.captureId === captureId
            ? {
                ...current,
                pins: current.pins.map((pin) =>
                  pin.id === payload.annotation.id ? payload.annotation : pin,
                ),
              }
            : current,
        );
        const entry = payload.entry;
        if (entry) {
          setThreadState((current) =>
            current && current.annotationId === selectedPinId
              ? {
                  ...current,
                  entries: current.entries.some((existing) => existing.id === entry.id)
                    ? current.entries
                    : [...current.entries, entry],
                }
              : current,
          );
        }
        setStatusState("idle");
        onChanged();
      } catch {
        setStatusState("failed");
      }
    },
    [selectedReady, selectedPinId, statusState, onChanged],
  );

  // Nearby context for the draft, fetched once per settled position. The
  // response is scoped to the capture it was fetched for; a stale response
  // (plane switch mid-flight, or an earlier settle answered late) can never
  // land on another capture's draft or overwrite a newer candidate set.
  // When it settles, the top-ranked candidate is pre-selected — or No
  // element when there is none or the read failed — unless Lucas already
  // chose while it was loading (D074). The decision stays explicit on the
  // wire: the chosen id or null is still what the save sends (D061).
  const contextRequestRef = useRef(0);
  const fetchContext = useCallback(async (captureId: string, tip: NaturalPoint) => {
    const request = contextRequestRef.current + 1;
    contextRequestRef.current = request;
    // A fresh candidate set replaces the old one; any highlight or choice
    // belonging to the replaced set clears with it.
    setPreviewRect(null);
    setDraftChoice(undefined);
    setDraftCandidates({ captureId, status: "loading", items: [] });
    const settle = (candidates: DraftCandidates) => {
      if (contextRequestRef.current !== request) return;
      setDraftCandidates({ captureId, ...candidates });
      const top = candidates.items[0]?.id ?? null;
      setDraftChoice((current) => (current === undefined ? top : current));
    };
    try {
      const response = await fetch(
        `/api/captures/${encodeURIComponent(captureId)}/context?x=${tip.x}&y=${tip.y}`,
        { cache: "no-store" },
      );
      if (!response.ok) {
        settle({ status: "failed", items: [] });
        return;
      }
      const payload = (await response.json()) as PinContextResponse;
      settle({
        status: "ready",
        items: Array.isArray(payload.candidates) ? payload.candidates : [],
      });
    } catch {
      settle({ status: "failed", items: [] });
    }
  }, []);

  // The pins the canvas may render: only the ones fetched for the capture
  // that is actually selected, never a stale or sibling plane's.
  const activePins =
    pinsState && pinsState.captureId === selectedCaptureId && pinsState.status === "ready"
      ? pinsState.pins
      : [];

  // Stable canvas callbacks: the canvas's resize-follow effect keys off
  // these identities, so inline arrows would re-create its observer on
  // every unrelated workspace re-render (a pins load, say) and re-apply
  // the camera over a restored plane.
  const selectedReadyId = selectedReady?.id ?? null;
  const handleCameraChange = useCallback(
    (state: CaptureCameraState) => {
      if (selectedReadyId) cameras.current.set(selectedReadyId, state);
    },
    [selectedReadyId],
  );

  // The draft's context query fires when the draft settles (placement tap
  // or draft-drag end), keyed to the capture the draft belongs to.
  const handleDraftSettled = useCallback(
    (tip: NaturalPoint) => {
      if (selectedReadyId) void fetchContext(selectedReadyId, tip);
    },
    [selectedReadyId, fetchContext],
  );

  // The candidate highlight previews exactly one manifest rectangle — the
  // one under the pointer, focus, or a held finger. Choosing a candidate (or
  // No element) ends the preview; the highlight itself never writes anything.
  const handlePreviewCandidate = useCallback((candidate: PinElementSnapshot | null) => {
    setPreviewRect(candidate ? { ...candidate.rect } : null);
  }, []);
  const handleDraftChoiceChange = useCallback((choice: string | null) => {
    setDraftChoice(choice);
    setPreviewRect(null);
  }, []);

  const saveDraft = useCallback(async () => {
    // The explicit context decision is part of the save contract: an
    // undecided draft cannot submit at all.
    if (
      !draftTip ||
      !selectedReady ||
      !draftKey ||
      draftChoice === undefined ||
      saveState === "saving"
    ) {
      return;
    }
    setSaveState("saving");
    setMoveError(null);
    try {
      const response = await fetch(
        `/api/captures/${encodeURIComponent(selectedReady.id)}/annotations`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            [EDITOR_CSRF_HEADER]: readCsrfProof(),
          },
          body: JSON.stringify({
            tip: draftTip,
            body: draftBody,
            elementId: draftChoice,
            idempotencyKey: draftKey,
          }),
        },
      );
      if (!response.ok) {
        // Recoverable: the draft, its comment, its decision, and its key
        // survive so a retry replays the same intent instead of
        // duplicating it. Nothing persisted.
        setSaveState("failed");
        return;
      }
      // Saved: the canvas drops the draft (reporting null back), and the
      // authoritative list is re-read rather than patched locally.
      setDraftResetSignal((value) => value + 1);
      await loadPins(selectedReady.id);
    } catch {
      setSaveState("failed");
    }
  }, [draftTip, selectedReady, draftKey, draftBody, draftChoice, saveState, loadPins]);

  const cancelDraft = useCallback(() => {
    // Same mechanism as a successful save: the canvas drops the draft and
    // reports null, which releases the body and key. No write ever leaves.
    setDraftResetSignal((value) => value + 1);
  }, []);

  const movePin = useCallback(
    async (annotationId: string, tip: NaturalPoint) => {
      const captureId = selectedReady?.id;
      if (!captureId) return;
      // The revision precondition comes from the record the drag started
      // from; without it there is no safe write to make.
      const pin = pinsState?.pins.find((candidate) => candidate.id === annotationId);
      if (!pin) return;
      // Optimistic local update: the pin stays where it was dropped while
      // the one revisioned write commits. A failure re-reads the
      // authoritative list, so a rejected move snaps back — never a false
      // success and never a ghost.
      setPinsState((current) =>
        current && current.captureId === captureId
          ? {
              ...current,
              pins: current.pins.map((pin) => (pin.id === annotationId ? { ...pin, tip } : pin)),
            }
          : current,
      );
      setMoveError(null);
      try {
        const response = await fetch(
          `/api/captures/${encodeURIComponent(captureId)}/annotations/${encodeURIComponent(annotationId)}`,
          {
            method: "PATCH",
            headers: {
              "content-type": "application/json",
              [EDITOR_CSRF_HEADER]: readCsrfProof(),
            },
            body: JSON.stringify({ tip, expectedRevision: pin.revision }),
          },
        );
        if (!response.ok) {
          // A 409 means another session wrote first: the authoritative
          // reload shows the winning revision instead of overwriting it.
          // The move's message supersedes any stale edit/delete conflict
          // notice — one conflict message at a time.
          setMoveError(
            response.status === 409
              ? "This pin changed in another session. The latest version is now shown."
              : "That pin move could not be saved. The saved position was restored.",
          );
          setEditState("idle");
          setDeleteState("idle");
          await loadPins(captureId);
          return;
        }
        const payload = (await response.json()) as PinMutationResponse;
        setPinsState((current) =>
          current && current.captureId === captureId
            ? {
                ...current,
                pins: current.pins.map((pin) =>
                  pin.id === annotationId ? payload.annotation : pin,
                ),
              }
            : current,
        );
      } catch {
        setMoveError("That pin move could not be saved. The saved position was restored.");
        setEditState("idle");
        setDeleteState("idle");
        await loadPins(captureId);
      }
    },
    [selectedReady, pinsState, loadPins],
  );

  const saveEdit = useCallback(async () => {
    const captureId = selectedReady?.id;
    const pin = pinsState?.pins.find((candidate) => candidate.id === selectedPinId);
    if (!captureId || !pin || editState === "saving") return;
    setEditState("saving");
    try {
      const response = await fetch(
        `/api/captures/${encodeURIComponent(captureId)}/annotations/${encodeURIComponent(pin.id)}`,
        {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            [EDITOR_CSRF_HEADER]: readCsrfProof(),
          },
          body: JSON.stringify({ body: editBody, expectedRevision: pin.revision }),
        },
      );
      if (!response.ok) {
        if (response.status === 409) {
          // Stale authority: drop the edit and show what actually won.
          setEditState("conflict");
          setEditing(false);
          await loadPins(captureId);
          return;
        }
        // Recoverable: the edited text stays in the editor.
        setEditState("failed");
        return;
      }
      const payload = (await response.json()) as PinMutationResponse;
      setPinsState((current) =>
        current && current.captureId === captureId
          ? {
              ...current,
              pins: current.pins.map((candidate) =>
                candidate.id === pin.id ? payload.annotation : candidate,
              ),
            }
          : current,
      );
      setEditing(false);
      setEditState("idle");
    } catch {
      setEditState("failed");
    }
  }, [selectedReady, pinsState, selectedPinId, editBody, editState, loadPins]);

  const confirmDelete = useCallback(async () => {
    const captureId = selectedReady?.id;
    const pin = pinsState?.pins.find((candidate) => candidate.id === selectedPinId);
    if (!captureId || !pin || deleteState === "deleting") return;
    setDeleteState("deleting");
    try {
      const response = await fetch(
        `/api/captures/${encodeURIComponent(captureId)}/annotations/${encodeURIComponent(pin.id)}`,
        {
          method: "DELETE",
          headers: {
            "content-type": "application/json",
            [EDITOR_CSRF_HEADER]: readCsrfProof(),
          },
          body: JSON.stringify({ expectedRevision: pin.revision }),
        },
      );
      if (!response.ok) {
        if (response.status === 409) {
          setDeleteState("conflict");
          setConfirmingDelete(false);
          await loadPins(captureId);
          return;
        }
        setDeleteState("failed");
        return;
      }
      // Tombstoned authoritatively: re-read the list so the panel, the
      // list, and the canvas all agree, and clear the selection.
      setConfirmingDelete(false);
      setDeleteState("idle");
      setSelectedPinId(null);
      await loadPins(captureId);
    } catch {
      setDeleteState("failed");
    }
  }, [selectedReady, pinsState, selectedPinId, deleteState, loadPins]);

  return (
    <div className="workspace">
      <nav className="workspace-tree" aria-label="Projects, pages, and devices">
        {/* Two levels of disclosure (D070). The rail used to print every
            project's whole page/device tree at once, so a handful of
            projects pushed the canvas off screen. Native <details> is used
            rather than a hand-rolled toggle: it is keyboard-operable and
            correctly announced with no script and no dependency, and it
            keeps working if hydration has not happened yet. */}
        <details
          className="tree-root"
          open={railOpen}
          onToggle={(event) => setRailOpen(event.currentTarget.open)}
        >
          <summary>
            <span className="tree-summary-label">Projects</span>
            <span className="tree-count">{projects.length}</span>
          </summary>
          <ul>
            {projects.map((project) => {
              // The project holding the current selection stays open; the
              // rest start collapsed. Collapsing the active project would
              // hide the control that produced what the canvas is showing.
              const holdsActive = active?.project.projectId === project.projectId;
              const expanded = openProjects[project.projectId] ?? holdsActive;
              return (
                <li key={project.projectId}>
                  <details
                    className="tree-project"
                    open={expanded}
                    onToggle={(event) => {
                      // Read the element before the updater runs: React has
                      // detached the synthetic event by then and
                      // currentTarget is null inside the callback.
                      const isOpen = event.currentTarget.open;
                      setOpenProjects((current) => ({
                        ...current,
                        [project.projectId]: isOpen,
                      }));
                    }}
                  >
                    <summary>
                      <span className="tree-summary-label">{project.title}</span>
                      <span className="tree-count">{project.counts.pages}</span>
                    </summary>
                    {/* The heading stays in the tree so assistive technology
                        and the e2e specs can still address a project by
                        name, but it now lives inside the disclosure. */}
                    <h3 className="visually-hidden">{project.title}</h3>
                    <p className="project-counts">
                      {project.counts.pages} pages · {project.counts.ready} ready ·{" "}
                      {project.counts.failed} failed · {project.counts.inProgress} in progress
                    </p>
                    {/* Feedback counts for the editor (D075); the share
                        control now lives in the selected project's header. */}
                    <p className="project-counts" data-testid="project-feedback-summary">
                      {feedbackSummary(projectFeedback(project, seenAdjust))}
                    </p>
                    <ol>
                      {project.pages.map((page) => (
                        <li key={page.id}>
                          <span className="page-url">{page.normalizedUrl}</span>
                          <ul className="page-devices">
                            {page.devices.map((device) => {
                              const isActive =
                                active?.page.id === page.id &&
                                active.device.variant === device.variant;
                              // Unread and open counts of the device's selected
                              // capture (D075), beside the button so its
                              // accessible name stays the stable device label.
                              const feedback = captureFeedback(
                                project,
                                device.selectedCaptureId,
                                seenAdjust,
                              );
                              const badge = feedbackBadge(feedback);
                              return (
                                <li key={device.variant}>
                                  <button
                                    type="button"
                                    // The visible label is just "Desktop"; the page
                                    // it belongs to has to be in the accessible
                                    // name or every project repeats two identical
                                    // buttons.
                                    aria-label={`${variantLabel(device.variant)} capture of ${page.normalizedUrl}`}
                                    aria-current={isActive ? "true" : undefined}
                                    onClick={() =>
                                      setSelection({
                                        pageId: page.id,
                                        variant: device.variant,
                                        captureId: null,
                                      })
                                    }
                                  >
                                    {variantLabel(device.variant)}
                                    <span className="device-status">
                                      {" "}
                                      — {deviceStatus(device)}
                                    </span>
                                  </button>
                                  {badge ? (
                                    <span
                                      className="tree-count feedback-badge"
                                      data-testid="feedback-badge"
                                      data-unread={feedback.unreadReplies > 0 ? "true" : "false"}
                                      aria-label={`${variantLabel(device.variant)} capture of ${page.normalizedUrl}: ${badge}`}
                                    >
                                      {badge}
                                    </span>
                                  ) : null}
                                </li>
                              );
                            })}
                          </ul>
                        </li>
                      ))}
                    </ol>
                  </details>
                </li>
              );
            })}
          </ul>
        </details>
      </nav>

      {active ? (
        <section className="workspace-detail" aria-label="Selected capture">
          {/* The selected project's header (D075): its title, the feedback
              counts for the editor, and the share control that used to sit
              inside the collapsed rail entry. */}
          <div className="project-header" data-testid="project-header">
            {/* Not a heading: the rail already carries the one heading with
                this project's name, and the specs address it by that role. */}
            <p className="project-title" data-testid="project-title">
              {active.project.title}
            </p>
            <p className="project-feedback" data-testid="project-feedback">
              {feedbackSummary(projectFeedback(active.project, seenAdjust))}
            </p>
            <FounderShareControl
              key={active.project.publicId}
              publicId={active.project.publicId}
              projectTitle={active.project.title}
            />
          </div>
          <h3>
            {variantLabel(active.device.variant)} — {active.page.normalizedUrl}
          </h3>

          {/* Project-level capture progress and retry (D076). */}
          <CaptureProgress project={active.project} onChanged={onChanged} />

          {active.device.attempts.length > 1 ? (
            <ul className="capture-versions" aria-label="Capture versions">
              {active.device.attempts.map((attempt) => (
                <li key={attempt.id}>
                  <button
                    type="button"
                    aria-current={attempt.id === selectedAttempt?.id ? "true" : undefined}
                    onClick={() =>
                      setSelection({
                        pageId: active.page.id,
                        variant: active.device.variant,
                        captureId: attempt.id,
                      })
                    }
                  >
                    Version {attempt.attempt} — {STATE_LABELS[attempt.state]}
                    {attempt.id === active.device.selectedCaptureId ? " (default)" : ""}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          <div className="workspace-body">
            {selectedReady ? (
              // Keyed by capture id so every selection change remounts the
              // plane: drafts and transient state die with the old plane,
              // and the session camera memory restores this plane's own
              // camera (or the entire-capture view on first visit).
              <CaptureCanvas
                key={selectedReady.id}
                captureId={selectedReady.id}
                pageUrl={active.page.normalizedUrl}
                variant={variantLabel(active.device.variant)}
                attempt={selectedReady.attempt}
                width={selectedReady.documentWidth!}
                height={selectedReady.documentHeight!}
                pins={activePins}
                previewRect={previewRect}
                selectedPinId={selectedPinId}
                onSelectPin={setSelectedPinId}
                onMovePin={(annotationId, tip) => void movePin(annotationId, tip)}
                savedCamera={cameras.current.get(selectedReady.id) ?? null}
                onCameraChange={handleCameraChange}
                onDraftChange={setDraftTip}
                onDraftSettled={handleDraftSettled}
                draftResetSignal={draftResetSignal}
                composer={{
                  draftBody,
                  onDraftBodyChange: setDraftBody,
                  draftChoice,
                  onDraftChoiceChange: handleDraftChoiceChange,
                  draftCandidates:
                    draftCandidates && draftCandidates.captureId === selectedCaptureId
                      ? draftCandidates
                      : null,
                  onPreviewCandidate: handlePreviewCandidate,
                  onSaveDraft: () => void saveDraft(),
                  onCancelDraft: cancelDraft,
                  saveState,
                }}
              />
            ) : (
              // Unavailable/empty states are non-annotatable: no canvas, no
              // pin affordance, and a named next action (wait, or retry).
              <div className="capture-stage" data-testid="capture-stage">
                <p>
                  No capture to show yet:{" "}
                  {selectedAttempt ? STATE_LABELS[selectedAttempt.state] : "not captured"}.
                </p>
              </div>
            )}
            <CapturePanel
              attempt={selectedAttempt}
              pageUrl={active.page.normalizedUrl}
              variant={active.device.variant}
              ready={selectedReady !== null}
              pinsStatus={
                pinsState && pinsState.captureId === selectedCaptureId ? pinsState.status : null
              }
              pins={activePins}
              selectedPinId={selectedPinId}
              onSelectPin={setSelectedPinId}
              moveError={moveError}
              editing={editing}
              editBody={editBody}
              onEditBodyChange={setEditBody}
              onStartEdit={() => {
                const pin = activePins.find((candidate) => candidate.id === selectedPinId);
                setEditBody(pin?.body ?? "");
                setEditState("idle");
                setEditing(true);
              }}
              onCancelEdit={() => {
                setEditing(false);
                setEditState("idle");
              }}
              onSaveEdit={() => void saveEdit()}
              editState={editState}
              confirmingDelete={confirmingDelete}
              onRequestDelete={() => {
                setDeleteState("idle");
                setConfirmingDelete(true);
              }}
              onCancelDelete={() => {
                setConfirmingDelete(false);
                setDeleteState("idle");
              }}
              onConfirmDelete={() => void confirmDelete()}
              deleteState={deleteState}
              onSetPinStatus={(action) => void setPinStatus(action)}
              statusState={statusState}
              thread={
                selectedPinId && threadState && threadState.annotationId === selectedPinId
                  ? {
                      originalBody:
                        activePins.find((pin) => pin.id === selectedPinId)?.body ?? "",
                      status: threadState.status,
                      entries: threadState.entries,
                      replyBody,
                      onReplyBodyChange: setReplyBody,
                      onSendReply: () => void sendFollowUp(),
                      sendState: replyState,
                      composerLabel: "Follow up as Lucas",
                      sendLabel: "Send follow-up",
                    }
                  : undefined
              }
            />
          </div>

          {/* The page explains itself in one line (VAL-CANVAS-009, D074):
              the three things a reader can do on the screenshot. */}
          {selectedReady ? (
            <p className="workspace-hint">
              Click the page to drop a pin · drag a pin to move it · click a pin to read or
              reply.
            </p>
          ) : null}

          {active.device.latest?.state === "failed" && active.device.latest.errorCode ? (
            <p role="alert" className="capture-error">
              {outcomeMessages.get(active.device.latest.errorCode) ??
                "That capture did not complete."}
            </p>
          ) : null}
          {active.device.latest?.state === "stale" ? (
            <p role="alert" className="capture-error">
              This attempt stopped responding. Retry to schedule a fresh one.
            </p>
          ) : null}
          {retryError ? (
            <p role="alert" className="capture-error">
              {retryError}
            </p>
          ) : null}

          {active.device.retryable ? (
            <button
              type="button"
              disabled={retrying}
              onClick={() => void retry(active.page.id, active.device.variant)}
            >
              {retrying
                ? "Retrying…"
                : `Retry ${variantLabel(active.device.variant)} capture`}
            </button>
          ) : null}

          {/* Every pin at once, below the canvas (D071) — the side panel can
              only ever show the selected one. */}
          {selectedReady ? (
            <PinTable
              pins={activePins}
              status={
                pinsState && pinsState.captureId === selectedCaptureId ? pinsState.status : null
              }
              context={{
                pageUrl: active.page.normalizedUrl,
                variant: variantLabel(active.device.variant),
                attempt: selectedAttempt?.attempt ?? null,
              }}
              selectedPinId={selectedPinId}
              onSelectPin={setSelectedPinId}
            />
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
