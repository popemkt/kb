/**
 * A copy to the clipboard, said in a toast: that it was copied, or that it
 * could not be and what to do instead. The one copy gesture every surface's
 * "copy" makes, in one shape (DESIGN-UI.md → Outline editor, "Copy, cut and
 * Copy as…"): the flavours, each a media type and its text.
 */
import { toast } from "./toast";

/** What a copy puts on the clipboard: each flavour's text, by media type. */
export type ClipboardFlavours = Readonly<Record<string, string>>;

/** Put `flavours` into a copy or cut event's data, which only that event may give a custom type. */
export function putFlavours(data: DataTransfer, flavours: ClipboardFlavours): void {
  for (const [type, text] of Object.entries(flavours)) data.setData(type, text);
}

/**
 * Put `flavours` on the clipboard from outside a copy event (a button, a
 * command), and say so, or say why not. The async clipboard takes only
 * the standard types, so a custom flavour cannot go this way. `what` names
 * it as a toast's first words ("Node ID", "Sum"); mid-sentence its first
 * letter is lowered, and the rest kept, so an initialism reads as one.
 * Resolves whether it was copied.
 */
export async function writeFlavours(flavours: ClipboardFlavours, what: string): Promise<boolean> {
  const types = Object.keys(flavours);
  try {
    if (types.length === 1 && types[0] === "text/plain") {
      await navigator.clipboard.writeText(flavours["text/plain"] ?? "");
    } else {
      const blobs = Object.fromEntries(
        Object.entries(flavours).map(([type, text]) => [type, new Blob([text], { type })]),
      );
      await navigator.clipboard.write([new ClipboardItem(blobs)]);
    }
  } catch {
    const named = what.charAt(0).toLowerCase() + what.slice(1);
    toast(`Couldn't copy the ${named}: select it and copy it by hand`);
    return false;
  }
  toast(`${what} copied`, "info");
  return true;
}

/** Put `text` on the clipboard as its one flavour, `text/plain` (`writeFlavours`). */
export function copyText(text: string, what: string): Promise<boolean> {
  return writeFlavours({ "text/plain": text }, what);
}
