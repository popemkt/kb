/**
 * A refused write, worded for a person (DESIGN-UI.md → The commit decides
 * what a person may write).
 *
 * The commit's refusal is data (`WriteRefusal`, in `@kb/model`): the node,
 * and the part of the rule the write broke. Its own sentence
 * (`writeRefusalMessage`) is for an agent or a command line: it names ids
 * and the override. A person is told what the refused node is called, who
 * seeds it (its owner, `:node/owner`), and what they can do instead, never
 * the override, which is its owner's.
 *
 * Every surface that shows a failed receipt shows {@link failureText}, so a
 * refusal reads the same from the outline, a field, a canvas or an
 * extension's page.
 */
import { writeRefusalOf, type NodeId, type WriteRefusal } from "@kb/model";
import type { NodeIndex } from "@kb/query";
import { BrowserHostService } from "../host";
import { currentService } from "./plugins";
import { FROM_SOURCE } from "./contextual-ref";

/** The names a refusal is worded with, read from the graph. */
export interface RefusalNames {
  /** The label a node is shown by: its text, else its id. */
  readonly label: (id: NodeId) => string;
  /** Who seeds a node, by its owner's label, or null when no family does. */
  readonly owner: (id: NodeId) => string | null;
}

/** {@link RefusalNames} as `index` reads them; ids alone without one. */
export function refusalNames(index: NodeIndex | null): RefusalNames {
  const label = (id: NodeId) => {
    const text = index?.getNode(id)?.text.trim() ?? "";
    return text === "" ? id : text;
  };
  return {
    label,
    owner: (id) => {
      const owner = index?.related(id, ":node/owner")[0];
      return owner === undefined ? null : label(owner);
    },
  };
}

/** `refusal` as a person reads it: what is kept, by whom, and what they can do instead. */
export function personRefusal(refusal: WriteRefusal, names: RefusalNames): string {
  const node = names.label(refusal.id);
  // A node no family seeds (an extension's own node) comes with kb itself.
  const owner = names.owner(refusal.id) ?? "kb";
  switch (refusal.rule) {
    case "virtual":
      return `${node} is read ${FROM_SOURCE}.`;
    case "mint":
      return `${refusal.id} is an id kb keeps for what it ships, so a new node can't take it.`;
    case "rank":
      return `${node} stays where ${owner} put it. You can move your own nodes around it.`;
    case "stamp":
      return `${node} keeps the date ${owner} made it.`;
    case "children":
      return `${node} keeps what ${owner} put in it, in that order. You can add your own here, and move or remove those.`;
    case "list":
      return `${node} keeps the ${names.label(refusal.field)} ${owner} gave it, in that order. You can add your own, or make your own tag that extends it.`;
    case "setting":
      return `${owner} sets the ${names.label(refusal.field)} of ${node}.`;
    case "delete":
    default:
      return `${node} comes with ${owner}, so it can't be deleted. You can add your own beside it.`;
  }
}

/** A failed receipt, or what of one a toast reads. */
interface Failure {
  readonly code?: string;
  readonly message: string;
  readonly details?: unknown;
}

/**
 * What a failed receipt says to a person: a refused write worded for them
 * ({@link personRefusal}, named from the page's graph, or by ids where no
 * page hosts the caller), anything else as its message.
 */
export function failureText(failure: Failure): string {
  const refusal = failure.code === "forbidden" ? writeRefusalOf(failure.details) : null;
  return refusal === null
    ? failure.message
    : personRefusal(
        refusal,
        refusalNames(currentService(BrowserHostService)?.graph.state().index ?? null),
      );
}
