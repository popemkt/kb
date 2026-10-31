/**
 * What a look exports to: one contract for every document a look becomes
 * (DESIGN-UI.md → The gallery). An export reads the look, the library it
 * draws its styles from and the graph, and renders Markdown a person or a
 * builder takes away: the brief for a person (`briefOf`), and the 3D
 * art-direction brief a builder follows (`artDirectionOf`). The look panel
 * offers each one the same way, to copy, download or preview. A new export
 * is a new entry here, never a second path beside the panel's.
 */
import { artDirectionOf } from "./art-direction.ts";
import { briefOf, type LookDraft } from "./look.ts";
import type { GraphNode, Library } from "./library.ts";

export interface LookExport {
  readonly id: string;
  /** What the panel calls it. */
  readonly label: string;
  /** What its file adds after the look's name, before `.md`; empty for none. */
  readonly suffix: string;
  readonly render: (
    draft: LookDraft,
    library: Library,
    get: (id: string) => GraphNode | undefined,
  ) => string;
}

/** Every export a look offers, in the panel's order. */
export const LOOK_EXPORTS: readonly LookExport[] = [
  { id: "brief", label: "Brief", suffix: "", render: briefOf },
  {
    id: "art-direction",
    label: "3D art direction",
    suffix: "3D art direction",
    render: artDirectionOf,
  },
];

/** The file an export of the look named `name` downloads as. */
export function exportFileName(name: string, target: LookExport): string {
  const base = name.replaceAll(/[^\w\- ]+/g, "").trim() || "look";
  return `${[base, target.suffix].filter((part) => part !== "").join(" ")}.md`;
}
