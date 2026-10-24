/**
 * What a framed page does for its embedder (DESIGN.md → Surfaces → Embedding
 * the page). Both happen only in a page some other window frames, and only
 * for the origins `kb ui --embed-origin` names, which the page's
 * `frame-ancestors` already holds any other framer to.
 *
 * - **The tab's session.** A page allowed to frame kb learns the tab session
 *   of the kb page it frames, so its agent can make calls in it: the page
 *   posts `{type: "kb.session", session}` to its parent once per allowed
 *   origin, with that origin as the target, so the browser delivers it only
 *   to a parent that is one. It posts when the server names the embedding
 *   and again whenever the id is renewed.
 * - **The embedder's scripts.** Each `kb ui --embed-script` URL is loaded
 *   once, as a classic script whose `data-parent-origins` names the allowed
 *   origins (bb's keyboard hint bridge reads them there to know whom to
 *   answer). kb knows nothing of what a script does.
 *
 * Calls never cross the frame: they go to the server, which routes them to
 * the tab.
 */
import { NO_EMBEDDING, type Embedding } from "@kb/contracts";
import { onTabSessionRenewed, tabSession } from "@/api/tab-session";

/** The message a framed page posts its parent. */
interface KbSessionMessage {
  readonly type: "kb.session";
  readonly session: string;
}

/** What the server last said an embedder may have. */
let embedding: Embedding = NO_EMBEDDING;
let unsubscribe: (() => void) | null = null;
/** The scripts this page has loaded: a page loads each once, whatever the server repeats. */
const loaded = new Set<string>();

/** Whether another window frames this page. */
function framed(): boolean {
  return typeof window !== "undefined" && window.parent !== window;
}

function announce(session: string): void {
  if (!framed()) return;
  const message: KbSessionMessage = { type: "kb.session", session };
  for (const origin of embedding.origins) window.parent.postMessage(message, origin);
}

function loadScripts(): void {
  if (!framed() || embedding.origins.length === 0) return;
  for (const src of embedding.scripts) {
    if (loaded.has(src)) continue;
    loaded.add(src);
    const script = document.createElement("script");
    script.src = src;
    script.dataset.parentOrigins = embedding.origins.join(" ");
    document.head.append(script);
  }
}

/** The server named what an embedder may have: tell each allowed origin the tab's session, and load its scripts. */
export function embedWith(next: Embedding): void {
  embedding = next;
  unsubscribe ??= onTabSessionRenewed(announce);
  announce(tabSession());
  loadScripts();
}
