/** Extension commands publish their new manifest only after the server accepts the mutation. */
import { extensionUpdateDef } from "@kb/operations";
import { loadManifest } from "@/lib/manifest";
import { invoke } from "@/session/runtime";

export function changeExtensions(id: string, input: unknown): Promise<string | null> {
  return invoke(id, input).then((receipt) => {
    if (receipt.status === "failed") throw new Error(receipt.message);
    const updates =
      id === extensionUpdateDef.id
        ? extensionUpdateDef.outputSchema.parse(receipt.output).updated
        : null;
    const message =
      updates === null
        ? null
        : updates.length === 0
          ? "Already up to date."
          : updates
              .map((change) =>
                change.from === change.to
                  ? `Already at ${change.to}`
                  : `Updated ${change.from} → ${change.to}${change.trusted === false ? "; review to trust" : ""}`,
              )
              .join("; ");
    return loadManifest().then(() => message);
  });
}
