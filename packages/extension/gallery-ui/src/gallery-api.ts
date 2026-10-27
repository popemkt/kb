/**
 * The gallery's writes and calls, each through the page's one invoke path:
 * a source searched, a result saved, the starter library added, a prompt
 * enhanced. Each answers what the page shows next, or null after telling
 * the person why it could not.
 */
import {
  ENHANCE_ACTION,
  EnhancedSchema,
  enhanceInput,
  GALLERY_ACTIONS,
  gallerySaveDef,
  gallerySearchDef,
  galleryStarterDef,
  type ComposeTarget,
  type SourceResult,
} from "@kb/gallery";
import { browserHost, toast } from "@kb/ui-sdk";

export interface SearchPage {
  readonly results: readonly SourceResult[];
  readonly next?: string;
}

async function call(id: string, input: unknown, what: string): Promise<unknown> {
  const receipt = await browserHost().invoke(id, input);
  if (receipt.status === "failed") {
    toast(`${what}: ${receipt.message}`);
    return null;
  }
  return receipt.output;
}

/** One page of `source`'s results for `query`. */
export async function searchSource(
  source: string,
  query: string,
  cursor?: string,
): Promise<SearchPage | null> {
  const output = await call(
    GALLERY_ACTIONS.search,
    { source, query, ...(cursor === undefined ? {} : { cursor }) },
    "Search failed",
  );
  const parsed = gallerySearchDef.outputSchema.safeParse(output);
  return parsed.success ? parsed.data : null;
}

/** Save `result` as a visual; answers its node id. */
export async function saveResult(source: string, result: SourceResult): Promise<string | null> {
  const output = await call(GALLERY_ACTIONS.save, { source, result }, "Save failed");
  const parsed = gallerySaveDef.outputSchema.safeParse(output);
  if (!parsed.success) return null;
  toast(`Saved “${result.title}” to the gallery`);
  return parsed.data.id;
}

/**
 * Add the starter: a `Styles` tree of facets and their styles, and an empty
 * `Library` that becomes where saved visuals go, in one server call
 * (`ext.gallery.starter`).
 */
export async function addStarter(): Promise<boolean> {
  const output = await call(GALLERY_ACTIONS.starter, {}, "Could not add the starter");
  return galleryStarterDef.outputSchema.safeParse(output).success;
}

/**
 * `prompt` rewritten for `target` by the model the person chose for the
 * agent (`ext.agent.complete`); null after telling the person why not.
 */
export async function enhancePrompt(prompt: string, target: ComposeTarget): Promise<string | null> {
  const output = await call(
    ENHANCE_ACTION,
    enhanceInput(prompt, target),
    "Could not enhance the prompt",
  );
  const parsed = EnhancedSchema.safeParse(output);
  if (!parsed.success) return null;
  const text = parsed.data.text.trim();
  if (text === "") {
    toast("Could not enhance the prompt: the model answered nothing");
    return null;
  }
  return text;
}
