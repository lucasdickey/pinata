"use client";

// The append-only thread under one saved pin (REQUIREMENTS 6), shared by the
// editor's pin panel and the founder's read/reply view. It renders the
// editor's original comment (labelled Lucas), then every immutable entry in
// server order with its server-assigned label, then one composer for the
// current role. Nothing here can edit or delete an entry: there is no such
// control because there is no such route. Bodies are plain text rendered
// through React escaping only.

import { useEffect, useRef, useState } from "react";
import { FEEDBACK_BODY_MAX_CHARS } from "../lib/boundaries";
import type { ThreadEntryView } from "../lib/threads";

export type ThreadStatus = "loading" | "ready" | "failed";
export type ReplySendState = "idle" | "sending" | "failed" | "throttled" | "denied";

export interface ThreadViewProps {
  /** The pin's editable original comment: the thread's first message. */
  originalBody: string;
  status: ThreadStatus;
  entries: ThreadEntryView[];
  replyBody: string;
  onReplyBodyChange: (value: string) => void;
  onSendReply: () => void;
  sendState: ReplySendState;
  /** The composer's label, naming the role that will be recorded. */
  composerLabel: string;
  /** The send button's idle text. */
  sendLabel: string;
  /**
   * The editor's pin accordion (D128) shows the comment once, above the
   * thread, so it leaves the original out here. The founder's view keeps it.
   */
  showOriginal?: boolean;
  /**
   * The accordion keeps a long thread inside its row: the entries scroll on
   * their own, start at the latest, and can be scrolled from the keyboard.
   */
  scrollEntries?: boolean;
  /**
   * The accordion keeps the reply box behind a Reply button so an open pin
   * stays short; a draft already typed keeps it open.
   */
  replyBehindButton?: boolean;
}

/**
 * A thread time as a person reads it (D097): "Sep 23, 5:04 PM" in the
 * reader's own locale and time zone, with the year only when it is not the
 * current one. The exact instant stays machine-readable on the surrounding
 * <time dateTime> and as its title. Locale, zone, and "now" are parameters
 * so tests can pin them.
 */
export function formatThreadTime(
  createdAt: number,
  {
    locale,
    timeZone,
    now = Date.now(),
  }: { locale?: string; timeZone?: string; now?: number } = {},
): string {
  const zoned = (ms: number) =>
    new Intl.DateTimeFormat("en-US", { year: "numeric", timeZone }).format(new Date(ms));
  const sameYear = zoned(createdAt) === zoned(now);
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(new Date(createdAt));
}

function EntryTime({ createdAt }: { createdAt: number }) {
  const iso = new Date(createdAt).toISOString();
  return (
    <time dateTime={iso} title={iso}>
      {formatThreadTime(createdAt)}
    </time>
  );
}

export function ThreadView({
  originalBody,
  status,
  entries,
  replyBody,
  onReplyBodyChange,
  onSendReply,
  sendState,
  composerLabel,
  sendLabel,
  showOriginal = true,
  scrollEntries = false,
  replyBehindButton = false,
}: ThreadViewProps) {
  const sendDisabled = sendState === "sending" || replyBody.trim().length === 0;
  const [replying, setReplying] = useState(false);
  const composerOpen = !replyBehindButton || replying || replyBody.trim().length > 0;
  const replyField = useRef<HTMLTextAreaElement | null>(null);
  const entriesRef = useRef<HTMLOListElement | null>(null);

  // The latest entry is the current ask: a scrolling thread starts there.
  useEffect(() => {
    const list = entriesRef.current;
    if (scrollEntries && list) list.scrollTop = list.scrollHeight;
  }, [scrollEntries, entries.length, status]);

  const openComposer = () => {
    setReplying(true);
    requestAnimationFrame(() => replyField.current?.focus());
  };
  return (
    <section className="thread" aria-label="Comment thread" data-testid="thread">
      <ol
        className="thread-entries"
        aria-label="Thread entries"
        ref={entriesRef}
        data-scroll={scrollEntries ? "true" : undefined}
        // A scrolling region must be reachable from the keyboard.
        tabIndex={scrollEntries ? 0 : undefined}
      >
        {showOriginal ? (
          <li className="thread-entry" data-author="Lucas">
            <p className="thread-meta">
              <strong>Lucas</strong> <span className="thread-role">(editor)</span>
            </p>
            <p className="thread-body">{originalBody}</p>
          </li>
        ) : null}
        {entries.map((entry) =>
          entry.kind === "status" ? (
            // A resolve or reopen (D075): one quiet system line in the same
            // immutable chronology, written by the server, never a message.
            <li key={entry.id} className="thread-status" data-kind="status">
              <p className="thread-meta">
                {entry.body} <EntryTime createdAt={entry.createdAt} />
              </p>
            </li>
          ) : (
            <li key={entry.id} className="thread-entry" data-author={entry.authorLabel}>
              <p className="thread-meta">
                <strong>{entry.authorLabel}</strong>{" "}
                <span className="thread-role">({entry.actorRole})</span>{" "}
                <EntryTime createdAt={entry.createdAt} />
              </p>
              <p className="thread-body">{entry.body}</p>
            </li>
          ),
        )}
      </ol>
      {status === "loading" ? <p className="panel-note">Loading replies…</p> : null}
      {status === "failed" ? (
        <p className="panel-note">Replies could not be loaded. Reload to try again.</p>
      ) : null}
      {status === "ready" && entries.length === 0 ? (
        <p className="panel-note">No replies yet.</p>
      ) : null}
      {composerOpen ? (
        <>
          <label className="panel-field">
            {composerLabel}
            <textarea
              ref={replyField}
              value={replyBody}
              onChange={(event) => onReplyBodyChange(event.target.value)}
              maxLength={FEEDBACK_BODY_MAX_CHARS}
              rows={3}
              disabled={sendState === "sending"}
            />
          </label>
          <p className="panel-actions">
            <button
              type="button"
              className="button-primary"
              onClick={onSendReply}
              disabled={sendDisabled}
            >
              {sendState === "sending" ? "Sending…" : sendLabel}
            </button>
            {replyBehindButton && replyBody.trim().length === 0 ? (
              <button type="button" onClick={() => setReplying(false)}>
                Cancel
              </button>
            ) : null}
          </p>
        </>
      ) : (
        <p className="panel-actions">
          <button type="button" onClick={openComposer}>
            Reply
          </button>
        </p>
      )}
      {sendState === "failed" ? (
        <p role="alert" className="capture-error">
          That reply could not be sent. Your text is still here — try again.
        </p>
      ) : null}
      {sendState === "throttled" ? (
        <p role="alert" className="capture-error">
          Too many replies for now. Please try again later.
        </p>
      ) : null}
      {sendState === "denied" ? (
        <p role="alert" className="capture-error">
          This link is no longer valid, so the reply was not sent.
        </p>
      ) : null}
      {composerOpen ? (
        <p className="panel-note">Replies are permanent: they cannot be edited or deleted.</p>
      ) : null}
    </section>
  );
}
