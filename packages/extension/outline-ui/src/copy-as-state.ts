/**
 * Whether Copy as… is open, and over which rows (DESIGN-UI.md → Outline
 * editor, "Copy, cut and Copy as…"): the page's screen state, never the
 * graph's. The command opens it; the host draws it while it is.
 */
import { create } from "zustand";

/** The rows the open dialog is about; null while it is closed. */
export const useCopyAs = create<{ readonly rows: readonly string[] | null }>(() => ({
  rows: null,
}));

/** Open Copy as… over `rows`. */
export const openCopyAs = (rows: readonly string[]): void =>
  useCopyAs.setState({ rows: [...rows] });

/** Close it. */
export const closeCopyAs = (): void => useCopyAs.setState({ rows: null });
