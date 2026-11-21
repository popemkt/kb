/**
 * Today, as the page asks for it (DESIGN-UI.md → Days): `ext.days.today`
 * with the page's local day, answered once the page's replica holds the
 * node, so a caller can write under it at once.
 */
import { clockSampler } from "@kb/model";
import { dayKeyAt, DAYS_IDS } from "@kb/days";
import { browserHost, navigate } from "@kb/ui-sdk";
import { nodePath } from "@kb/views";
import { Effect } from "effect";

/** The page's local day, `YYYY-MM-DD`. */
export function pageDay(): string {
  const sample = Effect.runSync(clockSampler)();
  return dayKeyAt(sample.nowMs, sample.timeZone) ?? "";
}

/**
 * Once the page's replica holds `id`: a node the family made arrives through
 * the page's live connection, however long a slow machine or connection
 * takes, so this waits for it, not for a clock. A caller that must answer
 * sooner bounds it with its own role's budget.
 */
function arrived(id: string): Promise<void> {
  const host = browserHost();
  if (host.nodes().has(id)) return Promise.resolve();
  return new Promise((resolve) => {
    const stop = host.subscribe(() => {
      if (!host.nodes().has(id)) return;
      stop();
      resolve();
    });
  });
}

/**
 * The node of `day` (`YYYY-MM-DD`), made if need be, once it is in the
 * page's replica. Rejects when the family refused it: as a role's provider
 * (the capture target, the date target, the landing), a failure demotes
 * days and the role's default answers (DESIGN.md → Provider roles).
 */
export async function dayNode(day: string): Promise<string> {
  const receipt = await browserHost().invoke(DAYS_IDS.todayAction, { day });
  if (receipt.status === "failed") throw new Error(`${day}'s node was refused: ${receipt.message}`);
  const output: unknown = receipt.output;
  const id =
    typeof output === "object" && output !== null && "id" in output && typeof output.id === "string"
      ? output.id
      : null;
  if (id === null) throw new Error(`${day}'s node: the action answered no id`);
  await arrived(id);
  return id;
}

/** Today's node, in the page's local day, made if need be. */
export function todayNode(): Promise<string> {
  return dayNode(pageDay());
}

/** Open today's node in its page, making it first if need be. */
export async function openToday(): Promise<void> {
  const id = await todayNode().catch(() => null);
  if (id !== null) navigate(nodePath(id));
}
