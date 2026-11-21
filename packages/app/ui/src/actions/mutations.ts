/**
 * Mutation action layer — optimistic local tx → POST /api/action.
 */
import { ASSET_MAX_BYTES, personWriteRefusal } from "@kb/operations";
import { ulid } from "ulid";
import { z } from "zod";
import type { FrameViewKey, SortSpec, ViewConfig, ViewFilter } from "@kb/views";
import type { FieldType, KbNode, StoreTx, Writable } from "@kb/model";
import { oneWrite, runOptimistic, type RunOptimisticResult } from "@/actions/optimistic";
import {
  planAddChild,
  planAddMatching,
  planAddRootNode,
  planAddTag,
  planDefineField,
  planDefineTag,
  planDelete,
  planIndent,
  planInitializeProp,
  planInsertSibling,
  planMergeInto,
  planMergeWithPrevious,
  planMove,
  planMoveNodes,
  planNewQueryNode,
  planOutdent,
  planPinNode,
  planRemoveTag,
  planSetProp,
  planSplit,
  planToggleChecks,
  planUnsetProp,
  planUpdateText,
  type BlockStays,
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
/** `node.add`'s answer, as far as a matching add reads it. */
const AddedSchema = z.object({ unmet: z.number().optional() });

/** A size in whole megabytes, as a toast says it. */
const mb = (bytes: number) => `${Math.round(bytes / (1024 * 1024))} MB`;

import { restoreInvocations } from "@/actions/restore";
import type { ActionRequest, WireNode } from "@kb/contracts";
import { typeRefsOf, SYSTEM_IDS } from "@kb/model";
import { shownNodes, useGraphStore } from "@/stores/graph.store"; // GAP [[01M1RXMRB7AZB7DPFR6XBPBKQ9]]
import { pageRows } from "@/stores/page"; // GAP [[01M1RXMRB7AZB7DPFR6XBPBKQ9]]
import { pageEditor } from "@/stores/page-editor"; // GAP [[01M1RXMRB7AZB7DPFR6XBPBKQ9]]
import { invoke, invokeCoalesced, invokeLocal, invokeSettled } from "@/session/runtime";

/** The page's editor's state now: where a write lands the caret. */
const editor = () => pageEditor().getState();

/** What a person is told when a block of rows stays where it is, by why (`BlockStays`). */
const BLOCK_STAYS: Readonly<Record<BlockStays["stays"], string>> = {
  "not-a-run": "Only rows next to each other under one parent move together",
  "no-row-above": "The first row has no row above it to move under",
  "no-parent": "Top-level rows have no parent to move out of",
};

/**
 * Say why a block of several rows was not moved. A row on its own that
 * cannot move (the first row, a root) is left without a word, as it always
 * was.
 */
function toldWhyItStays(ids: readonly string[], why: BlockStays): void {
  if (ids.length > 1) toast(BLOCK_STAYS[why.stays]);
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

function historyOf(preWire: WireNode[], plan: PlannedMutation) {
  const undoText = plan.undoText;
  const before =
    undoText === undefined || undoText.size === 0
      ? preWire
      : preWire.map((node) => {
          const text = undoText.get(node.id);
          return text === undefined ? node : { ...node, text };
        });
  return {
    undo: restoreInvocations(wire(), before),
    redo: plan.redoActions ?? plan.actions,
  };
}

/**
 * A gesture being made (`together`): the actions the writes made through its
 * handle planned, in order, sent as one write when it ends. Once it has
 * ended (`closed`), a write made through its handle is a write of its own.
 */
interface Gesture {
  actions: ActionRequest[];
  redoActions: ActionRequest[];
  undoText: Map<string, string>;
  completion?: PlannedMutation["completion"];
  closed: boolean;
}

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
 * Run `plan` as one write and record it as one undo step: what each write
 * answered, when all succeeded. Made in an open gesture (`together`), add
 * its actions to the gesture's instead, and answer that it was taken.
 */
async function runPlanIn(
  gesture: Gesture | null,
  plan: PlannedMutation,
): Promise<RunOptimisticResult> {
  if (gesture !== null && !gesture.closed) {
    gesture.actions.push(...plan.actions);
    gesture.redoActions.push(...(plan.redoActions ?? plan.actions));
    for (const [id, text] of plan.undoText ?? []) gesture.undoText.set(id, text);
    if (plan.completion !== undefined) gesture.completion = plan.completion;
    return { ok: true };
  }
  const preWire = useGraphStore.getState().wireNodes;
  const result = await runOptimistic(plan);
  if (!result.ok) return result;
  const history = historyOf(preWire, plan);
  if (result.confirmed !== undefined && !(await result.confirmed)) return { ok: false };
  if (result.focusId !== undefined) {
    // Its row where the page is being edited: at the instance the write
    // names, else the one the editor resolves.
    editor().activateNode(result.focusId, result.focusCursor ?? 0, result.focusInstanceKey);
  }
  useGraphStore.getState().recordUndo(history);
  return result;
}

/**
 * Write `edit` to the frame view node a frame is shown through, making one (filed in the
 * Views list) when the frame names none (`planEditFrameView`).
 */
async function editFrameViewIn(
  applyPlan: (plan: PlannedMutation | null) => Promise<boolean>,
  frameId: string,
  edit: FrameViewEdit,
): Promise<void> {
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

interface WriteScope {
  readonly inGesture: () => boolean;
  readonly runPlan: (plan: PlannedMutation) => Promise<RunOptimisticResult>;
  readonly applyPlan: (plan: PlannedMutation | null) => Promise<boolean>;
  readonly editFrameView: (frameId: string, edit: FrameViewEdit) => Promise<void>;
  readonly writes: () => PageWrites;
}

function textAndCreateWrites({ runPlan, applyPlan }: WriteScope) {
  return {
    async updateNodeContent(id: string, content: string): Promise<void> {
      const store = useGraphStore.getState();
      const held = store.wireNodes.find((node) => node.id === id);
      if (held === undefined) return;

      // GAP [[01M7Z8689FDT3YBPAQ74RB9VQ2]] The replica may hold newer text than the focused editor shows.
      const plan = planUpdateText(id, content, held.text);
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

    setNodeText(id: string, text: string, expectedText?: string): Promise<boolean> {
      if (!useGraphStore.getState().wireNodes.some((node) => node.id === id)) {
        return Promise.resolve(false);
      }
      return applyPlan(planUpdateText(id, text, expectedText));
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
      if (afterSiblingId !== null) {
        // Directly below it in its group, a top-level row's included.
        ok = await applyPlan(planInsertSibling(wire(), afterSiblingId, "after", newId));
      } else if (parentId === WORKSPACE_ROOT_ID) {
        ok = await applyPlan(planAddRootNode("", newId));
      } else {
        ok = await applyPlan(planAddChild(wire(), parentId, newId, ""));
      }
      if (!ok) return null;
      // F4: single activation via runOptimistic — no post-await re-activation.
      return newId;
    },

    async addMatchingNode(
      add: Parameters<PageWrites["addMatchingNode"]>[0],
    ): ReturnType<PageWrites["addMatchingNode"]> {
      const id = ulid();
      const result = await runPlan(planAddMatching(id, add));
      if (!result.ok) return null;
      const added = AddedSchema.safeParse(result.outputs?.[0]);
      return { id, unmet: added.success ? (added.data.unmet ?? 0) : 0 };
    },

    async createEmptyNodeBefore(beforeId: string): Promise<string | null> {
      // Directly above it in its group, a top-level row's included.
      const newId = ulid();
      return (await applyPlan(planInsertSibling(wire(), beforeId, "before", newId))) ? newId : null;
    },
  };
}

function schemaWrites({ applyPlan }: WriteScope) {
  return {
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
  };
}

function treeStructureWrites({ inGesture, applyPlan }: WriteScope) {
  return {
    async splitNode(id: string, cursor: number | "end", instanceKey?: string): Promise<void> {
      // An open row splits into its first child, as Tana does: open where it
      // is drawn, the row being edited when no instance is named.
      const page = pageEditor().getState();
      const row = instanceKey ?? (page.activeNodeId === id ? page.activeInstanceKey : null);
      const open = row === null ? pageRows().get(id)?.collapsed === false : page.isOpen(row);
      await applyPlan(planSplit(wire(), id, cursor, ulid(), { open, instanceKey }));
    },

    async deleteNode(
      id: Parameters<PageWrites["deleteNode"]>[0],
      draft?: Parameters<PageWrites["deleteNode"]>[1],
    ): Promise<boolean> {
      return applyPlan(planDelete(wire(), id, draft));
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
      if ("stays" in plan) {
        toldWhyItStays(ids, plan);
        return;
      }
      if (!(await applyPlan(plan)) || inGesture()) return;
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
      if ("stays" in plan) {
        toldWhyItStays(ids, plan);
        return;
      }
      if (!(await applyPlan(plan)) || inGesture()) return;
      const [head] = ids;
      if (head !== undefined && ids.length === 1) editor().activateNode(head, cursor ?? 0);
    },

    async moveNodesUp(ids: readonly string[]): Promise<void> {
      await applyPlan(planMove(wire(), ids, "up"));
    },

    async moveNodesDown(ids: readonly string[]): Promise<void> {
      await applyPlan(planMove(wire(), ids, "down"));
    },

    async moveNodes(
      ids: Parameters<PageWrites["moveNodes"]>[0],
      place: Parameters<PageWrites["moveNodes"]>[1],
      leaveReferences = false,
    ): ReturnType<PageWrites["moveNodes"]> {
      const references = leaveReferences ? ids.map(() => ulid()) : [];
      const plan = planMoveNodes(wire(), ids, place, references);
      if (plan === null || !(await applyPlan(plan))) return null;
      return { references };
    },
  };
}

function gestureAndPropWrites({ inGesture, runPlan, applyPlan, writes }: WriteScope) {
  return {
    async together<T>(made: (writes: PageWrites) => Promise<T>): Promise<T | null> {
      // A gesture inside another is part of it.
      if (inGesture()) return made(writes());
      // Only the writes made through this gesture's own handle join it: an
      // edit made elsewhere in the tab meanwhile is a write of its own.
      const open: Gesture = { actions: [], redoActions: [], undoText: new Map(), closed: false };
      let result: T;
      try {
        result = await made(writesIn(open));
      } finally {
        open.closed = true;
      }
      if (open.actions.length > 0 && !(await runPlanIn(null, open)).ok) return null;
      return result;
    },

    async proposeView(
      proposal: Parameters<PageWrites["proposeView"]>[0],
    ): ReturnType<PageWrites["proposeView"]> {
      const { planProposeView } = await import("@/actions/plan");
      const id = ulid();
      const written = await runPlan(planProposeView(proposal, id));
      return written.ok ? { id } : { refused: written.refused ?? "view.propose was refused" };
    },

    history: () => {
      const { undoStack, redoStack } = useGraphStore.getState();
      return { undo: undoStack, redo: redoStack };
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

    async initializeProp(
      nodeId: Parameters<PageWrites["initializeProp"]>[0],
      fieldId: Parameters<PageWrites["initializeProp"]>[1],
      value: Parameters<PageWrites["initializeProp"]>[2],
    ): Promise<void> {
      await applyPlan(planInitializeProp(wire(), nodeId, fieldId, value));
    },

    async createRefTarget(creation: RefCreation, name: string): Promise<string | null> {
      const id = ulid();
      if (creation.kind === "child") {
        return (await writes().addChildNode(creation.parentId, name, id)) ? id : null;
      }
      if (!(await writes().captureNode(name, id))) return null;
      if (creation.kind === "tagged") await writes().addTag(id, creation.tagId);
      return id;
    },

    async togglePin(nodeId: string): Promise<boolean> {
      const pins = pinnedRefIdsFor(shownNodes(), nodeId);
      if (pins.length > 0) {
        // Every pin of the node goes, as one write.
        await writes().together((batch) =>
          Promise.all(pins.map((refId) => batch.deleteNode(refId))),
        );
        return true;
      }
      const plan = planPinNode(wire(), nodeId, ulid());
      if (plan === null) {
        toast("Pinned list is missing from this graph");
        return false;
      }
      return applyPlan(plan);
    },

    async toggleChecks(nodeIds: readonly string[]): Promise<boolean> {
      const plan = planToggleChecks(wire(), nodeIds);
      // No row here has a box: the box is opt-in and off by default
      // (DESIGN-UI.md → A tag's box), so the gesture does nothing visible.
      return plan === null ? false : applyPlan(plan);
    },
  };
}

function assetAndQueryWrites({ applyPlan, writes }: WriteScope) {
  return {
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

    async addTree(
      tree: Parameters<PageWrites["addTree"]>[0],
      format: Parameters<PageWrites["addTree"]>[1],
      place: Parameters<PageWrites["addTree"]>[2],
    ): ReturnType<PageWrites["addTree"]> {
      // The server's answer, not the replica's: a refused tree made nothing, and
      // an older server may answer ids of its own (`confirmsMint`).
      const { receipt: local, settled } = await invokeSettled({
        id: "node.addTree",
        input: { outline: tree, format, ...place },
      });
      const receipt = local.status === "failed" ? local : await settled;
      if (receipt.status === "failed") throw new Error(receipt.message);
      return AddedTreeSchema.parse(receipt.output).ids;
    },

    async attachFileToNode(nodeId: string, file: File): Promise<boolean> {
      // A node's text is a person's wherever the commit takes a write of the
      // node at all, so asking of it unchanged asks of its text: before the upload.
      const held = indexed(nodeId);
      if (held !== undefined && !landsAhead({ upserts: [held], deletes: [] })) return false;
      const path = await writes().uploadAsset(file);
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
        await writes().updateNodeContent(nodeId, next);
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
  };
}

function ontologyWrites({ applyPlan }: WriteScope) {
  return {
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
  };
}

function viewWrites({ applyPlan, editFrameView, writes }: WriteScope) {
  return {
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

    async setFrameSetting<K extends keyof ViewConfig>(
      frameId: string,
      key: K,
      value: Writable<ViewConfig[K]>,
    ): Promise<void> {
      const { frameSettingEdit } = await import("@/actions/plan");
      await editFrameView(frameId, frameSettingEdit(key, value));
    },

    async toggleViewSort(frameId: string, fieldId: string): Promise<void> {
      const current = (await frameConfig(frameId)).sort;
      const existingIndex = current.findIndex((s) => s.fieldId === fieldId);

      let nextSort: SortSpec[];
      if (existingIndex === -1) {
        nextSort = [{ fieldId, dir: "asc" }, ...current];
      } else if (current[existingIndex]?.dir === "asc") {
        nextSort = current.map((s, i) =>
          i === existingIndex ? { ...s, dir: "desc" as const } : s,
        );
      } else {
        nextSort = current.filter((s) => s.fieldId !== fieldId);
      }
      await writes().setFrameSetting(frameId, "sort", nextSort);
    },

    async setColumnWidth(frameId: string, fieldId: string, widthPx: number): Promise<void> {
      const nextColwidth = { ...(await frameConfig(frameId)).colwidth, [fieldId]: widthPx };
      await writes().setFrameSetting(frameId, "colwidth", nextColwidth);
    },

    async addViewFilter(frameId: string, filter: ViewFilter): Promise<void> {
      const next = [...(await frameConfig(frameId)).filters, filter];
      await writes().setFrameSetting(frameId, "filters", next);
    },

    async removeViewFilter(frameId: string, filter: ViewFilter): Promise<void> {
      const { serializeViewFilter } = await import("@kb/views");
      const gone = serializeViewFilter(filter);
      const next = (await frameConfig(frameId)).filters.filter(
        (f) => serializeViewFilter(f) !== gone,
      );
      await writes().setFrameSetting(frameId, "filters", next);
    },

    async moveToGroup(nodeId: string, fieldId: string, value: PropValue | null): Promise<void> {
      const { planMoveToGroup } = await import("@/actions/plan");
      await applyPlan(planMoveToGroup(wire(), nodeId, fieldId, value));
    },
  };
}

/** Page writes scoped to `gesture` while it is open, or standalone writes when null/closed. */
function writesIn(gesture: Gesture | null): PageWrites {
  const inGesture = () => gesture !== null && !gesture.closed;
  const runPlan = (plan: PlannedMutation) => runPlanIn(gesture, plan);
  const applyPlan = async (plan: PlannedMutation | null): Promise<boolean> =>
    plan === null ? false : (await runPlan(plan)).ok;
  const editFrameView = (frameId: string, edit: FrameViewEdit) =>
    editFrameViewIn(applyPlan, frameId, edit);
  const scope: WriteScope = {
    inGesture,
    runPlan,
    applyPlan,
    editFrameView,
    writes: () => bound,
  };
  const bound: PageWrites = {
    ...textAndCreateWrites(scope),
    ...schemaWrites(scope),
    ...treeStructureWrites(scope),
    ...gestureAndPropWrites(scope),
    ...assetAndQueryWrites(scope),
    ...ontologyWrites(scope),
    ...viewWrites(scope),
  };
  return bound;
}

/** The page's writes, each a write of its own; a gesture's are its handle's (`together`). */
export const mutations = writesIn(null);
