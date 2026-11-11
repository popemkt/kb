/**
 * Keybindings as a point: a key in a context runs an intent the context
 * names, or an action (DESIGN-UI.md → Keybindings).
 *
 * A context is a place keys mean something, a contribution to
 * {@link KeyContextPoint} by the plugin that reads it, which owns it: the
 * page's own (`core.page`), offered every key first; and the outline's
 * editing row (`outline.editing`) and its selection (`outline.selection`)
 * and the canvas's three (`canvas.rest`, `canvas.transform`,
 * `canvas.present`), offered the keys of what has focus. Its owner states its bindings as every other
 * plugin does, as contributions to {@link KeybindingPoint}, so a built-in
 * has an id another binding can name. The keymap a context reads is
 * decided here, once, for every context: the owner's bindings first,
 * then the rest in the order they were contributed. A binding whose chord
 * overlaps one already held is refused, unless it says it `replaces` that
 * holder and the host approves its owner replacing (`replacementApproved`);
 * a reserved chord is the owner's alone. A refusal is told to the person,
 * by name, once a page session.
 */
import { CORE_POINT_DEFINITIONS } from "@kb/contracts";
import type { Contribution } from "@kb/plugin";
import { Point } from "@kb/plugin";
import { browserHost } from "../host";
import { callInput, invokeAction } from "./action-call";
import { pointReader } from "./plugins";
import { toast } from "./toast";

import {
  admitKeymaps,
  keyContextOf,
  type KeyRun,
  type Keybinding,
  type KeyContextSpec,
  type Keymap,
} from "@kb/keybindings";
export {
  admitKeybindings,
  admitKeymaps,
  keyContextOf,
  provideKeybinding,
  type KeyRun,
  type Keybinding,
  type KeyContextId,
  type KeyContextSpec,
  type KeyContext,
  type RefusedBinding,
  type Keymap,
} from "@kb/keybindings";

export const KeybindingPoint = Point<Keybinding>()(
  CORE_POINT_DEFINITIONS.keybinding.name,
  CORE_POINT_DEFINITIONS.keybinding.spec,
);
export const KeyContextPoint = Point<KeyContextSpec>()(
  CORE_POINT_DEFINITIONS.keyContext.name,
  CORE_POINT_DEFINITIONS.keyContext.spec,
);

/** The keymap of a context no plugin has contributed: it holds no key. */
const NO_KEYS: Keymap = { refused: [], held: [], resolve: () => undefined };

const readContexts = pointReader(KeyContextPoint);
const readBindings = pointReader(KeybindingPoint);
const keymaps = new WeakMap<
  readonly Contribution<KeyContextSpec>[],
  WeakMap<readonly Contribution<Keybinding>[], ReadonlyMap<string, Keymap>>
>();
const told = new Set<string>();

/**
 * Every context's keymap now, over the page kernel's contexts and
 * bindings: computed once per change to the kernel, and each refusal told
 * once a page session, naming the binding and why.
 */
function currentKeymaps(): ReadonlyMap<string, Keymap> {
  const contexts = readContexts();
  const bindings = readBindings();
  const byBindings = keymaps.get(contexts) ?? new WeakMap();
  keymaps.set(contexts, byBindings);
  const cached = byBindings.get(bindings);
  if (cached !== undefined) return cached;
  const admitted = admitKeymaps(contexts.map(keyContextOf), bindings, (owner) =>
    browserHost().replacementApproved(owner),
  );
  byBindings.set(bindings, admitted);
  const nowhere = bindings
    .filter(({ value }) => !admitted.has(value.context))
    .map(({ id, value }) => ({ id, reason: `there is no key context ${value.context}` }));
  for (const { id, reason } of [
    ...[...admitted.values()].flatMap(({ refused }) => refused),
    ...nowhere,
  ]) {
    const line = `Keybinding ${id} refused: ${reason}`;
    if (told.has(line)) continue;
    told.add(line);
    toast(line);
  }
  return admitted;
}

/** The keymap of the context `id` now ({@link currentKeymaps}); one holding no key while no plugin contributes it. */
export function currentKeymap(id: string): Keymap {
  return currentKeymaps().get(id) ?? NO_KEYS;
}

/**
 * Read every context's keymap, which tells any refusal: the page does so
 * whenever its kernel moves, so a binding a keymap refuses is told when it
 * arrives, not at the first key pressed in its context.
 */
export function tellKeymaps(): void {
  currentKeymaps();
}

/**
 * What a key runs besides an intent of its context: an action, invoked with
 * the node the key is about as its input's `id`; or a command, run about
 * that node. A key the page answers is about the page's own target, the
 * one ⌘K's commands run about, or none.
 */
export type KeyCall =
  | {
      readonly type: "runAction";
      readonly action: string;
      readonly input: Readonly<Record<string, unknown>>;
    }
  | { readonly type: "runCommand"; readonly command: string; readonly nodeId: string | null };

/** What `run` means about the node `nodeId` (or none): its action or command, or null for an intent. */
export function keyCallOf(run: KeyRun, nodeId: string | null): KeyCall | null {
  if ("command" in run) return { type: "runCommand", command: run.command, nodeId };
  if (!("action" in run)) return null;
  const input = nodeId === null ? (run.input ?? {}) : callInput(run, { id: nodeId });
  return { type: "runAction", action: run.action, input };
}

/** Run `call`: an action through the page's one invoke path, a command through the page's command runner. */
export function runKeyCall(call: KeyCall): Promise<void> {
  if (call.type === "runAction") return invokeAction(call);
  return browserHost().runCommand(call.command, call.nodeId);
}
