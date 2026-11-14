/**
 * Mutation action layer — optimistic local tx → POST /api/action.
 */
import { ASSET_MAX_BYTES, personWriteRefusal } from "@kb/operations";
import { ulid } from "ulid";
import { z } from "zod";
import type { FrameViewKey, SortSpec, ViewConfig, ViewFilter } from "@kb/views";
import type { FieldType, KbNode, StoreTx } from "@kb/model";
import { oneWrite, runOptimistic } from "@/actions/optimistic";
import {
  planAddChild,
  planAddRootNode,
  planAddTag,
  planDefineField,
  planDefineTag,
  planDelete,
  planIndent,
  planInsertSibling,
  planMergeInto,
  planMergeWithPrevious,
  planMove,
  planMoveNodes,
  planNewQueryNode,
  planOutdent,
  planPinNode,
  planPrependChild,
  planRemoveTag,
  planSetProp,
  planSplit,
  planUnsetProp,
  planUpdateText,
  type FrameViewEdit,
  type PlannedMutation,
} from "@/actions/plan";
import {
  type PageWrites,
  pinnedRefIdsFor,
  type PropValue,
  type RefCreation,
  toast,
  WORKSPACE_ROOT_ID,
  captureTarget,
  failureText,
  personRefusal,
  refusalNames,
} from "@kb/ui-sdk";

/** `asset.upload` answers with the repo-relative path it stored the bytes at. */
const AssetUploadOutputSchema = z.object({ path: z.string() });
/** What `node.addTree` answers that a write reads: the ids it made, in tree order. */
const AddedTreeSchema = z.object({ ids: z.array(z.string()) });

/** A size in whole megabytes, as a toast says it. */
const mb = (bytes: number) => `${Math.round(bytes / (1024 * 1024))} MB`;

import { findParentWire } from "@/lib/tx";
import { restoreInvocations } from "@/actions/restore";
import type { ActionRequest, WireNode } from "@kb/contracts";
import { typeRefsOf, SYSTEM_IDS } from "@kb/model";
import { shownNodes, useGraphStore } from "@/stores/graph.store"; // GAP [[01M1RXMRB7AZB7DPFR6XBPBKQ9]]
import { pageRows } from "@/stores/page"; // GAP [[01M1RXMRB7AZB7DPFR6XBPBKQ9]]
import { pageEditor } from "@/stores/page-editor"; // GAP [[01M1RXMRB7AZB7DPFR6XBPBKQ9]]
import { invoke, invokeCoalesced, invokeLocal } from "@/session/runtime";

/** The page's editor's state now: where a write lands the caret. */
const editor = () => pageEditor().getState();

/**
 * Say why a block of several rows was not moved: only one run of siblings
 * moves as one. A row on its own that cannot move (the first row, a root)
 * is left without a word, as it always was.
 */
function toldNotARun(ids: readonly string[]): void {
  if (ids.length > 1) toast("Only rows next to each other under one parent move together");
}

function wire(): WireNode[] {
  return useGraphStore.getState().wireNodes;
}

/**
 * Whether the commit's own rule (`personWriteRefusal`) takes `tx`, asked
 * before a gesture whose earlier step would stay written if this, its
 * last, were refused: a view node is minted before its frame names it, and
 * an upload is made before the text that names it. Refused, it says why, as
 * the commit would. The same rule asked earlier, not a second one. A
 * gesture that is one write (a merge, `node.merge`) is one action instead,
 * and the commit decides it whole.
 */
function landsAhead(tx: StoreTx): boolean {
  const { index } = useGraphStore.getState();
  const refused = index === null ? null : personWriteRefusal(tx, index);
  if (refused !== null) toast(personRefusal(refused, refusalNames(index)));
  return refused === null;
}

/** The node as the page's index holds it: what a write ahead is asked of. */
function indexed(id: string): KbNode | undefined {
  return useGraphStore.getState().index?.getNode(id);
}

function recordHistory(preWire: WireNode[], plan: PlannedMutation): void {
  useGraphStore.getState().recordUndo({
    undo: restoreInvocations(wire(), preWire),
    redo: plan.actions,
  });
}

/**
 * The gesture being made (`together`): the actions its writes planned, in
 * order, sent as one write when it ends. Null while no gesture is open.
 */
let gesture: { actions: ActionRequest[] } | null = null;

async function invokeAll(actions: Array<{ id: string; input: unknown }>): Promise<boolean> {
  const localOnly = useGraphStore.getState().loadSource !== "api";
  for (const action of oneWrite(actions)) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- history is ordered for structural dependencies
    const receipt = localOnly ? await invokeLocal(action) : await invoke(action.id, action.input);
    if (receipt.status === "failed") {
      toast(failureText(receipt));
      return false;
    }
  }
  return true;
}

/**
 * Run `plan` as one write and record it as one undo step; inside a gesture
 * (`together`), add its actions to the gesture's instead, and answer that
 * it was taken.
 */
async function applyPlan(plan: PlannedMutation | null): Promise<boolean> {
  if (!plan) return false;
  if (gesture !== null) {
    gesture.actions.push(...plan.actions);
    return true;
  }
  const preWire = useGraphStore.getState().wireNodes;
  const result = await runOptimistic(plan);
  if (result.ok) recordHistory(preWire, plan);
  return result.ok;
}

/**
 * Write `edit` to the frame view node a frame is shown through, making one (filed in the
 * Views list) when the frame names none (`planEditFrameView`).
 */
async function editFrameView(frameId: string, edit: FrameViewEdit): Promise<void> {
  const { planEditFrameView } = await import("@/actions/plan");
  const newViewId = ulid();
  const plan = planEditFrameView(wire(), frameId, edit, newViewId);
  if (plan === null) {
    toast("There is no Views list to keep this frame's view in");
    return;
  }
  // A frame that names no view node gets one, then names it: ask the naming
  // first, so a refused one leaves no view node behind.
  const frame = indexed(frameId);
  if (plan.actions.length > 1 && frame !== undefined) {
    const views = {
      ...frame.props,
      [SYSTEM_IDS.viewsField]: [{ t: "ref" as const, v: newViewId }],
    };
    if (!landsAhead({ upserts: [{ ...frame, props: views }], deletes: [] })) return;
  }
  await applyPlan(plan);
}

/** The frame settings a frame's view node holds now. */
async function frameConfig(frameId: string): Promise<ViewConfig> {
  const { frameConfigOf, schemaOf } = await import("@kb/ui-sdk");
  return frameConfigOf(shownNodes().get(frameId), schemaOf(useGraphStore.getState()));
}

export const mutations: PageWrites = {
  async updateNodeContent(id: string, content: string): Promise<void> {
    const store = useGraphStore.getState();
    if (!store.wireNodes.some((node) => node.id === id)) return;

    const plan = planUpdateText(store.wireNodes, id, content);
    const action = plan.actions[0];
    if (action === undefined) return;
    // Each keystroke commits here; the lane pushes the last of a pause, in
    // its place among this tab's writes (`invokeCoalesced`).
    const receipt =
      store.loadSource === "api"
        ? (await invokeCoalesced(action, `text:${id}`)).receipt
        : await invokeLocal(action);
    if (receipt.status === "failed") toast(failureText(receipt));
  },

  async createNodeAfter(afterId: string): Promise<void> {
    await applyPlan(planInsertSibling(wire(), afterId, "after", ulid()));
  },

  async captureNode(text: string, newId?: string): Promise<boolean> {
    const id = newId ?? ulid();
    const parent = await captureTarget().catch(() => undefined);
    if (parent === undefined) {
      toast("Nothing answered where a new node goes, so it was not made");
      return false;
    }
    return applyPlan(
      parent === null ? planAddRootNode(text, id) : planAddChild(wire(), parent, id, text),
    );
  },

  async addChildNode(parentId: string, text: string, newId?: string): Promise<boolean> {
    const id = newId ?? ulid();
    return applyPlan(planAddChild(wire(), parentId, id, text));
  },

  async createEmptyNode(parentId: string, afterSiblingId: string | null): Promise<string | null> {
    const newId = ulid();
    let ok = false;
    if (parentId === WORKSPACE_ROOT_ID) {
      ok = await applyPlan(planAddRootNode("", newId));
    } else if (afterSiblingId !== null) {
      ok = await applyPlan(planInsertSibling(wire(), afterSiblingId, "after", newId));
    } else {
      ok = await applyPlan(planAddChild(wire(), parentId, newId, ""));
    }
    if (!ok) return null;
    // F4: single activation via runOptimistic — no post-await re-activation.
    return newId;
  },

  async createEmptyNodeBefore(beforeId: string): Promise<string | null> {
    const parent = findParentWire(wire(), beforeId);
    if (!parent) {
      return mutations.createEmptyNode(WORKSPACE_ROOT_ID, beforeId);
    }
    const siblings = parent.children;
    const idx = siblings.indexOf(beforeId);
    const prevSibling = idx > 0 ? (siblings[idx - 1] ?? null) : null;
    const newId = ulid();
    let plan: PlannedMutation | null;
    if (prevSibling !== null) {
      plan = planInsertSibling(wire(), prevSibling, "after", newId);
    } else {
      plan = planPrependChild(wire(), parent.id, newId);
    }
    const ok = await applyPlan(plan);
    if (!ok) return null;
    return newId;
  },
  async addTagField(tagId: string, fieldId: string): Promise<void> {
    const { planAddTagField } = await import("@/actions/plan");
    await applyPlan(planAddTagField(wire(), tagId, fieldId));
  },

  async removeTagField(tagId: string, fieldId: string): Promise<void> {
    const { planRemoveTagField } = await import("@/actions/plan");
    await applyPlan(planRemoveTagField(wire(), tagId, fieldId));
  },

  async setTagColor(tagId: string, color: string | null): Promise<void> {
    const { planSetTagColor } = await import("@/actions/plan");
    await applyPlan(planSetTagColor(wire(), tagId, color));
  },

  async setFieldHidden(fieldId: string, hidden: boolean): Promise<void> {
    const { planSetFieldHidden } = await import("@/actions/plan");
    await applyPlan(planSetFieldHidden(wire(), fieldId, hidden));
  },

  async setFieldType(fieldId: string, fieldType: FieldType): Promise<void> {
    const { planSetFieldType } = await import("@/actions/plan");
    await applyPlan(planSetFieldType(wire(), fieldId, fieldType));
  },

  async addFieldTargetTag(fieldId: string, tagId: string): Promise<void> {
    const { planAddFieldTargetTag } = await import("@/actions/plan");
    await applyPlan(planAddFieldTargetTag(wire(), fieldId, tagId));
  },

  async removeFieldTargetTag(fieldId: string, tagId: string): Promise<void> {
    const { planRemoveFieldTargetTag } = await import("@/actions/plan");
    await applyPlan(planRemoveFieldTargetTag(wire(), fieldId, tagId));
  },

  async setFieldTargetQuery(fieldId: string, edn: string | null): Promise<void> {
    const { planSetFieldTargetQuery } = await import("@/actions/plan");
    await applyPlan(planSetFieldTargetQuery(wire(), fieldId, edn));
  },

  async splitNode(id: string, cursor: number | "end"): Promise<void> {
    // Expanded set from the page's rows drives Tana first-child splits.
    const expandedIds = new Set<string>();
    for (const n of pageRows().values()) {
      if (!n.collapsed) expandedIds.add(n.id);
    }
    await applyPlan(planSplit(wire(), id, cursor, ulid(), { expandedIds }));
  },

  async deleteNode(id: string): Promise<boolean> {
    return applyPlan(planDelete(wire(), id));
  },

  async mergeNextIntoThis(thisId: string, nextId: string): Promise<void> {
    const plan = planMergeInto(wire(), nextId, thisId);
    if (!plan) return;
    await applyPlan(plan);
  },

  async mergeWithPrevious(id: string, previousId: string | null = null): Promise<void> {
    let plan: PlannedMutation | null = null;
    if (previousId !== null && previousId !== id) plan = planMergeInto(wire(), id, previousId);
    if (!plan) plan = planMergeWithPrevious(wire(), id);
    await applyPlan(plan);
  },

  async indentNodes(ids: readonly string[], cursor?: number): Promise<void> {
    const plan = planIndent(wire(), ids);
    if (!plan) {
      toldNotARun(ids);
      return;
    }
    if (!(await applyPlan(plan)) || gesture !== null) return;
    const [head] = ids;
    if (head === undefined) return;
    // D05: reveal the new parent chain before caret restore so the row is
    // guaranteed visible; focusSeq bump re-places the caret post-remount.
    editor().expandAncestors(head);
    // A row's own indent edits it where the page is being edited, under its
    // new parent; a block's leaves its selection to its caller.
    if (ids.length === 1) editor().activateNode(head, cursor ?? 0);
  },

  async outdentNodes(ids: readonly string[], cursor?: number): Promise<void> {
    const plan = planOutdent(wire(), ids);
    if (!plan) {
      toldNotARun(ids);
      return;
    }
    if (!(await applyPlan(plan)) || gesture !== null) return;
    const [head] = ids;
    if (head !== undefined && ids.length === 1) editor().activateNode(head, cursor ?? 0);
  },

  async moveNodesUp(ids: readonly string[]): Promise<void> {
    await applyPlan(planMove(wire(), ids, "up"));
  },

  async moveNodesDown(ids: readonly string[]): Promise<void> {
    await applyPlan(planMove(wire(), ids, "down"));
  },

  async moveNodes(ids, place, leaveReferences = false) {
    const references = leaveReferences ? ids.map(() => ulid()) : [];
    const plan = planMoveNodes(wire(), ids, place, references);
    if (plan === null || !(await applyPlan(plan))) return null;
    return { references };
  },

  async together<T>(made: () => Promise<T>): Promise<T> {
    // A gesture inside another is part of it.
    if (gesture !== null) return made();
    const open = { actions: [] as ActionRequest[] };
    gesture = open;
    let result: T;
    try {
      result = await made();
    } finally {
      gesture = null;
    }
    if (open.actions.length > 0) await applyPlan({ actions: open.actions });
    return result;
  },

  async undo(): Promise<boolean> {
    const entry = useGraphStore.getState().applyUndo();
    if (!entry) return false;
    return invokeAll(entry.undo);
  },

  async redo(): Promise<boolean> {
    const entry = useGraphStore.getState().applyRedo();
    if (!entry) return false;
    return invokeAll(entry.redo);
  },

  async updateProp(
    nodeId: string,
    fieldId: string,
    value: PropValue,
    oldValue?: PropValue,
  ): Promise<void> {
    await applyPlan(planSetProp(wire(), nodeId, fieldId, value, oldValue));
  },

  async removeProp(nodeId: string, fieldId: string, value?: PropValue): Promise<void> {
    await applyPlan(planUnsetProp(wire(), nodeId, fieldId, value));
  },

  async createRefTarget(creation: RefCreation, name: string): Promise<string | null> {
    const id = ulid();
    if (creation.kind === "child") {
      return (await mutations.addChildNode(creation.parentId, name, id)) ? id : null;
    }
    if (!(await mutations.captureNode(name, id))) return null;
    if (creation.kind === "tagged") await mutations.addTag(id, creation.tagId);
    return id;
  },

  async addTag(nodeId: string, tagId: string): Promise<void> {
    await applyPlan(planAddTag(wire(), nodeId, tagId));
  },

  async removeTag(nodeId: string, tagId: string): Promise<void> {
    await applyPlan(planRemoveTag(wire(), nodeId, tagId));
  },

  async defineField(name: string): Promise<string | null> {
    const newId = ulid();
    const ok = await applyPlan(planDefineField(name, newId));
    return ok ? newId : null;
  },

  async makeSupertag(nodeId: string): Promise<boolean> {
    const node = wire().find((n) => n.id === nodeId);
    if (typeRefsOf(node).includes(SYSTEM_IDS.tag)) return true;
    return applyPlan(planAddTag(wire(), nodeId, SYSTEM_IDS.tag));
  },

  async defineTag(name: string, parents?: readonly string[]): Promise<string | null> {
    const newId = ulid();
    const ok = await applyPlan(planDefineTag(name, newId, parents));
    return ok ? newId : null;
  },

  async togglePin(nodeId: string): Promise<boolean> {
    const pins = pinnedRefIdsFor(shownNodes(), nodeId);
    if (pins.length > 0) {
      // Every pin of the node goes, as one write.
      await mutations.together(() => Promise.all(pins.map((refId) => mutations.deleteNode(refId))));
      return true;
    }
    const plan = planPinNode(wire(), nodeId, ulid());
    if (plan === null) {
      toast("Pinned list is missing from this graph");
      return false;
    }
    return applyPlan(plan);
  },

  async uploadAsset(file: File): Promise<string | null> {
    const store = useGraphStore.getState();
    if (store.loadSource === "fixtures" || store.loadSource === null) {
      toast("Cannot upload assets without a live kb server");
      return null;
    }
    // Refused before it is read: reading and encoding a huge file would freeze the tab.
    if (file.size > ASSET_MAX_BYTES) {
      toast(
        `${file.name} is too large to store (${mb(file.size)}; at most ${mb(ASSET_MAX_BYTES)})`,
      );
      return null;
    }
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (const byte of buf) binary += String.fromCharCode(byte);
      const bytes = btoa(binary);
      const receipt = await invoke("asset.upload", {
        bytes,
        filename: file.name,
      });
      if (receipt.status === "failed") {
        toast(failureText(receipt));
        return null;
      }
      const out = AssetUploadOutputSchema.safeParse(receipt.output);
      if (!out.success) {
        toast("asset.upload returned no path");
        return null;
      }
      return out.data.path;
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err));
      return null;
    }
  },

  async addTree(tree, place) {
    const receipt = await invoke("node.addTree", { outline: tree, ...place });
    if (receipt.status === "failed") throw new Error(receipt.message);
    return AddedTreeSchema.parse(receipt.output).ids;
  },

  async attachFileToNode(nodeId: string, file: File): Promise<boolean> {
    // A node's text is a person's wherever the commit takes a write of the
    // node at all, so asking of it unchanged asks of its text: before the upload.
    const held = indexed(nodeId);
    if (held !== undefined && !landsAhead({ upserts: [held], deletes: [] })) return false;
    const path = await mutations.uploadAsset(file);
    if (path === null) return false;
    try {
      // The whole graph, not the projection: the row may be a reference whose
      // target sits outside the current scope, and its text must not be read
      // as empty and overwritten.
      const node = useGraphStore.getState().wireNodes.find((n) => n.id === nodeId);
      const alt = file.name.replace(/\.[^.]+$/, "") || "file";
      const md = `![${alt}](${path})`;
      const next =
        node === undefined || node.text.trim() === ""
          ? md
          : `${node.text}${node.text.endsWith("\n") ? "" : "\n"}${md}`;
      await mutations.updateNodeContent(nodeId, next);
      return true;
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err));
      return false;
    }
  },

  async newQueryNode(text = "New query"): Promise<string | null> {
    const newId = ulid();
    const ok = await applyPlan(planNewQueryNode(text, newId));
    return ok ? newId : null;
  },

  // ── ontology mutations (r5 core) ────────────────────────────────────────

  async defineOntology(name = "New ontology"): Promise<string | null> {
    const newId = ulid();
    const { planDefineOntology } = await import("@/actions/plan");
    const ok = await applyPlan(planDefineOntology(name, newId));
    return ok ? newId : null;
  },

  async ontologyAddInclude(ontoId: string, tagId: string): Promise<void> {
    const { planOntologyAddInclude } = await import("@/actions/plan");
    await applyPlan(planOntologyAddInclude(wire(), ontoId, tagId));
  },

  async ontologyRemoveInclude(ontoId: string, tagId: string): Promise<void> {
    const { planOntologyRemoveInclude } = await import("@/actions/plan");
    await applyPlan(planOntologyRemoveInclude(wire(), ontoId, tagId));
  },

  async ontologyAddMember(ontoId: string, nodeId: string): Promise<void> {
    const { planOntologyAddMember } = await import("@/actions/plan");
    await applyPlan(planOntologyAddMember(wire(), ontoId, nodeId));
  },

  async ontologyRemoveMember(ontoId: string, nodeId: string): Promise<void> {
    const { planOntologyRemoveMember } = await import("@/actions/plan");
    await applyPlan(planOntologyRemoveMember(wire(), ontoId, nodeId));
  },

  async ontologyExclude(ontoId: string, nodeId: string): Promise<void> {
    const { planOntologyExclude } = await import("@/actions/plan");
    await applyPlan(planOntologyExclude(wire(), ontoId, nodeId));
  },

  async ontologyUnexclude(ontoId: string, nodeId: string): Promise<void> {
    const { planOntologyUnexclude } = await import("@/actions/plan");
    await applyPlan(planOntologyUnexclude(wire(), ontoId, nodeId));
  },

  async ontologyAddExtends(ontoId: string, parentId: string): Promise<boolean> {
    const { planOntologyAddExtends } = await import("@/actions/plan");
    const plan = planOntologyAddExtends(wire(), ontoId, parentId);
    if (!plan) {
      toast("That would make an ontology extend itself");
      return false;
    }
    return applyPlan(plan);
  },

  async ontologyRemoveExtends(ontoId: string, parentId: string): Promise<void> {
    const { planOntologyRemoveExtends } = await import("@/actions/plan");
    await applyPlan(planOntologyRemoveExtends(wire(), ontoId, parentId));
  },

  async ontologySetQuery(ontoId: string, edn: string): Promise<void> {
    const { planOntologySetQuery } = await import("@/actions/plan");
    await applyPlan(planOntologySetQuery(wire(), ontoId, edn));
  },

  async ontologySetClosure(ontoId: string, mode: "none" | "descendants"): Promise<void> {
    const { planOntologySetClosure } = await import("@/actions/plan");
    await applyPlan(planOntologySetClosure(wire(), ontoId, mode));
  },

  async makeDefaultView(hostId: string, viewId: string): Promise<void> {
    const { planMakeDefaultView } = await import("@/actions/plan");
    await applyPlan(planMakeDefaultView(wire(), hostId, viewId));
  },

  async setFrameView(frameId: string, view: FrameViewKey): Promise<void> {
    const { frameViewIs } = await import("@/actions/plan");
    await editFrameView(frameId, frameViewIs(view.option));
  },

  async replaceField(nodeId: string, fieldId: string, values: PropValue[]): Promise<void> {
    const { planReplaceField } = await import("@/actions/plan");
    await applyPlan(planReplaceField(wire(), nodeId, fieldId, values));
  },

  // A frame's view settings are its frame view node's params: each edit
  // below writes that node (`editFrameView`), never the frame's own props.

  async setViewSort(frameId: string, sortSpecs: SortSpec[]): Promise<void> {
    const { frameViewSort } = await import("@/actions/plan");
    await editFrameView(frameId, frameViewSort(sortSpecs));
  },

  async toggleViewSort(frameId: string, fieldId: string): Promise<void> {
    const current = (await frameConfig(frameId)).sort;
    const existingIndex = current.findIndex((s) => s.fieldId === fieldId);

    let nextSort: SortSpec[];
    if (existingIndex === -1) {
      nextSort = [{ fieldId, dir: "asc" }, ...current];
    } else if (current[existingIndex]?.dir === "asc") {
      nextSort = current.map((s, i) => (i === existingIndex ? { ...s, dir: "desc" as const } : s));
    } else {
      nextSort = current.filter((s) => s.fieldId !== fieldId);
    }

    const { frameViewSort } = await import("@/actions/plan");
    await editFrameView(frameId, frameViewSort(nextSort));
  },

  async setViewDisplay(frameId: string, displayFieldIds: string[]): Promise<void> {
    const { frameViewDisplay } = await import("@/actions/plan");
    await editFrameView(frameId, frameViewDisplay(displayFieldIds));
  },

  async setColumnWidth(frameId: string, fieldId: string, widthPx: number): Promise<void> {
    const nextColwidth = { ...(await frameConfig(frameId)).colwidth, [fieldId]: widthPx };
    const { frameViewColwidth } = await import("@/actions/plan");
    await editFrameView(frameId, frameViewColwidth(nextColwidth));
  },

  async setViewPagesize(frameId: string, pagesize: number): Promise<void> {
    const { frameViewPagesize } = await import("@/actions/plan");
    await editFrameView(frameId, frameViewPagesize(pagesize));
  },

  async setViewGroup(frameId: string, fieldId: string | null): Promise<void> {
    const { frameViewGroup } = await import("@/actions/plan");
    await editFrameView(frameId, frameViewGroup(fieldId));
  },

  async addViewFilter(frameId: string, filter: ViewFilter): Promise<void> {
    const next = [...(await frameConfig(frameId)).filters, filter];
    const { frameViewFilters } = await import("@/actions/plan");
    await editFrameView(frameId, frameViewFilters(next));
  },

  async removeViewFilter(frameId: string, filter: ViewFilter): Promise<void> {
    const { serializeViewFilter } = await import("@kb/views");
    const gone = serializeViewFilter(filter);
    const next = (await frameConfig(frameId)).filters.filter(
      (f) => serializeViewFilter(f) !== gone,
    );
    const { frameViewFilters } = await import("@/actions/plan");
    await editFrameView(frameId, frameViewFilters(next));
  },

  async moveBoardCard(
    nodeId: string,
    fieldId: string,
    oldValue: PropValue | null,
    newValue: PropValue | null,
  ): Promise<void> {
    const { planMoveBoardCard } = await import("@/actions/plan");
    await applyPlan(planMoveBoardCard(wire(), nodeId, fieldId, oldValue, newValue));
  },
};
