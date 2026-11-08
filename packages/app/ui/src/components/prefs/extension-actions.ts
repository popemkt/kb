/**
 * What every extension control in Settings runs its command through: one
 * pending, notice and problem lifetime per control, so a failed read and a
 * failed install never share a slot, and the lock scopes in words.
 */
import { useState } from "react";
import type { ExtensionScope } from "@kb/contracts";
import { changeExtensions } from "@/actions/extensions";

/** A button's look: quiet, and the one an extension's state asks for. */
export const BUTTON =
  "inline-flex items-center gap-1.5 rounded-sm border border-border px-2 py-1 text-label text-foreground hover:bg-foreground/5 disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring";
export const PRIMARY_BUTTON =
  "inline-flex items-center gap-1.5 rounded-sm bg-primary px-2.5 py-1 text-label font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** Each lock scope, as a person reads it: its name, and what leaving it means. */
export const SCOPES: Readonly<Record<ExtensionScope, { label: string; leaving: string }>> = {
  store: {
    label: "Store lock (committed)",
    leaving:
      "It leaves the store's committed lock, so it stops loading here and for whoever pulls.",
  },
  local: {
    label: "This root only (private)",
    leaving: "It leaves this root's private lock, so it stops loading here.",
  },
  user: {
    label: "Every kb on this machine",
    leaving: "It leaves your user lock, so it stops loading in every kb on this machine.",
  },
};

const SCOPE_ORDER: readonly ExtensionScope[] = ["store", "local", "user"];

export const SCOPE_OPTIONS = SCOPE_ORDER.map((value) => ({ value, label: SCOPES[value].label }));

/**
 * A control's command lifetime: `run` invokes `id` and reads the manifest
 * again; `describe` turns the command's output into the notice shown, and
 * `onComplete` runs once it succeeded.
 */
export function useExtensionAction() {
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  function run(
    id: string,
    input: Record<string, unknown>,
    describe?: (output: unknown) => string,
    onComplete?: () => void,
  ) {
    setPending(true);
    setProblem(null);
    setNotice(null);
    return changeExtensions(id, input)
      .then((output) => {
        setNotice(describe === undefined ? null : describe(output));
        return onComplete?.();
      })
      .catch((error: unknown) => {
        setProblem(error instanceof Error ? error.message : String(error));
      })
      .finally(() => setPending(false));
  }
  return { pending, problem, notice, run };
}
