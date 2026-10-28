/**
 * An item changed in place, by its id (DESIGN.md → Canvas documents → Agent
 * verbs, `edit`): what tldraw's `updateShapes`, `deleteShapes`,
 * `translateShapes` and `moveShapesToPage` do, as pure functions over the
 * document, through the code the page's own gestures go through — the
 * nudge (`nudgeItems`), the delete (`deleteItems`), the link, flag, colour
 * and look writers — so an agent's edit and a person's are one edit.
 */
import { canvasColor, withStyle, type CanvasLooksPatch } from "./style.ts";
import {
  isGroupNode,
  isKbNode,
  isShapeNode,
  isTextNode,
  withFlag,
  type CanvasDoc,
  type CanvasNode,
} from "./doc.ts";
import { dropExtra } from "./extra.ts";
import { withLink, type CanvasItemLink } from "./links.ts";
import {
  carriedBy,
  deleteItems,
  editItem,
  freeItems,
  settleMembership,
  transformCarried,
  withMembers,
} from "./membership.ts";
import { CanvasRelationError } from "./relations.ts";
import type { CanvasVec } from "./box.ts";
import { moveBy, selectionPivot, withBox } from "./transform.ts";

/**
 * Throws unless every one of `ids` is an item of `doc` that an act may take
 * (`freeItems`): the one refusal every verb that moves, lays out or deletes
 * items makes, naming what is missing or locked.
 */
export function requireItems(doc: CanvasDoc, ids: readonly string[]): void {
  const missing = ids.filter((id) => !doc.nodes.some((node) => node.id === id));
  if (missing.length > 0) {
    throw new CanvasRelationError(`no item ${missing.join(", ")} on this canvas`);
  }
  const free = freeItems(doc.nodes, ids);
  const locked = ids.filter((id) => !free.has(id));
  if (locked.length > 0) {
    throw new CanvasRelationError(
      `${locked.join(", ")} is locked; unlock it (edit with locked: false) to change it`,
    );
  }
}

/**
 * `doc` with the items `ids` moved by `by`, as the arrow keys nudge a
 * selection: the one move every other move is, its groups' members carried
 * along, and each item it lets go of belonging to the frame that holds it
 * there. Items an act may not take (`freeItems`) stay.
 */
export function nudgeItems(doc: CanvasDoc, ids: Iterable<string>, by: CanvasVec): CanvasDoc {
  const carried = carriedBy(doc.nodes, ids);
  const moved = transformCarried(doc, carried, moveBy(selectionPivot(carried.items), by));
  return settleMembership(
    moved,
    carried.items.map((item) => item.id),
  );
}

/**
 * What an edit changes on one item; an absent key is left as it is. `null`
 * takes a value away. Words, looks, link, node and lock are what the
 * inspector edits on a locked item too; its size is where it stands, so a
 * locked item keeps it.
 */
export interface CanvasItemPatch {
  /** Its words: a text card's text, a shape's or a frame's label. */
  readonly text?: string;
  /** A palette name, a preset or a hex (`canvasColor`); null, its kind's own. */
  readonly color?: string | null;
  /** Its looks beyond its colour (`withStyle`); a look set to undefined is its default. */
  readonly style?: CanvasLooksPatch;
  /** Where it leads (`withLink`); null, nowhere. */
  readonly link?: CanvasItemLink | null;
  readonly locked?: boolean;
  /** The node it stands for; null, none (a card always stands for one). */
  readonly nodeId?: string | null;
  /** Its size, its top left kept (`withBox`). */
  readonly width?: number;
  readonly height?: number;
}

/** `item` with its words set: a text card's text, a shape's or a frame's label. */
function withWords(item: CanvasNode, text: string): CanvasNode {
  if (isTextNode(item)) return { ...dropExtra(item, "text"), text };
  if (isShapeNode(item) || isGroupNode(item)) return { ...dropExtra(item, "label"), label: text };
  throw new CanvasRelationError(
    `${item.id} shows no words of its own${item.nodeId === undefined ? "" : `: its words are its node ${item.nodeId}'s`}`,
  );
}

/** `item` with its colour set, or its kind's own when `color` is null. */
function withColor(item: CanvasNode, color: string | null): CanvasNode {
  const next = dropExtra({ ...item }, "color");
  if (color === null) delete next.color;
  else next.color = canvasColor(color);
  return next;
}

/** `item` standing for `nodeId`, or for none when it is null. */
function withNode(item: CanvasNode, nodeId: string | null): CanvasNode {
  if (nodeId !== null) return { ...dropExtra(item, "nodeId"), nodeId };
  if (isKbNode(item)) throw new CanvasRelationError(`${item.id} is a card: it always shows a node`);
  const next = dropExtra({ ...item }, "nodeId");
  delete next.nodeId;
  return next;
}

/** `item` with `patch` applied, field by field, in the order the patch type lists them. */
export function patchItem(item: CanvasNode, patch: CanvasItemPatch): CanvasNode {
  let next = item;
  if (patch.text !== undefined) next = withWords(next, patch.text);
  if (patch.color !== undefined) next = withColor(next, patch.color);
  if (patch.style !== undefined) next = withStyle(next, patch.style);
  if (patch.link !== undefined) next = withLink(next, patch.link ?? undefined);
  if (patch.locked !== undefined) next = withFlag(next, "locked", patch.locked);
  if (patch.nodeId !== undefined) next = withNode(next, patch.nodeId);
  if (patch.width !== undefined || patch.height !== undefined) {
    if (item.locked === true) {
      throw new CanvasRelationError(`${item.id} is locked; its size is held with it`);
    }
    next = withBox(next, {
      x: next.x,
      y: next.y,
      width: Math.max(1, patch.width ?? next.width),
      height: Math.max(1, patch.height ?? next.height),
    });
  }
  return next;
}

/** One change an edit makes, by id. */
export type CanvasEdit =
  /** Item `update` changed as `set` says (`patchItem`). */
  | { readonly update: string; readonly set: CanvasItemPatch }
  /** Items `move` nudged by `by` (`nudgeItems`). */
  | { readonly move: readonly string[]; readonly by: CanvasVec }
  /** Items and edges `delete` taken away: an item with its members and the edges that meet them. */
  | { readonly delete: readonly string[] };

/**
 * `doc` with `edit` made. Refuses an id the document does not hold, and a
 * move or delete of an item that is locked (`requireItems`).
 */
export function editCanvas(doc: CanvasDoc, edit: CanvasEdit): CanvasDoc {
  if ("update" in edit) {
    const item = doc.nodes.find((node) => node.id === edit.update);
    if (item === undefined) throw new CanvasRelationError(`no item ${edit.update} on this canvas`);
    return editItem(doc, patchItem(item, edit.set));
  }
  if ("move" in edit) {
    requireItems(doc, edit.move);
    return nudgeItems(doc, edit.move, edit.by);
  }
  const edges = new Set(doc.edges.map((edge) => edge.id));
  const items = edit.delete.filter((id) => !edges.has(id));
  requireItems(doc, items);
  const left = deleteItems(doc, items);
  return { ...left, edges: left.edges.filter((edge) => !edit.delete.includes(edge.id)) };
}

/** What `takeItems` takes off a canvas: the items with their members, and the edges among them. */
export interface CanvasTaken {
  readonly left: CanvasDoc;
  readonly nodes: readonly CanvasNode[];
  readonly edges: CanvasDoc["edges"];
}

/**
 * The items `ids` taken off `doc` with every member below them and the
 * edges that run among what is taken — what moving them to another page
 * carries. An edge to an item left behind is taken away with them, as a
 * delete takes it. Refuses a missing or locked item (`requireItems`).
 */
export function takeItems(doc: CanvasDoc, ids: readonly string[]): CanvasTaken {
  requireItems(doc, ids);
  const taken = withMembers(doc.nodes, ids);
  const nodes = doc.nodes.flatMap((node) => {
    if (!taken.has(node.id)) return [];
    // A taken item whose frame stays behind belongs to the page it lands on.
    if (node.parent !== undefined && !taken.has(node.parent)) {
      const loose = { ...node };
      delete loose.parent;
      return [loose];
    }
    return [node];
  });
  const meets = (edge: CanvasDoc["edges"][number]) =>
    taken.has(edge.fromNode) || taken.has(edge.toNode);
  const among = (edge: CanvasDoc["edges"][number]) =>
    taken.has(edge.fromNode) && taken.has(edge.toNode);
  return {
    left: {
      ...doc,
      nodes: doc.nodes.filter((node) => !taken.has(node.id)),
      edges: doc.edges.filter((edge) => !meets(edge)),
    },
    nodes,
    edges: doc.edges.filter(among),
  };
}

/**
 * `doc` with what `takeItems` took written onto it, where it stood; an id
 * this page already holds is refused, since two items of one id would be
 * one item.
 */
export function landItems(doc: CanvasDoc, taken: Pick<CanvasTaken, "nodes" | "edges">): CanvasDoc {
  const held = new Set([...doc.nodes.map((node) => node.id), ...doc.edges.map((edge) => edge.id)]);
  const clash = [
    ...taken.nodes.map((node) => node.id),
    ...taken.edges.map((edge) => edge.id),
  ].filter((id) => held.has(id));
  if (clash.length > 0) {
    throw new CanvasRelationError(`the page already holds ${clash.join(", ")}`);
  }
  return {
    ...doc,
    nodes: [...doc.nodes, ...taken.nodes],
    edges: [...doc.edges, ...taken.edges],
  };
}
