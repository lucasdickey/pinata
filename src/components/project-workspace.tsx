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
// The detail area opens on a project overview (D077): one card per capture
// with its thumbnail, state, and counts. Opening a card, or a page in the
// rail, shows that capture in the canvas view, where Desktop and Mobile are
// a toggle above the canvas and Next/Previous pin (and J/K) step through
// every pin in the project, switching plane as needed. The rail lists
// projects and pages only.
//
// The screenshot stage is deliberately inert — it renders a static capture,
// never live source markup, so there is no link, iframe, or handler here that
// could navigate to the captured site.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CAPTURE_OUTCOMES } from "../lib/boundaries";
import { EDITOR_CSRF_HEADER } from "../lib/auth-constants";
import { readCsrfProof } from "../lib/csrf";
import type {
  AnnotationView,
  FeedbackCounts,
  PinContextResponse,
  PinElementSnapshot,
  PinListResponse,
  PinMutationResponse,
  PinStatusResponse,
  ProjectPinAnnotationView,
  ProjectPinListResponse,
} from "../lib/annotations";
import {
  contextQuery,
  markKindNoun,
  markLabel,
  markOf,
  markPayload,
  pinsOf,
  rectanglesOf,
  withMark,
  type DraftMark,
} from "../lib/canvas/marks";
import {
  feedbackBadge,
  feedbackSummary,
  pageFeedback,
  pinFeedbackPath,
  projectFeedback,
  type SeenAdjustments,
} from "../lib/feedback-counts";
import {
  formatPinsAsMarkdown,
  formatProjectPinsAsMarkdown,
  type PinExportGroup,
} from "../lib/pin-export";
import {
  orderProjectPins,
  planeOrder,
  preferredVariant,
  stepProjectPin,
} from "../lib/pin-order";
import type { ThreadAppendResponse, ThreadEntryView, ThreadListResponse } from "../lib/threads";
import { CaptureCanvas, type CaptureCameraState } from "./capture-canvas";
import { CaptureProgress, type ProjectProgress } from "./capture-progress";
import type { ContextRect } from "../lib/canvas/flow-model";
import { CapturePanel, STATE_LABELS, variantLabel } from "./capture-panel";
import { DeviceToggle } from "./device-toggle";
import { FounderShareControl } from "./founder-share";
import type { DraftCandidates } from "./pin-composer";
import { PinTable, type PinTableRow, type PinTableScope } from "./pin-table";
import { ProjectOverview } from "./project-overview";
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

/**
 * The open capture in the canvas view. Null means the detail area shows the
 * selected project's overview instead (D077).
 */
interface Selection {
  pageId: string;
  variant: string;
  /** Explicitly chosen version, or null to follow the server default. */
  captureId: string | null;
}

const outcomeMessages = new Map(
  CAPTURE_OUTCOMES.map((outcome) => [outcome.code, outcome.publicMessage] as const),
);

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
  // Which project the detail area shows (its overview, or one of its
  // captures), and which capture is open in the canvas view; null opens
  // the overview (D077). The first project's overview is the default.
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  // A pin to select as soon as the plane it lives on is shown: set by a
  // step or a table row that lands on another capture, consumed by the
  // capture-change effect below so the plane switch and the selection are
  // one move rather than a switch that clears and a click that re-selects.
  const pendingPin = useRef<{ captureId: string; pinId: string } | null>(null);
  // The capture a keyboard step opened, so its canvas takes focus on mount
  // and the next J or K keeps stepping; a click anywhere else clears it.
  const [focusCanvasFor, setFocusCanvasFor] = useState<string | null>(null);
  // Every live pin in the selected project (D077), read from the
  // project-scoped route and scoped to the project it was fetched for. It
  // orders the Next/Previous stepping and fills the whole-project table;
  // the canvas and the side panel keep reading the per-capture list.
  const [projectPins, setProjectPins] = useState<{
    publicId: string;
    status: "loading" | "ready" | "failed";
    pins: ProjectPinAnnotationView[];
  } | null>(null);
  const [tableScope, setTableScope] = useState<PinTableScope>("capture");
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
  // The active plane's transient draft (a pin tip or a rectangle, D079),
  // mirrored here so the save can carry it and the composer state below can
  // follow it. The canvas remains the source of truth and clears it on
  // switch via the keyed remount.
  const [draft, setDraft] = useState<DraftMark | null>(null);
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
    pins: AnnotationView[];
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

  // The project the detail area shows: the chosen one, or the first when
  // nothing has been chosen yet or the chosen project has gone.
  const activeProject = useMemo(
    () => projects.find((project) => project.projectId === selectedProjectId) ?? projects[0],
    [projects, selectedProjectId],
  );

  // The open capture, or null for the overview. A selection whose page is
  // not in the shown project (the list changed underneath it) is treated as
  // no selection rather than as another project's plane.
  const active = useMemo(() => {
    const found = findDevice(activeProject, selection);
    return found && selection && activeProject
      ? { ...found, project: activeProject, selection }
      : null;
  }, [activeProject, selection]);

  // ---- navigation (D077) ---------------------------------------------------

  /** Show one capture in the canvas view. */
  const openCapture = useCallback(
    (projectId: string, pageId: string, variant: string, captureId: string | null = null) => {
      pendingPin.current = null;
      setFocusCanvasFor(null);
      setSelectedProjectId(projectId);
      setSelection({ pageId, variant, captureId });
    },
    [],
  );

  /** Show a project's overview (the default view of a project). */
  const showOverview = useCallback((projectId: string) => {
    pendingPin.current = null;
    setFocusCanvasFor(null);
    setSelectedProjectId(projectId);
    setSelection(null);
  }, []);

  /** Open a page on its preferred device: Desktop, or Mobile when Desktop is not usable. */
  const openPage = useCallback(
    (projectId: string, page: WorkspacePage) => {
      const variant = preferredVariant(page);
      if (variant) openCapture(projectId, page.id, variant);
    },
    [openCapture],
  );

  /**
   * Open the plane a pin lives on with that pin selected. A keyboard step
   * also hands focus to the new plane's canvas so the next key keeps going.
   */
  const goToPin = useCallback((pin: ProjectPinAnnotationView, viaKeyboard: boolean) => {
    pendingPin.current = { captureId: pin.captureId, pinId: pin.id };
    setFocusCanvasFor(viaKeyboard ? pin.captureId : null);
    setSelection({ pageId: pin.pageId, variant: pin.variant, captureId: pin.captureId });
  }, []);

  // ---- end navigation --------------------------------------------------------

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

  if (projects.length === 0 || !activeProject) return null;

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
  // The plane's stable identity. `selectedReady` is a fresh object on every
  // hierarchy reload (a poll tick or an onChanged re-read reparses the JSON),
  // so effects must key off this id, not the object, or unrelated reloads look
  // like plane switches (B1).
  const selectedReadyId = selectedReady?.id ?? null;

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
    setDraft(null);
    // A plane switch clears the pin selection, unless the switch was made
    // to reach a pin on this very plane (a cross-plane step or table row).
    const pending = pendingPin.current;
    pendingPin.current = null;
    setSelectedPinId(pending && pending.captureId === selectedCaptureId ? pending.pinId : null);
    setMoveError(null);
    setSaveState("idle");
    setPreviewRect(null);
    if (selectedReadyId) {
      void loadPins(selectedReadyId);
    } else {
      pinsRequestRef.current = null;
      setPinsState(null);
    }
    // Keyed on the plane's stable ids, never the `selectedReady` object: a
    // background hierarchy reload (poll tick, onChanged) hands us new object
    // references with identical data, and re-running here would wipe the live
    // selection and the in-progress draft. Mutations refresh pins themselves,
    // so this effect only owns the initial per-plane load (B1).
  }, [selectedCaptureId, selectedReadyId, loadPins]);

  // ---- project-scoped pins (D077) --------------------------------------------
  // One read per selected project, guarded like the per-capture load so a
  // late answer for a previous project can never fill the current one's
  // table or stepping order. Mutations below re-read it after they land.
  const activePublicId = activeProject.publicId;
  const activePublicIdRef = useRef(activePublicId);
  activePublicIdRef.current = activePublicId;
  const projectPinsRequestRef = useRef<string | null>(null);
  const loadProjectPins = useCallback(async (publicId: string) => {
    projectPinsRequestRef.current = publicId;
    setProjectPins((current) =>
      current && current.publicId === publicId
        ? { ...current, status: "loading" }
        : { publicId, status: "loading", pins: [] },
    );
    try {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(publicId)}/annotations`,
        { cache: "no-store" },
      );
      if (projectPinsRequestRef.current !== publicId) return;
      if (!response.ok) {
        setProjectPins({ publicId, status: "failed", pins: [] });
        return;
      }
      const payload = (await response.json()) as ProjectPinListResponse;
      if (projectPinsRequestRef.current !== publicId) return;
      setProjectPins({
        publicId,
        status: "ready",
        pins: Array.isArray(payload.annotations) ? payload.annotations : [],
      });
    } catch {
      if (projectPinsRequestRef.current !== publicId) return;
      setProjectPins({ publicId, status: "failed", pins: [] });
    }
  }, []);
  useEffect(() => {
    setTableScope("capture");
    void loadProjectPins(activePublicId);
  }, [activePublicId, loadProjectPins]);
  /** Re-read the shown project's pins after a write changed them. */
  const reloadProjectPins = useCallback(() => {
    void loadProjectPins(activePublicIdRef.current);
  }, [loadProjectPins]);
  /**
   * Apply a returned record to the listed project pin with the same id: the
   * shared fields, and (D079) new geometry of either kind through the mark.
   */
  const patchProjectPin = useCallback(
    (
      annotationId: string,
      patch: Partial<Pick<AnnotationView, "status" | "unreadReplies" | "body" | "revision">>,
      geometry?: DraftMark,
    ) => {
      setProjectPins((current) =>
        current
          ? {
              ...current,
              pins: current.pins.map((pin) => {
                if (pin.id !== annotationId) return pin;
                const patched = { ...pin, ...patch };
                return geometry
                  ? ({ ...patched, ...withMark(patched, geometry) } as ProjectPinAnnotationView)
                  : patched;
              }),
            }
          : current,
      );
    },
    [],
  );
  // ---- end project-scoped pins -------------------------------------------------

  // The draft's intent — idempotency key, context decision, candidates —
  // lives exactly as long as the draft. A null→tip transition is a brand
  // new draft: fresh key, undecided context. A drag only moves the tip, so
  // the key and decision survive it; a retried save replays the same intent
  // and a double submit can never create two pins. Resolving the draft
  // (saved, cancelled, escaped, or a plane switch) releases everything.
  const hadDraft = useRef(false);
  useEffect(() => {
    const isNew = draft !== null && !hadDraft.current;
    hadDraft.current = draft !== null;
    if (isNew) {
      setDraftKey(crypto.randomUUID());
      setDraftChoice(undefined);
      setDraftCandidates(null);
      setPreviewRect(null);
    } else if (!draft) {
      setDraftKey(null);
      setDraftBody("");
      setSaveState("idle");
      setDraftChoice(undefined);
      setDraftCandidates(null);
      setPreviewRect(null);
    }
  }, [draft]);

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
      patchProjectPin(annotationId, { unreadReplies: 0 });
    } catch {
      // Marking seen is best effort; the counts stay as the server last said.
    }
  }, [patchProjectPin]);

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
        patchProjectPin(payload.annotation.id, {
          status: payload.annotation.status,
          unreadReplies: payload.annotation.unreadReplies,
        });
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
    [selectedReady, selectedPinId, statusState, onChanged, patchProjectPin],
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
  const fetchContext = useCallback(async (captureId: string, mark: DraftMark) => {
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
      // A pin asks around its tip; a rectangle asks by overlap (D079).
      const response = await fetch(
        `/api/captures/${encodeURIComponent(captureId)}/context?${contextQuery(mark)}`,
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
  // the camera over a restored plane. `selectedReadyId` is defined with the
  // plane derivation above.
  const handleCameraChange = useCallback(
    (state: CaptureCameraState) => {
      if (selectedReadyId) cameras.current.set(selectedReadyId, state);
    },
    [selectedReadyId],
  );

  // The draft's context query fires when the draft settles (placement tap
  // or draft-drag end), keyed to the capture the draft belongs to.
  const handleDraftSettled = useCallback(
    (mark: DraftMark) => {
      if (selectedReadyId) void fetchContext(selectedReadyId, mark);
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
      !draft ||
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
            // `tip` for a pin, `rect` for a rectangle: the key names the kind.
            ...markPayload(draft),
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
      reloadProjectPins();
    } catch {
      setSaveState("failed");
    }
  }, [
    draft,
    selectedReady,
    draftKey,
    draftBody,
    draftChoice,
    saveState,
    loadPins,
    reloadProjectPins,
  ]);

  const cancelDraft = useCallback(() => {
    // Same mechanism as a successful save: the canvas drops the draft and
    // reports null, which releases the body and key. No write ever leaves.
    setDraftResetSignal((value) => value + 1);
  }, []);

  // One revisioned geometry write for a pin move or a rectangle move or
  // resize (D079): the mark names the kind and carries the new geometry.
  const movePin = useCallback(
    async (annotationId: string, mark: DraftMark) => {
      const captureId = selectedReady?.id;
      if (!captureId) return;
      // The revision precondition comes from the record the drag started
      // from; without it there is no safe write to make.
      const pin = pinsState?.pins.find((candidate) => candidate.id === annotationId);
      if (!pin) return;
      // The messages name the kind that moved (D078): a box is not a pin.
      const noun = markKindNoun(mark.kind);
      const restored = `That ${noun} move could not be saved. The saved position was restored.`;
      // Optimistic local update: the pin stays where it was dropped while
      // the one revisioned write commits. A failure re-reads the
      // authoritative list, so a rejected move snaps back — never a false
      // success and never a ghost.
      setPinsState((current) =>
        current && current.captureId === captureId
          ? {
              ...current,
              pins: current.pins.map((pin) =>
                pin.id === annotationId ? withMark(pin, mark) : pin,
              ),
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
            body: JSON.stringify({ ...markPayload(mark), expectedRevision: pin.revision }),
          },
        );
        if (!response.ok) {
          // A 409 means another session wrote first: the authoritative
          // reload shows the winning revision instead of overwriting it.
          // The move's message supersedes any stale edit/delete conflict
          // notice — one conflict message at a time.
          setMoveError(
            response.status === 409
              ? `This ${noun} changed in another session. The latest version is now shown.`
              : restored,
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
        patchProjectPin(
          annotationId,
          { revision: payload.annotation.revision },
          markOf(payload.annotation),
        );
      } catch {
        setMoveError(restored);
        setEditState("idle");
        setDeleteState("idle");
        await loadPins(captureId);
      }
    },
    [selectedReady, pinsState, loadPins, patchProjectPin],
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
      patchProjectPin(pin.id, {
        body: payload.annotation.body,
        revision: payload.annotation.revision,
      });
      setEditing(false);
      setEditState("idle");
    } catch {
      setEditState("failed");
    }
  }, [selectedReady, pinsState, selectedPinId, editBody, editState, loadPins, patchProjectPin]);

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
      reloadProjectPins();
    } catch {
      setDeleteState("failed");
    }
  }, [selectedReady, pinsState, selectedPinId, deleteState, loadPins, reloadProjectPins]);

  // ---- stepping and the project table (D077) ---------------------------------
  // Every pin in the shown project, in page, device, version, number order:
  // the sequence Next/Previous pin and J/K follow, and the rows of the
  // whole-project table.
  const planes = useMemo(() => planeOrder(activeProject), [activeProject]);
  const orderedPins = useMemo(
    () =>
      projectPins && projectPins.publicId === activePublicId && projectPins.status === "ready"
        ? orderProjectPins(projectPins.pins, planes)
        : [],
    [projectPins, activePublicId, planes],
  );
  const projectPinsStatus =
    projectPins && projectPins.publicId === activePublicId ? projectPins.status : null;

  /** Select a pin wherever it lives, switching plane when it is elsewhere. */
  const selectPinAnywhere = useCallback(
    (annotationId: string | null) => {
      if (annotationId === null) {
        setSelectedPinId(null);
        return;
      }
      const target = orderedPins.find((pin) => pin.id === annotationId);
      if (target && target.captureId !== selectedCaptureId) goToPin(target, false);
      else setSelectedPinId(annotationId);
    },
    [orderedPins, selectedCaptureId, goToPin],
  );

  /** One step through the project's pins; the canvas keeps its own camera per plane. */
  const stepPin = useCallback(
    (direction: 1 | -1, viaKeyboard: boolean) => {
      const target = stepProjectPin(
        orderedPins,
        planes,
        { captureId: selectedCaptureId, pinId: selectedPinId },
        direction,
      );
      if (!target) return;
      if (target.captureId === selectedCaptureId) setSelectedPinId(target.id);
      else goToPin(target, viaKeyboard);
    },
    [orderedPins, planes, selectedCaptureId, selectedPinId, goToPin],
  );
  const stepPinByKey = useCallback((direction: 1 | -1) => stepPin(direction, true), [stepPin]);
  const selectedStepIndex = selectedPinId
    ? orderedPins.findIndex((pin) => pin.id === selectedPinId)
    : -1;
  // The position line names the selected mark the way every list does
  // (D078), then says where it falls in the project's order.
  const stepPosition =
    orderedPins.length === 0
      ? "No pins in this project"
      : selectedStepIndex === -1
        ? `${orderedPins.length} pin${orderedPins.length === 1 ? "" : "s"} in this project`
        : `${markLabel(orderedPins[selectedStepIndex]!)} · ${selectedStepIndex + 1} of ${
            orderedPins.length
          }`;

  // Table rows: the open capture's pins from the per-capture list (always
  // current after a write), or the whole project's from the project read.
  const projectRows = useMemo<PinTableRow[]>(
    () =>
      orderedPins.map((pin) => ({
        pin,
        pageUrl: pin.normalizedUrl,
        variant: variantLabel(pin.variant),
        attempt: pin.attempt,
      })),
    [orderedPins],
  );
  const captureRows = useMemo<PinTableRow[]>(
    () =>
      active
        ? activePins.map((pin) => ({
            pin,
            pageUrl: active.page.normalizedUrl,
            variant: variantLabel(active.device.variant),
            attempt: selectedAttempt?.attempt ?? null,
          }))
        : [],
    [active, activePins, selectedAttempt],
  );
  const projectMarkdown = () => {
    // One group per capture, in the order the pins already have.
    const groups: { context: PinExportGroup["context"]; pins: ProjectPinAnnotationView[] }[] = [];
    for (const pin of orderedPins) {
      const last = groups[groups.length - 1];
      if (last && last.pins[0]?.captureId === pin.captureId) {
        last.pins.push(pin);
      } else {
        groups.push({
          context: {
            pageUrl: pin.normalizedUrl,
            variant: variantLabel(pin.variant),
            attempt: pin.attempt,
          },
          pins: [pin],
        });
      }
    }
    return formatProjectPinsAsMarkdown(groups, {
      title: activeProject.title,
      rootUrl: activeProject.rootUrl,
    });
  };
  const captureMarkdown = () =>
    active
      ? formatPinsAsMarkdown(activePins, {
          pageUrl: active.page.normalizedUrl,
          variant: variantLabel(active.device.variant),
          attempt: selectedAttempt?.attempt ?? null,
        })
      : "";
  // ---- end stepping and the project table --------------------------------------

  return (
    <div className="workspace">
      <nav className="workspace-tree" aria-label="Projects and pages">
        {/* Two levels of disclosure (D070). The rail used to print every
            project's whole page/device tree at once, so a handful of
            projects pushed the canvas off screen. Native <details> is used
            rather than a hand-rolled toggle: it is keyboard-operable and
            correctly announced with no script and no dependency, and it
            keeps working if hydration has not happened yet. Since D077 the
            rail lists projects and pages only; the device is chosen above
            the canvas. */}
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
              // The project the detail area shows stays open; the rest
              // start collapsed. Collapsing the shown project would hide
              // the controls that produced what the detail area is showing.
              const holdsActive = activeProject.projectId === project.projectId;
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
                    {/* The project's overview (D077): the way to select a
                        project without opening one of its captures. */}
                    <button
                      type="button"
                      className="tree-overview"
                      aria-label={`Overview of ${project.title}`}
                      aria-current={holdsActive && !active ? "true" : undefined}
                      onClick={() => showOverview(project.projectId)}
                    >
                      Overview
                    </button>
                    <ol className="tree-pages">
                      {project.pages.map((page) => {
                        const isActive = holdsActive && active?.page.id === page.id;
                        // Unread and open counts summed over the page's
                        // devices (D075, D077), beside the button so its
                        // accessible name stays the page URL.
                        const feedback = pageFeedback(project, page, seenAdjust);
                        const badge = feedbackBadge(feedback);
                        return (
                          <li key={page.id}>
                            <button
                              type="button"
                              className="page-url"
                              aria-current={isActive ? "true" : undefined}
                              onClick={() => openPage(project.projectId, page)}
                            >
                              {page.normalizedUrl}
                            </button>
                            {badge ? (
                              <span
                                className="tree-count feedback-badge"
                                data-testid="feedback-badge"
                                data-unread={feedback.unreadReplies > 0 ? "true" : "false"}
                                aria-label={`${page.normalizedUrl}: ${badge}`}
                              >
                                {badge}
                              </span>
                            ) : null}
                          </li>
                        );
                      })}
                    </ol>
                  </details>
                </li>
              );
            })}
          </ul>
        </details>
      </nav>

      <section
        className="workspace-detail"
        aria-label={active ? "Selected capture" : "Project overview"}
      >
        {/* The selected project's header (D075): its title, the feedback
            counts for the editor, and the share control that used to sit
            inside the collapsed rail entry. */}
        <div className="project-header" data-testid="project-header">
          {/* Not a heading: the rail already carries the one heading with
              this project's name, and the specs address it by that role. */}
          <p className="project-title" data-testid="project-title">
            {activeProject.title}
          </p>
          <p className="project-feedback" data-testid="project-feedback">
            {feedbackSummary(projectFeedback(activeProject, seenAdjust))}
          </p>
          <FounderShareControl
            key={activeProject.publicId}
            publicId={activeProject.publicId}
            projectTitle={activeProject.title}
          />
        </div>

        {/* Project-level capture progress and retry (D076). */}
        <CaptureProgress project={activeProject} onChanged={onChanged} />

        {active ? (
          <>
            {/* The canvas view's controls (D077): back to the overview, the
                device toggle for this page, and stepping through every pin
                in the project. */}
            <div className="canvas-toolbar" data-testid="canvas-toolbar">
              <button
                type="button"
                className="back-to-overview"
                onClick={() => showOverview(activeProject.projectId)}
              >
                Back to overview
              </button>
              <DeviceToggle
                pageUrl={active.page.normalizedUrl}
                devices={active.page.devices}
                activeVariant={active.device.variant}
                onChange={(variant) =>
                  openCapture(activeProject.projectId, active.page.id, variant)
                }
              />
              <p className="pin-step" role="group" aria-label="Step through pins">
                <button
                  type="button"
                  disabled={orderedPins.length === 0}
                  onClick={() => stepPin(-1, false)}
                >
                  Previous pin
                </button>
                <button
                  type="button"
                  disabled={orderedPins.length === 0}
                  onClick={() => stepPin(1, false)}
                >
                  Next pin
                </button>
                <span className="pin-step-position" data-testid="pin-step-position">
                  {stepPosition}
                </span>
              </p>
              {/* The verb strip (VAL-CANVAS-009, D078): what a click, a
                  shift-drag, and a drag do, beside the controls they sit
                  with. A paragraph, never a heading. */}
              {selectedReady ? (
                <p className="workspace-verbs" data-testid="workspace-verbs">
                  drop a pin: click the page · draw a box: shift-drag · move: drag it · read or
                  reply: click a mark
                </p>
              ) : null}
            </div>
            <h3>
              {variantLabel(active.device.variant)} — {active.page.normalizedUrl}
            </h3>

            {active.device.attempts.length > 1 ? (
              <ul className="capture-versions" aria-label="Capture versions">
                {active.device.attempts.map((attempt) => (
                  <li key={attempt.id}>
                    <button
                      type="button"
                      aria-current={attempt.id === selectedAttempt?.id ? "true" : undefined}
                      onClick={() =>
                        openCapture(
                          activeProject.projectId,
                          active.page.id,
                          active.device.variant,
                          attempt.id,
                        )
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
                  pins={pinsOf(activePins)}
                  rectangles={rectanglesOf(activePins)}
                  previewRect={previewRect}
                  selectedPinId={selectedPinId}
                  onSelectPin={setSelectedPinId}
                  onMovePin={(annotationId, tip) =>
                    void movePin(annotationId, { kind: "pin", tip })
                  }
                  onMoveRectangle={(annotationId, rect) =>
                    void movePin(annotationId, { kind: "rectangle", rect })
                  }
                  savedCamera={cameras.current.get(selectedReady.id) ?? null}
                  onCameraChange={handleCameraChange}
                  onDraftChange={setDraft}
                  onDraftSettled={handleDraftSettled}
                  draftResetSignal={draftResetSignal}
                  onStepPin={stepPinByKey}
                  autoFocus={focusCanvasFor === selectedReady.id}
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

            {active.device.latest?.state === "failed" && active.device.latest.errorCode ? (
              <p role="alert" className="capture-error">
                {outcomeMessages.get(active.device.latest.errorCode) ??
                  "That capture did not complete."}
              </p>
            ) : null}
            {active.device.latest?.state === "stale" ? (
              <p role="alert" className="capture-error">
                This capture stopped responding. Retry to start a fresh one.
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
                only ever show the selected one. Filtered to this capture, or
                widened to the whole project (D077). */}
            {selectedReady ? (
              <PinTable
                rows={tableScope === "project" ? projectRows : captureRows}
                status={
                  tableScope === "project"
                    ? projectPinsStatus
                    : pinsState && pinsState.captureId === selectedCaptureId
                      ? pinsState.status
                      : null
                }
                heading={
                  tableScope === "project" ? "All pins in this project" : "All pins on this capture"
                }
                markdown={tableScope === "project" ? projectMarkdown : captureMarkdown}
                scope={{ value: tableScope, onChange: setTableScope }}
                selectedPinId={selectedPinId}
                onSelectPin={selectPinAnywhere}
              />
            ) : null}
          </>
        ) : (
          <>
            {/* The project overview (D077): every capture as a card, then
                every pin in the project. */}
            <ProjectOverview
              project={activeProject}
              adjustments={seenAdjust}
              onOpenCapture={(pageId, variant) =>
                openCapture(activeProject.projectId, pageId, variant)
              }
            />
            <PinTable
              rows={projectRows}
              status={projectPinsStatus}
              heading="All pins in this project"
              markdown={projectMarkdown}
              selectedPinId={null}
              onSelectPin={selectPinAnywhere}
            />
          </>
        )}
      </section>
    </div>
  );
}
