/** The page's current graph-shortcut reading and its action-review presentation. */
import { describeChord, type StoredKeybinding, type RefusedBinding } from "@kb/keybindings";
import { canonicalJson } from "@kb/model";
import { graphChangesDef } from "@kb/operations";
import type { ApprovalView } from "@kb/ui-sdk";
import { changeExtensions } from "@/actions/extensions";
import { postAction } from "@/api/action";

export interface ShortcutReading {
  readonly candidate: StoredKeybinding;
  readonly digest: string | null;
  readonly state: "active" | "pending" | "refused";
  readonly reason?: string;
}
interface ShortcutState {
  readonly rows: readonly ShortcutReading[];
  readonly review: ShortcutReading | null;
  readonly rev: number;
  readonly problems: readonly RefusedBinding[];
}
let state: ShortcutState = { rows: [], review: null, rev: 0, problems: [] };
const listeners = new Set<() => void>();
export function publish(next: ShortcutState): void {
  state = next;
  for (const listener of listeners) listener();
}
export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function currentRow(id: string | null): ShortcutReading | undefined {
  return state.rows.find(({ candidate }) => candidate.nodeId === id);
}

export const shortcutState = () => state;
export const shortcutProblem = (id: string | null) =>
  state.problems.find((problem) => problem.id === id)?.reason;

/** Writer metadata is information only; unavailable history never becomes an authorship refusal. */
async function writerOf(id: string): Promise<string> {
  try {
    const receipt = await postAction({
      id: graphChangesDef.id,
      input: {
        since: Math.max(0, state.rev - 500),
        limit: 500,
      },
    });
    if (receipt.status !== "succeeded") return "Writer unknown";
    const result = await graphChangesDef.outputSchema["~standard"].validate(receipt.output);
    if (result.issues !== undefined) return "Writer unknown";
    const tx = result.value.changes.findLast(({ wrote }) => wrote.some((node) => node.id === id));
    if (tx?.actor === undefined) return "Writer unknown";
    return `Last recorded writer: ${canonicalJson(tx.actor)}${tx.via === undefined ? "" : ` via ${tx.via}`}`;
  } catch {
    return "Writer unknown";
  }
}

/** The existing sandbox.trust review presents the binding, never just its opaque digest. */
export async function readShortcutApproval(digest: string): Promise<ApprovalView | null> {
  const row = state.rows.find((candidate) => candidate.digest === digest);
  if (row === undefined || row.candidate.contribution.value.replaces === undefined) return null;
  const writer = await writerOf(row.candidate.nodeId);
  const current = currentRow(row.candidate.nodeId);
  if (current?.digest !== digest)
    throw new Error("This shortcut changed. Review its current content again.");
  const value = row.candidate.contribution.value;
  return {
    approveLabel: "Confirm this override",
    content: (
      <div className="space-y-2 text-ui">
        <p>Allow this shortcut to replace another binding on this machine?</p>
        <p className="font-medium">
          {describeChord(value.chord)} in {value.context}
        </p>
        <pre className="overflow-auto rounded-sm bg-background p-2 font-mono text-label">
          {row.candidate.content}
        </pre>
        <p className="text-meta text-muted-foreground">
          {writer}. Writer information does not grant approval.
        </p>
      </div>
    ),
  };
}

/** A delayed answer only confirms the exact content the person reviewed. */
export async function confirmShortcut(reviewed: ShortcutReading): Promise<void> {
  const current = currentRow(reviewed.candidate.nodeId);
  if (
    current?.digest === null ||
    current?.digest === undefined ||
    current.digest !== reviewed.digest
  )
    throw new Error("This shortcut changed. Close this review and review it again.");
  await changeExtensions("sandbox.trust", { digest: current.digest });
}
