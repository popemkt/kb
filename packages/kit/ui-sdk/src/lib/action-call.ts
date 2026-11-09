/**
 * An action as data (DESIGN-UI.md → The node menu): what a key, a node
 * command or a picker step runs when its form is T0, so no author code
 * runs at the moment a person acts. It is about a row, so the row's node
 * is its input's `id`; a picker step's pick fills each {@link PICKED} in
 * the input. It runs through the page's one invoke path, under the guards
 * every call meets, and a failed call is told.
 */
import { browserHost } from "../host";
import { toast } from "./toast";

/** An action by id, with the input it is called with. */
export interface ActionCall {
  readonly action: string;
  /** The action's input; the row's node is added as `id`. */
  readonly input?: Readonly<Record<string, unknown>>;
}

/** Where a picker step's input takes the node the person picked. */
export interface Picked {
  readonly $: "picked";
}

/** The value a picker step's pick replaces, wherever it stands in the input. */
export const PICKED: Picked = Object.freeze({ $: "picked" });

function isPicked(value: unknown): value is Picked {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.keys(value).length === 1 &&
    (value as { $?: unknown }).$ === "picked"
  );
}

/** `record` with each {@link PICKED} in it replaced by `picked`. */
function fillRecord(record: object, picked: string): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).map(([key, item]) => [key, fillPicked(item, picked)]),
  );
}

/** `value` with each {@link PICKED} in it replaced by `picked`. */
function fillPicked(value: unknown, picked: string): unknown {
  if (isPicked(value)) return picked;
  if (Array.isArray(value)) return value.map((item: unknown) => fillPicked(item, picked));
  if (typeof value === "object" && value !== null) return fillRecord(value, picked);
  return value;
}

/**
 * The input `call` is invoked with about the row of `id`: its own input,
 * the pick filling each {@link PICKED} when there is a pick, and `id`.
 */
export function callInput(
  call: ActionCall,
  about: { readonly id: string; readonly picked?: string },
): Readonly<Record<string, unknown>> {
  const input = call.input ?? {};
  const filled = about.picked === undefined ? input : fillRecord(input, about.picked);
  return { ...filled, id: about.id };
}

/** Invoke `action` with `input`, telling the person when the call fails. */
export async function invokeAction({
  action,
  input,
}: {
  readonly action: string;
  readonly input: Readonly<Record<string, unknown>>;
}): Promise<void> {
  const receipt = await browserHost().invoke(action, input);
  if (receipt.status === "failed") toast(`${action} failed: ${receipt.message}`);
}
