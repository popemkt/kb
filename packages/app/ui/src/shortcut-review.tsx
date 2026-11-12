/** A shortcut confirmation uses the shared invocation review dialog. */
import { useMemo, useSyncExternalStore } from "react";
import { ActionReviewDialog } from "@kb/ui-sdk";
import { shortcutState, subscribe, publish, confirmShortcut } from "@/lib/stored-shortcuts";

function closeShortcutReview(): void {
  publish({ ...shortcutState(), review: null });
}

export function ShortcutReview() {
  const reading = useSyncExternalStore(subscribe, shortcutState);
  const row = reading.review;
  const invocation = useMemo(
    () => ({ id: "sandbox.trust", actor: "human" as const, input: { digest: row?.digest } }),
    [row],
  );
  if (row === null) return null;
  const reviewed = row;
  async function answer(approved: boolean) {
    if (!approved) return closeShortcutReview();
    await confirmShortcut(reviewed);
    closeShortcutReview();
  }
  return <ActionReviewDialog invocation={invocation} answer={answer} close={closeShortcutReview} />;
}
