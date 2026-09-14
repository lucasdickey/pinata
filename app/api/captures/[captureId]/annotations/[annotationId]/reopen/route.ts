// POST /api/captures/[captureId]/annotations/[annotationId]/reopen — reopen
// one resolved pin (D075). Either role; the change writes a `status` thread
// entry. See src/lib/server/annotations/status-route.ts for the contract.

import {
  feedbackMethodNotAllowed,
  pinFeedbackHandler,
} from "../../../../../../../src/lib/server/annotations/status-route";

export const POST = pinFeedbackHandler("reopen");

export const GET = feedbackMethodNotAllowed;
export const PUT = feedbackMethodNotAllowed;
export const PATCH = feedbackMethodNotAllowed;
export const DELETE = feedbackMethodNotAllowed;
