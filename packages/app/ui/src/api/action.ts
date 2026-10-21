/** POST /api/action — the receipt and, on success, the rev it committed at (protocol.ts). */

import {
  ActionResponseSchema,
  envelopeOf,
  type ActionRequest,
  type ActionResponse,
} from "@kb/contracts";
import { tabSession } from "@/api/tab-session";

export type { ActionRequest, ActionResponse };

export type PostActionFn = (invocation: ActionRequest) => Promise<ActionResponse>;

let postActionImpl: PostActionFn = defaultPostAction;

async function defaultPostAction(invocation: ActionRequest): Promise<ActionResponse> {
  const res = await fetch("/api/action", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-KB-Origin": tabSession(),
    },
    body: JSON.stringify(envelopeOf(invocation)),
  });
  const json: unknown = await res.json().catch(() => null);
  const parsed = ActionResponseSchema.safeParse(json);
  if (parsed.success) return parsed.data;
  return {
    status: "failed",
    id: invocation.id,
    code: "internal",
    message: `POST /api/action → ${res.status}`,
  };
}

/** Inject a mock for tests. */
export function setPostAction(fn: PostActionFn | null): void {
  postActionImpl = fn ?? defaultPostAction;
}

/**
 * Send one invocation's envelope to the server, which says who makes it
 * from the request it arrives on (DESIGN.md → Surfaces → Who the person is).
 */
export function postAction(invocation: ActionRequest): Promise<ActionResponse> {
  return postActionImpl(invocation);
}
