/**
 * The UI's one way to make a view node from settings: `view.propose`, the
 * one check of a proposed view (DESIGN.md → View nodes), so the UI writes
 * exactly what an agent could propose. The UI mints the node's id and names
 * it in the call (DESIGN-UI.md → Mutations: the client mints final ULIDs), so
 * the local commit and the server's are one node: left to the action, each
 * would mint its own. The call is a page write (`runPageWrite`), so the view
 * node is one undo step, or part of the gesture that made it.
 */
import { ulid } from "ulid";
import type { ProposedView, ViewProposal } from "@kb/ui-sdk";
import { runPageWrite } from "@/actions/mutations";

/** The new view node's id, or why the proposal was refused. */
export async function proposeView(proposal: ViewProposal): Promise<ProposedView> {
  const id = ulid();
  const written = await runPageWrite({
    actions: [
      {
        id: "view.propose",
        input: {
          id,
          view: proposal.view.id,
          params: proposal.params,
          ...(proposal.host === undefined ? {} : { host: proposal.host }),
          ...(proposal.text === undefined ? {} : { text: proposal.text }),
        },
      },
    ],
  });
  return written.ok ? { id } : { refused: written.refused ?? "view.propose was refused" };
}
