/**
 * The gallery family's actions as every surface lists them: ids, modes and
 * schemas, with no handler. The server's entry (`@kb/gallery-net`) gives
 * each its handler; the page reads the result shape to draw it. Search and
 * save reach past the root to a source on the network, so their mode says
 * `outsideRoot`, which MCP reports as the open world.
 *
 * Only sources whose terms allow programmatic search are ever called, and
 * only when a person searches (research record §3): a link source is opened
 * by the page and never reaches these actions.
 */
import { z } from "zod";
import { extensionActionId, type ActionDefinition } from "@kb/contracts";
import { galleryExtension } from "./extension.ts";

/** One result, the same shape whichever source answered it. */
const SourceResultSchema = z.object({
  /** The source's own id for it. */
  id: z.string(),
  title: z.string(),
  /** An image URL small enough for a grid tile. */
  thumb: z.string(),
  /** The image URL a save downloads. */
  image: z.string(),
  width: z.number().optional(),
  height: z.number().optional(),
  /** Where the result lives on the source, for a person to open. */
  page: z.string(),
  creator: z.string().optional(),
  /** The licence or usage terms the source states for it. */
  licence: z.string().optional(),
  /** The prompt it was made with, when the source says. */
  prompt: z.string().optional(),
  negative: z.string().optional(),
});
export type SourceResult = z.infer<typeof SourceResultSchema>;

export const gallerySearchDef = {
  id: "search",
  title: "Search an image source",
  description:
    "Search one online image source (a node tagged image source whose kind is an API) for a query; answers results with thumbnails, pages, creators and licences. PG content only.",
  mode: { kind: "read", outsideRoot: true },
  inputSchema: z.object({
    /** The image source node. */
    source: z.string(),
    query: z.string(),
    /** The page after this one, as the previous answer's `next` gave it. */
    cursor: z.string().optional(),
  }),
  outputSchema: z.object({
    results: z.array(SourceResultSchema),
    next: z.string().optional(),
  }),
} satisfies ActionDefinition;

export const gallerySaveDef = {
  id: "save",
  title: "Save a search result as a visual",
  description:
    "Download a search result's image into the kb's assets and add it as a visual, with its source page, creator, licence and prompt.",
  mode: { kind: "write", outsideRoot: true },
  inputSchema: z.object({
    /** The image source node the result came from. */
    source: z.string(),
    result: SourceResultSchema,
    /** Where the visual goes; the forest roots when omitted. */
    parent: z.string().optional(),
  }),
  outputSchema: z.object({ id: z.string(), asset: z.string() }),
} satisfies ActionDefinition;

/**
 * A picture link kept as a picture: fetched only from the image hosts the
 * gallery's server entry lists (`captureHosts`), refused as `forbidden`
 * from any other, which the page then keeps as a link.
 */
export const galleryCaptureDef = {
  id: "capture",
  title: "Keep the picture a link names",
  description:
    "Download the picture an https link names, from one of the image hosts the gallery fetches from, into the kb's assets, and add it as a visual whose source is the link. A link to any other host is refused (forbidden).",
  mode: { kind: "write", outsideRoot: true },
  inputSchema: z.object({
    url: z.string(),
    /** What the visual is called. */
    text: z.string().min(1),
    /** Where the visual goes; the gallery's `save into` when omitted. */
    parent: z.string().optional(),
  }),
  outputSchema: z.object({ id: z.string(), asset: z.string() }),
} satisfies ActionDefinition;

/**
 * The starter library, added on the server in one call: the outline paste
 * and the setting that names its `Library` as where saves go. Run where its
 * ids are minted, so the setting names the node the store holds; a page
 * that pasted the outline itself would name the id its own optimistic
 * commit minted, which the server's commit does not keep.
 * GAP [[01M5ZBC8DQWB1DY5Z9AAABGPYR]]
 */
export const galleryStarterDef = {
  id: "starter",
  title: "Add the gallery's starter library",
  description:
    "Add a Styles tree of facets (#facet) and their styles (#style): shot size, camera angle and motion, lens, lighting, palette, film stock, mood, era and more; and an empty Library, which becomes where saved visuals go.",
  mode: { kind: "write" },
  inputSchema: z.object({}),
  outputSchema: z.object({
    /** The new `Library`, now the gallery's `save into`. */
    library: z.string(),
    /** Every node the starter added, in tree order. */
    ids: z.array(z.string()),
  }),
} satisfies ActionDefinition;

const idOf = (def: ActionDefinition) => extensionActionId(galleryExtension.name, def.id);

/** The ids the page calls them by. */
export const GALLERY_ACTIONS = {
  search: idOf(gallerySearchDef),
  save: idOf(gallerySaveDef),
  capture: idOf(galleryCaptureDef),
  starter: idOf(galleryStarterDef),
} as const;
