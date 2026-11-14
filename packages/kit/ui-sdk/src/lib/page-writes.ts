/**
 * The page's one write path (DESIGN-UI.md → Mutations): every write a
 * surface makes to the graph, each an optimistic local write the server then
 * confirms, recorded for undo. The shell implements it (`actions/mutations`)
 * and the page's `BrowserHost` carries it (`writes`), so a feature's UI
 * writes through the same path as the shell's own surfaces, and a test host
 * stands in for it.
 *
 * A write that cannot be made says why itself (a toast) and resolves; none
 * rejects for a refusal.
 */
import type { FieldType } from "@kb/model";
import type { FrameViewKey, SortSpec, ViewFilter } from "@kb/views";
import type { RefCreation } from "./refs";
import type { PropValue } from "./types";

/** Where moved rows land: under `parent` (null: the top level), after the sibling `after` (null: first; absent: at the end). */
export interface MovePlace {
  readonly parent: string | null;
  readonly after?: string | null;
}

export interface PageWrites {
  /** Local text action first; coalesce its ordered remote confirmation. */
  readonly updateNodeContent: (id: string, content: string) => Promise<void>;
  readonly createNodeAfter: (afterId: string) => Promise<void>;
  /**
   * Add a node made with no chosen place (⌘K "Add node" with nothing
   * selected, a picker's new top-level target): it goes under the capture
   * target (`captureTarget`), the top level when no family provides one.
   */
  readonly captureNode: (text: string, newId?: string) => Promise<boolean>;
  readonly addChildNode: (parentId: string, text: string, newId?: string) => Promise<boolean>;
  /**
   * Mint a real empty node at once (root, first child, or after sibling)
   * and activate it at offset 0, through the plan's focus. Returns its id,
   * or null when refused. Whether an empty minted row is pruned when focus
   * leaves it is the editor's rule, not the write's (the outline's
   * `createTransientNode`, r1 §3.3).
   */
  readonly createEmptyNode: (
    parentId: string,
    afterSiblingId: string | null,
  ) => Promise<string | null>;
  /** Mint an empty sibling directly ABOVE the anchor and activate it ('O' key). */
  readonly createEmptyNodeBefore: (beforeId: string) => Promise<string | null>;
  readonly addTagField: (tagId: string, fieldId: string) => Promise<void>;
  readonly removeTagField: (tagId: string, fieldId: string) => Promise<void>;
  readonly setTagColor: (tagId: string, color: string | null) => Promise<void>;
  readonly setFieldHidden: (fieldId: string, hidden: boolean) => Promise<void>;
  readonly setFieldType: (fieldId: string, fieldType: FieldType) => Promise<void>;
  readonly addFieldTargetTag: (fieldId: string, tagId: string) => Promise<void>;
  readonly removeFieldTargetTag: (fieldId: string, tagId: string) => Promise<void>;
  readonly setFieldTargetQuery: (fieldId: string, edn: string | null) => Promise<void>;
  readonly splitNode: (id: string, cursor: number | "end") => Promise<void>;
  /**
   * Delete the node and its subtree. Answers whether it landed: false when
   * the commit refused it, so a caller that moves the selection or the caret
   * past the row moves it only when the row went.
   */
  readonly deleteNode: (id: string) => Promise<boolean>;
  /**
   * Merge the next row into this one (Delete at the end of a row).
   */
  readonly mergeNextIntoThis: (thisId: string, nextId: string) => Promise<void>;
  /**
   * Backspace-merge: into `previousId`, the node its caller draws directly
   * above (r1 D09), else into the previous node of the graph.
   */
  readonly mergeWithPrevious: (id: string, previousId?: string | null) => Promise<void>;
  /**
   * Tab-indent a block: `ids`, one run of siblings in order (a row is a
   * block of one), under the sibling before it. The target parent is
   * auto-expanded BEFORE focus restore so the reparented row never vanishes
   * into a collapsed container (r1 D05), and the caret returns to its exact
   * character offset in the block's first row (spec §3.1). A block that is
   * not one run of siblings is told so and left.
   */
  readonly indentNodes: (ids: readonly string[], cursor?: number) => Promise<void>;
  /** Shift+Tab outdent a block, after its parent; the caret stays at its exact offset (spec §3.1). */
  readonly outdentNodes: (ids: readonly string[], cursor?: number) => Promise<void>;
  /** Move a block one step up: the sibling above it goes below it. */
  readonly moveNodesUp: (ids: readonly string[]) => Promise<void>;
  /** Move a block one step down: the sibling below it goes above it. */
  readonly moveNodesDown: (ids: readonly string[]) => Promise<void>;
  /**
   * Move rows anywhere (DESIGN-UI.md → Outline editor, "A row moves
   * anywhere"): `ids`, in order, under `place.parent`, after `place.after`
   * (null: first; absent: at the end), as one write. With
   * `leaveReferences`, a reference to each row stays where it was. Answers
   * the references made, or null when nothing moved (the place is under a
   * row moved, or the rows are there already).
   */
  readonly moveNodes: (
    ids: readonly string[],
    place: MovePlace,
    leaveReferences?: boolean,
  ) => Promise<{ readonly references: readonly string[] } | null>;
  /**
   * Make the writes `gesture` makes one write (DESIGN-UI.md → Outline
   * editor, "A selection is a range of rows"): each is planned when it is
   * made, against the graph as the gesture found it, and they are sent
   * together as one `node.batch` call when it ends, recorded as one undo
   * step. A write inside answers that it was taken (`true`, or the id it
   * will make) before it lands; the batch says why if it is refused. Only
   * the writes the gesture waits for are part of it, and a `together`
   * inside another is part of the outer one.
   */
  readonly together: <T>(gesture: () => Promise<T>) => Promise<T>;
  /** D19: undo through inverse invocations of the same shared actions. */
  readonly undo: () => Promise<boolean>;
  /** D19: redo the last undone mutation. */
  readonly redo: () => Promise<boolean>;
  readonly updateProp: (
    nodeId: string,
    fieldId: string,
    value: PropValue,
    oldValue?: PropValue,
  ) => Promise<void>;
  readonly removeProp: (nodeId: string, fieldId: string, value?: PropValue) => Promise<void>;
  /**
   * Mint a node a ref field may point at, named `name`, where the field's
   * declaration says a new target goes (`refCreationOf`): a child of the
   * field for an option, a node carrying the field's target tag, or a
   * top-level node for an open field. Returns its id, or null when refused.
   */
  readonly createRefTarget: (creation: RefCreation, name: string) => Promise<string | null>;
  readonly addTag: (nodeId: string, tagId: string) => Promise<void>;
  readonly removeTag: (nodeId: string, tagId: string) => Promise<void>;
  readonly defineField: (name: string) => Promise<string | null>;
  /**
   * Promote an existing node to a supertag.
   *
   * `sys.f.type` is the kind slot and it is multi-valued, so this appends the
   * `sys.tag` kind and leaves any tags the node already carries alone. Note
   * the consequence, which is the model's and not this function's: a tag node
   * is schema, so `forestRootIds` stops listing it in the outline forest. The
   * caller is responsible for taking the user to it.
   */
  readonly makeSupertag: (nodeId: string) => Promise<boolean>;
  /**
   * Mint a tag called `name`, extending `parents` in order (`sys.f.extends`),
   * as one write: its id, or null when the write did not land.
   */
  readonly defineTag: (name: string, parents?: readonly string[]) => Promise<string | null>;
  /**
   * Pin / unpin a node for the sidebar's Pinned section.
   *
   * Pinning is *listing* (see lib/pinned): the toggle adds or removes a
   * contextual reference under the seeded `pinned` node, and nothing here is
   * bespoke — `node.add` with one ref prop, `deleteNode` for the row.
   *
   * Nothing is written to the target, so pinning a system node writes no
   * system node: pointing a reference at one is the person's.
   */
  readonly togglePin: (nodeId: string) => Promise<boolean>;
  /**
   * W6a: store a file's bytes as an asset through `asset.upload`, the one
   * way bytes enter `.kb/assets/`; the `assets/…` path that markdown and a
   * canvas image both reference it by, or null (told by a toast) when it
   * could not be stored.
   */
  readonly uploadAsset: (file: File) => Promise<string | null>;
  /**
   * W6a: upload a file (`uploadAsset`), then append `![alt](assets/…)`
   * markdown to the node text.
   */
  readonly attachFileToNode: (nodeId: string, file: File) => Promise<boolean>;
  /**
   * Add a tree of nodes, written as outline paste text (DESIGN.md → Outline
   * paste), through `node.addTree`, in one transaction: under `parent` (null,
   * the top level) at `position` (omitted, the end). The ids it made, in tree
   * order; a write that fails rejects with what failed.
   */
  readonly addTree: (
    tree: string,
    place: { readonly parent: string | null; readonly position?: number },
  ) => Promise<readonly string[]>;
  /** W4: root node tagged #query with a starter sys.f.query definition. */
  readonly newQueryNode: (text?: string) => Promise<string | null>;
  /** Mint an ontology node (#ontology) and return its id. */
  readonly defineOntology: (name?: string) => Promise<string | null>;
  readonly ontologyAddInclude: (ontoId: string, tagId: string) => Promise<void>;
  readonly ontologyRemoveInclude: (ontoId: string, tagId: string) => Promise<void>;
  readonly ontologyAddMember: (ontoId: string, nodeId: string) => Promise<void>;
  readonly ontologyRemoveMember: (ontoId: string, nodeId: string) => Promise<void>;
  /** Veto a node; drops a matching pin in the same plan. */
  readonly ontologyExclude: (ontoId: string, nodeId: string) => Promise<void>;
  readonly ontologyUnexclude: (ontoId: string, nodeId: string) => Promise<void>;
  /** Refuses (and says so) when the edge would close an extends cycle. */
  readonly ontologyAddExtends: (ontoId: string, parentId: string) => Promise<boolean>;
  readonly ontologyRemoveExtends: (ontoId: string, parentId: string) => Promise<void>;
  readonly ontologySetQuery: (ontoId: string, edn: string) => Promise<void>;
  readonly ontologySetClosure: (ontoId: string, mode: "none" | "descendants") => Promise<void>;
  /** Make `viewId` `hostId`'s default view: move it first in the host's `sys.f.views`. */
  readonly makeDefaultView: (hostId: string, viewId: string) => Promise<void>;
  /** Show a frame's children in `view`: its frame view node names the view's option. */
  readonly setFrameView: (frameId: string, view: FrameViewKey) => Promise<void>;
  readonly replaceField: (nodeId: string, fieldId: string, values: PropValue[]) => Promise<void>;
  readonly setViewSort: (frameId: string, sortSpecs: SortSpec[]) => Promise<void>;
  readonly toggleViewSort: (frameId: string, fieldId: string) => Promise<void>;
  readonly setViewDisplay: (frameId: string, displayFieldIds: string[]) => Promise<void>;
  readonly setColumnWidth: (frameId: string, fieldId: string, widthPx: number) => Promise<void>;
  readonly setViewPagesize: (frameId: string, pagesize: number) => Promise<void>;
  readonly setViewGroup: (frameId: string, fieldId: string | null) => Promise<void>;
  readonly addViewFilter: (frameId: string, filter: ViewFilter) => Promise<void>;
  readonly removeViewFilter: (frameId: string, filter: ViewFilter) => Promise<void>;
  readonly moveBoardCard: (
    nodeId: string,
    fieldId: string,
    oldValue: PropValue | null,
    newValue: PropValue | null,
  ) => Promise<void>;
}
