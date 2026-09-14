// POST /api/captures/[captureId]/annotations/[annotationId]/seen — record
// that the caller's role has read this pin's thread (D075). Either role;
// called when a thread loads. See src/lib/server/annotations/status-route.ts
// for the contract.

import {
  feedbackMethodNotAllowed,
  pinFeedbackHandler,
} from "../../../../../../../src/lib/server/annotations/status-route";

export const POST = pinFeedbackHandler("seen");

export const GET = feedbackMethodNotAllowed;
export const PUT = feedbackMethodNotAllowed;
export const PATCH = feedbackMethodNotAllowed;
export const DELETE = feedbackMethodNotAllowed;
