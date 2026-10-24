/**
 * What a framed page does for its embedder (DESIGN.md → Surfaces → Embedding
 * the page). A page allowed to frame kb (`kb ui --embed-origin`) learns the
 * tab session of the kb page it frames, so its agent can make calls in it:
 * when framed, the page posts `{type: "kb.session", session}` to its parent
 * once per allowed origin, with that origin as the target, so the browser
 * delivers it only to a parent that is one. It posts when the server names
 * the embedding and again whenever the id is renewed. Nothing else crosses
 * the frame: calls go to the server, which routes them to the tab.
 */
import type { Embedding } from "@kb/contracts";
import { onTabSessionRenewed, tabSession } from "@/api/tab-session";

/** The message a framed page posts its parent. */
interface KbSessionMessage {
  readonly type: "kb.session";
  readonly session: string;
}

/** What the server last said an embedder may have. */
let embedding: Embedding = { origins: [] };
let unsubscribe: (() => void) | null = null;

function announce(session: string): void {
  if (typeof window === "undefined" || window.parent === window) return;
  const message: KbSessionMessage = { type: "kb.session", session };
  for (const origin of embedding.origins) window.parent.postMessage(message, origin);
}

/** The server named what an embedder may have: tell each allowed origin the tab's session. */
export function embedWith(next: Embedding): void {
  embedding = next;
  unsubscribe ??= onTabSessionRenewed(announce);
  announce(tabSession());
}
