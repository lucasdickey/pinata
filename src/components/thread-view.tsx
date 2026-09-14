"use client";

// The append-only thread under one saved pin (REQUIREMENTS 6), shared by the
// editor's pin panel and the founder's read/reply view. It renders the
// editor's original comment (labelled Lucas), then every immutable entry in
// server order with its server-assigned label, then one composer for the
// current role. Nothing here can edit or delete an entry: there is no such
// control because there is no such route. Bodies are plain text rendered
// through React escaping only.

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
}

function timestamp(createdAt: number): string {
  return new Date(createdAt).toISOString().replace("T", " ").slice(0, 16) + " UTC";
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
}: ThreadViewProps) {
  const sendDisabled = sendState === "sending" || replyBody.trim().length === 0;
  return (
    <section className="thread" aria-label="Comment thread" data-testid="thread">
      <ol className="thread-entries" aria-label="Thread entries">
        <li className="thread-entry" data-author="Lucas">
          <p className="thread-meta">
            <strong>Lucas</strong> <span className="thread-role">(editor)</span>
          </p>
          <p className="thread-body">{originalBody}</p>
        </li>
        {entries.map((entry) =>
          entry.kind === "status" ? (
            // A resolve or reopen (D075): one quiet system line in the same
            // immutable chronology, written by the server, never a message.
            <li key={entry.id} className="thread-status" data-kind="status">
              <p className="thread-meta">
                {entry.body}{" "}
                <time dateTime={new Date(entry.createdAt).toISOString()}>
                  {timestamp(entry.createdAt)}
                </time>
              </p>
            </li>
          ) : (
            <li key={entry.id} className="thread-entry" data-author={entry.authorLabel}>
              <p className="thread-meta">
                <strong>{entry.authorLabel}</strong>{" "}
                <span className="thread-role">({entry.actorRole})</span>{" "}
                <time dateTime={new Date(entry.createdAt).toISOString()}>
                  {timestamp(entry.createdAt)}
                </time>
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
      <label className="panel-field">
        {composerLabel}
        <textarea
          value={replyBody}
          onChange={(event) => onReplyBodyChange(event.target.value)}
          maxLength={FEEDBACK_BODY_MAX_CHARS}
          rows={3}
          disabled={sendState === "sending"}
        />
      </label>
      <p className="panel-actions">
        <button type="button" onClick={onSendReply} disabled={sendDisabled}>
          {sendState === "sending" ? "Sending…" : sendLabel}
        </button>
      </p>
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
      <p className="panel-note">Replies are permanent: they cannot be edited or deleted.</p>
    </section>
  );
}
