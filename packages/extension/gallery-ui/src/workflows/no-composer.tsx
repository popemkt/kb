import { WorkspaceState } from "@kb/ui-sdk";

/** What a workflow shows drawn outside the composer: it works on the composer's look and library. */
export function NoComposer() {
  return (
    <WorkspaceState
      title="Nothing to work on here"
      description="A gallery workflow works on the composer's look and library: open it in the gallery."
    />
  );
}
