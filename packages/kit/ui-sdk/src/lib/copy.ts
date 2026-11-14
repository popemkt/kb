/**
 * A copy to the clipboard, said in a toast: that it was copied, or that it
 * could not be and what to do instead. The one copy gesture every surface's
 * "copy" makes.
 */
import { toast } from "./toast";

/**
 * Put `text` on the clipboard, and say so, or say why not. `what` names it
 * as a toast's first words ("Node ID", "Sum"); mid-sentence its first letter
 * is lowered, and the rest kept, so an initialism reads as one. Resolves
 * whether it was copied.
 */
export async function copyText(text: string, what: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const named = what.charAt(0).toLowerCase() + what.slice(1);
    toast(`Couldn't copy the ${named}: select it and copy it by hand`);
    return false;
  }
  toast(`${what} copied`, "info");
  return true;
}
