/**
 * Telling an embedder this tab's session (DESIGN.md → Surfaces → Embedding
 * the page). A page allowed to frame kb (`kb ui --embed-origin`) learns the
 * tab session of the kb page it frames, so its agent can make calls in it:
 * when framed, the page posts `{type: "kb.session", session}` to its parent
 * once per allowed origin, with that origin as the target, so the browser
 * delivers it only to a parent that is one. It posts when the server names
 * the origins and again whenever the id is renewed. Nothing else crosses the
 * frame: calls go to the server, which routes them to the tab.
 */
import { onTabSessionRenewed, tabSession } from "@/api/tab-session";

/** The message a framed page posts its parent. */
interface KbSessionMessage {
  readonly type: "kb.session";
  readonly session: string;
}

/** The origins allowed to frame this page, as the server last named them. */
let embedders: readonly string[] = [];
let unsubscribe: (() => void) | null = null;

function announce(session: string): void {
  if (typeof window === "undefined" || window.parent === window) return;
  const message: KbSessionMessage = { type: "kb.session", session };
  for (const origin of embedders) window.parent.postMessage(message, origin);
}

/** The server named the origins allowed to frame the page: tell each the tab's session. */
export function tellEmbedders(next: readonly string[]): void {
  embedders = next;
  unsubscribe ??= onTabSessionRenewed(announce);
  announce(tabSession());
}
