/**
 * What a paste or a drop brings into a row's text, and who claims it
 * (DESIGN-UI.md → Paste and drop).
 *
 * The outline declares `outline.ingest` (its family's point definitions
 * hold the name), a chain: each handler says, as
 * data, which gestures and which kinds of data it takes (`match`), and the
 * first whose match holds, by priority, claims the gesture. Its `ingest`
 * then says what the gesture makes, as data too (`IngestOutcome`), and the
 * surface commits it: a handler never writes. What no handler claims is the
 * browser's own: text pasted into the row.
 *
 * A text host offers a gesture through its {@link IngestPort}, which the
 * surface that draws it binds: the outline's runs the chain at its row, and a
 * canvas card's keeps a dropped file.
 */
import type { ContributionEntry } from "@kb/plugin";
import { Schema } from "effect";
import { browserHost } from "../host";
import { toast } from "./toast";

/** How data came into the text. */
export type IngestGesture = "paste" | "drop";

/** What a paste or a drop carries, read once from its `DataTransfer`. */
export interface Ingested {
  readonly gesture: IngestGesture;
  /** Its data's types, as `DataTransfer.types` lists them (`text/plain`, `Files`). */
  readonly types: readonly string[];
  /** Its `text/plain`; empty when it has none. */
  readonly text: string;
  readonly files: readonly File[];
}

/** The row a gesture lands on: the node its text is, and that text. */
export interface IngestSite {
  readonly nodeId: string;
  readonly text: string;
}

/**
 * What a claimed gesture makes, which the page writes at the row: nodes, as
 * outline paste text (DESIGN.md → Outline paste), added after it in one
 * transaction; or a file, kept as an asset and linked from its text.
 */
export type IngestOutcome = { readonly outline: string } | { readonly attach: File };

/** Which gestures a handler takes, as data: the gesture, the data's types, and a test of its text. */
export interface IngestMatch {
  readonly gestures: readonly IngestGesture[];
  /** The data carries one of these types. */
  readonly types: readonly string[];
  /** Its `text/plain` matches this regular expression's source, when given. */
  readonly pattern?: string;
}

export interface IngestHandler {
  readonly match: IngestMatch;
  /** Higher claims first; the outline's own sit at 0, and a tie goes to the first contributed. */
  readonly priority: number;
  /** What the claimed gesture makes at `site`, or null for nothing. */
  readonly ingest: (ingested: Ingested, site: IngestSite) => Promise<IngestOutcome | null>;
}

/** What a text host offers a gesture to: the surface's, which names the row. */
export interface IngestPort {
  /**
   * Whether a drop of data of `types` may be claimed: asked while it is
   * dragged over, before its data can be read, so a pattern is not asked.
   */
  readonly accepts: (gesture: IngestGesture, types: readonly string[]) => boolean;
  /** Offer it: true when it is claimed (the browser's own then does not run), and the claim runs. */
  readonly offer: (ingested: Ingested) => boolean;
}

/** A gesture's data, read once: its text and files are gone once its event returns. */
export function ingestedOf(gesture: IngestGesture, data: DataTransfer | null): Ingested {
  if (data === null) return { gesture, types: [], text: "", files: [] };
  return {
    gesture,
    types: [...data.types],
    text: data.getData("text/plain"),
    files: [...data.files],
  };
}

/** `match` takes a gesture of `gesture` carrying `types`, its text left unasked. */
function takes(match: IngestMatch, gesture: IngestGesture, types: readonly string[]): boolean {
  return match.gestures.includes(gesture) && match.types.some((type) => types.includes(type));
}

/** A match's `pattern` as a regular expression, or why it is none. */
function compiled(pattern: string): RegExp | Error {
  try {
    return new RegExp(pattern, "u");
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

/** `match` takes `ingested`, its text and all. A pattern that is no regular expression takes nothing. */
function holds(match: IngestMatch, ingested: Ingested): boolean {
  if (!takes(match, ingested.gesture, ingested.types)) return false;
  if (match.pattern === undefined) return true;
  const pattern = compiled(match.pattern);
  return pattern instanceof RegExp && pattern.test(ingested.text);
}

/** `handlers` by the order they claim in: priority, higher first, then as listed. */
function byPriority(handlers: readonly IngestHandler[]): readonly IngestHandler[] {
  return handlers
    .map((handler, index) => ({ handler, index }))
    .toSorted((a, b) => b.handler.priority - a.handler.priority || a.index - b.index)
    .map(({ handler }) => handler);
}

/** The handler that claims `ingested` among `handlers`, or null when none does. */
export function claimantOf(
  handlers: readonly IngestHandler[],
  ingested: Ingested,
): IngestHandler | null {
  return byPriority(handlers).find(({ match }) => holds(match, ingested)) ?? null;
}

/** What `node.addTree` answers that a paste reads: the ids it made, in tree order. */
const decodeAdded = Schema.decodeUnknownSync(Schema.Struct({ ids: Schema.Array(Schema.String) }));

/** Where the node `id` sits: its parent (none at the roots) and its place among its parent's children. */
function placeOf(id: string): { readonly parent?: string; readonly position?: number } {
  for (const node of browserHost().wireNodes()) {
    const at = node.children.indexOf(id);
    if (at >= 0) return { parent: node.id, position: at };
  }
  return {};
}

/** A row that holds nothing: no text, no fields or tags, no children. */
function holdsNothing(id: string, text: string): boolean {
  const node = browserHost()
    .wireNodes()
    .find((n) => n.id === id);
  return (
    text.trim() === "" &&
    node !== undefined &&
    node.children.length === 0 &&
    Object.keys(node.props).length === 0
  );
}

/**
 * Add `outline` after the row `site` names, in one transaction, and put the
 * caret at the end of the last node it made. A row that held nothing was
 * where the person meant the outline to go: it gives the outline its place,
 * and goes.
 */
async function addOutlineAt(outline: string, site: IngestSite): Promise<void> {
  const host = browserHost();
  const empty = holdsNothing(site.nodeId, site.text);
  const { parent, position } = placeOf(site.nodeId);
  const input = {
    outline,
    ...(parent === undefined ? {} : { parent }),
    ...(position === undefined ? {} : { position: empty ? position : position + 1 }),
  };
  const receipt = await host.invoke("node.addTree", input);
  if (receipt.status === "failed") throw new Error(receipt.message);
  const { ids } = decodeAdded(receipt.output);
  if (empty) await host.writes.deleteNode(site.nodeId);
  const last = ids.at(-1);
  if (last !== undefined) host.activateNode(last);
}

/** Write what a claim made at `site`. */
async function commitIngest(outcome: IngestOutcome, site: IngestSite): Promise<void> {
  if ("outline" in outcome) return addOutlineAt(outcome.outline, site);
  await browserHost().writes.attachFileToNode(site.nodeId, outcome.attach);
}

/**
 * A text host's port onto `handlers`, at the row `site` names when a
 * gesture comes: the first to claim it says what it makes, which is written
 * there. A claim that fails is told, and writes nothing.
 */
export function ingestPort(
  handlers: () => readonly IngestHandler[],
  site: () => IngestSite,
): IngestPort {
  return {
    accepts: (gesture, types) => handlers().some(({ match }) => takes(match, gesture, types)),
    offer: (ingested) => {
      const claimant = claimantOf(handlers(), ingested);
      if (claimant === null) return false;
      const at = site();
      void Promise.resolve()
        .then(() => claimant.ingest(ingested, at))
        .then((outcome) => (outcome === null ? undefined : commitIngest(outcome, at)))
        .catch((error: unknown) => {
          toast(
            `Nothing was made of that ${ingested.gesture}: ${error instanceof Error ? error.message : String(error)}`,
          );
        });
      return true;
    },
  };
}

/** What a page half writes of a handler: its match and priority, and its text as outline paste text. */
export interface IngestForm {
  readonly match: IngestMatch;
  readonly priority: number;
  /** The gesture's text as outline paste text, or null for nothing. */
  readonly transform: (text: string) => string | null;
}

/**
 * The `outline.ingest` contribution for a handler whose transform is
 * text in, outline out: what it makes is the nodes its outline says, which
 * the page adds after the row. A pattern that is no regular expression
 * throws where its plugin applies.
 */
export function provideIngest(id: string, form: IngestForm): ContributionEntry<IngestHandler> {
  const pattern = form.match.pattern === undefined ? null : compiled(form.match.pattern);
  if (pattern instanceof Error) {
    throw new Error(
      `paste handler ${id}: its pattern is no regular expression: ${pattern.message}`,
      {
        cause: pattern,
      },
    );
  }
  return {
    id,
    value: {
      match: form.match,
      priority: form.priority,
      ingest: ({ text }) => {
        // The transform runs here, in the page, at T3: GAP [[01M73WFP42V98AA4VRG8JBQQ2N]].
        const outline = form.transform(text);
        return Promise.resolve(outline === null ? null : { outline });
      },
    },
  };
}

/** A dropped file, kept as an asset and linked from the row's text: the first of a drop's files. */
export const ATTACH_FILE: IngestHandler = {
  match: { gestures: ["drop"], types: ["Files"] },
  priority: 0,
  ingest: ({ files }) => Promise.resolve(files[0] === undefined ? null : { attach: files[0] }),
};
