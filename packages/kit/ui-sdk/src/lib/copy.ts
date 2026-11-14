/**
 * A copy to the clipboard, said in a toast: that it was copied, or that it
 * could not be.
 */
import { toast } from "./toast";

/**
 * Put `text` on the clipboard, and say so, or say why not. `what` names it
 * as a toast's first words ("Node ID", "Prompt"); mid-sentence its first
 * letter is lowered, and the rest kept, so an initialism reads as one.
 */
export function copyText(text: string, what: string): void {
  const named = what.charAt(0).toLowerCase() + what.slice(1);
  navigator.clipboard
    .writeText(text)
    .then(() => toast(`${what} copied`))
    .catch(() => toast(`Could not copy the ${named}`));
}
