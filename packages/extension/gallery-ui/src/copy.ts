import { toast } from "@kb/ui-sdk";

/** Put `text` on the clipboard, and say so, or say why not. */
export function copyText(text: string, what: string): void {
  navigator.clipboard
    .writeText(text)
    .then(() => toast(`${what} copied`))
    .catch(() => toast(`Could not copy the ${what.toLowerCase()}`));
}
