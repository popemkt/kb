/**
 * The outline's own node-palette steps, contributed through
 * `PaletteStepPoint` as any family's are: add or remove a tag, add or set a
 * field, turn a row into a reference, move rows to another node. A step a
 * command that acts on many opens writes its pick to every row it is about
 * (`targetNodeIds`) as one write (`asOneWrite`), what it mints made once. They are the same gesture over different node kinds, and
 * the same gesture as every other node picker (lib/picker): only the
 * candidate source, whether a new one may be minted, and the write vary. A
 * reference draws its candidates from `nodeCandidates`, the source the `[[`
 * autocomplete and the field picker share.
 */
import { ArrowBendDownRightIcon, HashIcon, LinkSimpleIcon, TextTIcon } from "@phosphor-icons/react";
import type { WireNode } from "@kb/contracts";
import type { ContributionEntry } from "@kb/plugin";
import {
  asOneWrite,
  browserHost,
  emptyValueForType,
  nodeCandidates,
  type NodeMap,
  type PaletteStep,
  type PickerCandidate,
  resolveFieldTypeById,
  selectionRoots,
} from "@kb/ui-sdk";
import { outlineNodes, useOutlineStore } from "./outline.store";
import { moveRows } from "./row-moves";
import { expandReference, removeReference } from "./reference-steps";
import { declaresOptionSet, isSysPrefixed, SYSTEM_IDS, typeRefsOf } from "@kb/model";

/**
 * Nodes whose kind slot points at `kind`, by name: the tags (`sys.tag`) the
 * add-tag step offers, the fields (`sys.field`) the add-field step offers,
 * and the same candidates wherever else a tag or a field is picked.
 */
export function nodesOfKind(wireNodes: readonly WireNode[], kind: string): PickerCandidate[] {
  return wireNodes
    .filter((n) => (n.props[SYSTEM_IDS.typeField] ?? []).some((v) => v.t === "ref" && v.v === kind))
    .map((n) => ({ id: n.id, label: n.text || n.id }))
    .toSorted((a, b) => a.label.localeCompare(b.label));
}

export const addTag: PaletteStep = {
  label: "Add tag",
  placeholder: "Search or name a tag...",
  icon: <HashIcon size={12} weight="bold" />,
  createLabel: (name) => `Create tag "${name}"`,
  candidates: (graph) => nodesOfKind(graph.wireNodes, SYSTEM_IDS.tag),
  commit: async ({ targetNodeIds, pickedId, creating, name }) => {
    const { writes } = browserHost();
    await asOneWrite(targetNodeIds, async () => {
      const tagId = creating ? await writes.defineTag(name) : pickedId;
      if (tagId !== null) await Promise.all(targetNodeIds.map((id) => writes.addTag(id, tagId)));
    });
  },
};

/** The tags the rows carry, by id: their kind slot, less the kinds themselves. */
function tagsCarried(wireNodes: readonly WireNode[], rows: readonly string[]): Set<string> {
  const held = new Set(rows);
  return new Set(
    wireNodes
      .filter((n) => held.has(n.id))
      .flatMap((n) => typeRefsOf(n).filter((id) => !isSysPrefixed(id))),
  );
}

const removeTag: PaletteStep = {
  label: "Remove tag",
  placeholder: "Search the tags these carry...",
  icon: <HashIcon size={12} weight="regular" />,
  candidates: (graph) => {
    const carried = tagsCarried(graph.wireNodes, graph.targetNodeIds);
    return nodesOfKind(graph.wireNodes, SYSTEM_IDS.tag).filter((tag) => carried.has(tag.id));
  },
  commit: async ({ targetNodeIds, pickedId }) => {
    const { writes } = browserHost();
    const graph = browserHost().graph.state().wireNodes;
    const carrying = targetNodeIds.filter((id) => tagsCarried(graph, [id]).has(pickedId));
    await asOneWrite(carrying, () =>
      Promise.all(carrying.map((id) => writes.removeTag(id, pickedId))),
    );
  },
};

export const addField: PaletteStep = {
  label: "Add field",
  placeholder: "Search or name a field...",
  icon: <TextTIcon size={12} weight="bold" />,
  createLabel: (name) => `Create field "${name}"`,
  candidates: (graph) => nodesOfKind(graph.wireNodes, SYSTEM_IDS.field),
  commit: async ({ targetNodeIds, schema, pickedId, creating, name }) => {
    const { writes } = browserHost();
    await asOneWrite(targetNodeIds, async () => {
      const fieldId = creating ? await writes.defineField(name) : pickedId;
      if (fieldId === null) return;
      // An empty typed value is what makes the row appear and focusable; the
      // field's own declared type decides which editor that row gets.
      const empty = emptyValueForType(resolveFieldTypeById(fieldId, schema));
      await Promise.all(targetNodeIds.map((id) => writes.updateProp(id, fieldId, empty)));
    });
  },
};

/**
 * Every option of every field that declares an option set, as "field:
 * option": what Set field offers. An option is its field's child, so the
 * option picked names its field.
 */
function fieldOptions(wireNodes: readonly WireNode[]): PickerCandidate[] {
  const byId = new Map(wireNodes.map((n) => [n.id, n]));
  return nodesOfKind(wireNodes, SYSTEM_IDS.field).flatMap((field) => {
    const node = byId.get(field.id);
    if (!declaresOptionSet(node)) return [];
    return (node?.children ?? []).flatMap((optionId) => {
      const option = byId.get(optionId);
      return option === undefined
        ? []
        : [{ id: optionId, label: `${field.label}: ${option.text || optionId}` }];
    });
  });
}

// GAP [[01M7CY0205F8GSDTNMSSG35S97]]: only fields that declare an option set.
const setField: PaletteStep = {
  label: "Set field",
  placeholder: "Search a field's options...",
  icon: <TextTIcon size={12} weight="regular" />,
  candidates: (graph) => fieldOptions(graph.wireNodes),
  commit: async ({ targetNodeIds, pickedId }) => {
    const { writes, graph } = browserHost();
    const field = graph.state().wireNodes.find((n) => n.children.includes(pickedId));
    if (field === undefined) return;
    // A field that holds one value has it replaced; one that holds many gains it.
    const value = { t: "ref", v: pickedId } as const;
    await asOneWrite(targetNodeIds, () =>
      Promise.all(targetNodeIds.map((id) => writes.updateProp(id, field.id, value))),
    );
  },
};

const addRef: PaletteStep = {
  label: "Reference a node",
  placeholder: "Search for a node to reference...",
  icon: <LinkSimpleIcon size={12} weight="bold" />,
  // A reference to itself is not a reference.
  candidates: (graph) => nodeCandidates(graph.nodes, { exclude: (id) => id === graph.anchorId }),
  limit: 12,
  commit: async ({ targetNodeId, pickedId }) => {
    // The whole creation gesture, and nothing but existing primitives: point
    // the target field at the picked node. The field is the kind.
    await browserHost().writes.updateProp(targetNodeId, SYSTEM_IDS.refTargetField, {
      t: "ref",
      v: pickedId,
    });
  },
};

/** Whether `id` is one of `rows` or under one of them: where no row of them can move. */
function within(nodes: NodeMap, rows: ReadonlySet<string>, id: string): boolean {
  const seen = new Set<string>();
  for (
    let at: string | null = id;
    at !== null && !seen.has(at);
    at = nodes.get(at)?.parentId ?? null
  ) {
    if (rows.has(at)) return true;
    seen.add(at);
  }
  return false;
}

/**
 * Move to… (DESIGN-UI.md → Outline editor, "A row moves anywhere"): the
 * rows go to the end of the node picked; picked with Alt, each leaves a
 * reference where it was. One write, through the outline's one move.
 */
const moveTo: PaletteStep = {
  label: "Move to",
  placeholder: "Search for where to move it...",
  icon: <ArrowBendDownRightIcon size={12} weight="bold" />,
  alternate: "leave a reference",
  candidates: (graph) => {
    const rows = new Set(graph.targetNodeIds);
    return nodeCandidates(graph.nodes, { exclude: (id) => within(graph.nodes, rows, id) });
  },
  limit: 12,
  commit: async ({ targetNodeIds, pickedId, alternate }) => {
    const store = useOutlineStore.getState();
    const drawn = store.selectedRows();
    const firstKey =
      drawn[0]?.instanceKey ?? store.activeInstanceKey ?? store.selectedInstanceKey ?? "";
    const lastKey = drawn.at(-1)?.instanceKey ?? firstKey;
    const ids = selectionRoots(targetNodeIds, outlineNodes());
    await moveRows(ids, { firstKey, lastKey }, { parent: pickedId }, alternate);
  },
};

/**
 * The outline's steps. Each is opened by its id in the outline's namespace,
 * `outline.add-tag` and so on, as any contribution is named.
 */
export const OUTLINE_STEPS: readonly ContributionEntry<PaletteStep>[] = [
  { id: "add-tag", value: addTag },
  { id: "remove-tag", value: removeTag },
  { id: "add-field", value: addField },
  { id: "set-field", value: setField },
  { id: "add-ref", value: addRef },
  { id: "move-to", value: moveTo },
  { id: "expand-reference", value: expandReference },
  { id: "remove-reference", value: removeReference },
];
