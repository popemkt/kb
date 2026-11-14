import { toast } from "./toast";

/**
 * Put `text` on the clipboard and say so, or say why not: the one copy
 * gesture every surface's "copy" button makes. `what` names the thing copied,
 * as the toast says it ("Sum copied"). Resolves whether it was copied.
 */
export async function copyText(text: string, what: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    toast(`Couldn't copy the ${what.toLowerCase()}: select it and copy it by hand`);
    return false;
  }
  toast(`${what} copied`);
  return true;
}
