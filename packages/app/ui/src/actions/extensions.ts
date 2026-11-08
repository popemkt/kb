/** Extension commands publish their new manifest only after the server accepts the mutation. */
import { loadManifest } from "@/lib/manifest";
import { invoke } from "@/session/runtime";

/** Run an extension command, then read the manifest again; answers the command's output. */
export function changeExtensions(id: string, input: unknown): Promise<unknown> {
  return invoke(id, input).then((receipt) => {
    if (receipt.status === "failed") throw new Error(receipt.message);
    return loadManifest().then(() => receipt.output);
  });
}
