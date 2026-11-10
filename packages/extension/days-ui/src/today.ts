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

/** How long a made day may take to reach the page's replica. */
const ARRIVAL_MS = 3_000;

/** Whether the page's replica holds `id`, waiting for it a little. */
function arrived(id: string): Promise<boolean> {
  const host = browserHost();
  if (host.nodes().has(id)) return Promise.resolve(true);
  return new Promise((resolve) => {
    const settle = (held: boolean) => {
      stop();
      clearTimeout(timer);
      resolve(held);
    };
    const stop = host.subscribe(() => {
      if (host.nodes().has(id)) settle(true);
    });
    const timer = setTimeout(() => settle(host.nodes().has(id)), ARRIVAL_MS);
  });
}

/**
 * Today's node, made if need be. Rejects when the family refused or the
 * node never reached the page: as the capture target's provider, a failure
 * demotes days and the role's default answers (DESIGN.md → Provider roles).
 */
export async function todayNode(): Promise<string> {
  const receipt = await browserHost().invoke(DAYS_IDS.todayAction, { day: pageDay() });
  if (receipt.status === "failed") throw new Error(`today's node was refused: ${receipt.message}`);
  const output: unknown = receipt.output;
  const id =
    typeof output === "object" && output !== null && "id" in output && typeof output.id === "string"
      ? output.id
      : null;
  if (id === null) throw new Error("today's node: the action answered no id");
  if (!(await arrived(id))) throw new Error(`today's node ${id} never reached the page`);
  return id;
}

/** Open today's node in its own view (the day page), making it first if need be. */
export async function openToday(): Promise<void> {
  const id = await todayNode().catch(() => null);
  if (id !== null) navigate(nodePath(id));
}
