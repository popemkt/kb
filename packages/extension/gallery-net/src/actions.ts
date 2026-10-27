/**
 * The handlers of `ext.gallery.search` and `ext.gallery.save`. A search
 * reads the source node, picks its kind's adapter and asks the source. A
 * save downloads the result's image from a host the adapter names and then
 * goes through core's own actions, `asset.upload` and `node.add`, so the
 * asset rules (types, size, SVG sanitising) and the write rules (tags,
 * typed values, the integrity check) have one owner each and the gallery
 * restates neither.
 */
import { Effect } from "effect";
import type { z } from "zod";
import { CoreInvoke, KbCtx, type ActionRequest } from "@kb/contracts";
import { domainError, extensionNodeId, type DomainError, type KbNode } from "@kb/model";
import {
  GALLERY_IDS,
  isTagged,
  type SourceResult,
  starterOutline,
  type gallerySaveDef,
  type gallerySearchDef,
} from "@kb/gallery";
import { SOURCE_ADAPTERS, type SearchPage, type SourceAdapter } from "./adapters.ts";
import { boundedBytes, getFrom, getJson, type SourceFetch } from "./http.ts";

/** Asset uploads are capped at 25 MiB (`asset.upload`); a larger download is refused before it is held. */
const IMAGE_MAX_BYTES = 25 * 1024 * 1024;

/** The image types a save keeps, by the type the host says it sent. */
const IMAGE_EXTS: Readonly<Record<string, string>> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
};

function refOf(node: KbNode | undefined, fieldId: string): string | null {
  for (const value of node?.props[fieldId] ?? []) if (value.t === "ref") return value.v;
  return null;
}

/** The adapter a source node's kind names, or why it has none. */
const adapterOf = Effect.fn("gallery.adapter")(function* (sourceId: string) {
  const ctx = yield* KbCtx;
  const source = ctx.index.getNode(sourceId);
  if (source === undefined || !isTagged(source, GALLERY_IDS.sourceTag))
    return yield* domainError("not_found", `${sourceId} is not an image source`);
  const kind = refOf(source, GALLERY_IDS.sourceKindField);
  if (kind === GALLERY_IDS.kindLink)
    return yield* domainError(
      "invalid_input",
      `${source.text} is a link source: the page opens its search, kb does not call it`,
    );
  const adapter = SOURCE_ADAPTERS.find((a) => a.kind === kind);
  if (adapter === undefined)
    return yield* domainError("invalid_input", `${source.text} names no source kind kb can search`);
  return { adapter, name: source.text };
});

export function searchEffect(send: SourceFetch) {
  return Effect.fn("ext.gallery.search")(function* (
    input: z.infer<typeof gallerySearchDef.inputSchema>,
  ): Effect.fn.Return<SearchPage, DomainError, KbCtx> {
    const { adapter } = yield* adapterOf(input.source);
    if (input.query.trim() === "") return { results: [] };
    const answer = yield* getJson(
      send,
      adapter.searchUrl(input.query.trim(), input.cursor),
      adapter.hosts,
    );
    return adapter.page(answer);
  });
}

/** The image of a result, as bytes and the extension its type names. */
const download = Effect.fn("gallery.download")(function* (
  send: SourceFetch,
  adapter: SourceAdapter,
  url: string,
) {
  const response = yield* getFrom(send, url, adapter.hosts, "image/*");
  const type =
    (response.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  const ext = IMAGE_EXTS[type];
  if (ext === undefined)
    return yield* domainError(
      "invalid_input",
      `${new URL(url).origin} sent ${type === "" ? "no type" : type}, not an image kb keeps`,
    );
  const bytes = yield* boundedBytes(response, IMAGE_MAX_BYTES);
  return { bytes, ext };
}, Effect.scoped);

/** Base64 of `bytes`, in chunks so a large image never spreads into one call. */
export function base64Of(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK)
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(binary);
}

/** One core action, called as the save's caller; a failure is the save's. */
const call = Effect.fn("gallery.call")(function* (request: ActionRequest) {
  const invoke = yield* CoreInvoke;
  if (invoke === null) return yield* domainError("internal", "saving needs the host's CoreInvoke");
  const receipt = yield* invoke(request, "write");
  if (receipt.status === "failed") {
    const code = receipt.code === "unknown_action" ? "internal" : receipt.code;
    return yield* domainError(code, receipt.message, receipt.details);
  }
  return receipt.output;
});

const str = (field: string, v: string) => ({ field, value: { t: "str" as const, v } });
const num = (field: string, v: number) => ({ field, value: { t: "num" as const, v } });

/** What a saved visual carries, as `node.add`'s prop inputs. */
export function visualProps(result: SourceResult, asset: string) {
  const credit = [result.creator === undefined ? "" : `by ${result.creator}`, result.licence ?? ""]
    .filter((part) => part !== "")
    .join(" · ");
  return [
    str(GALLERY_IDS.mediaField, `![${result.title.replace(/[[\]]/g, "")}](${asset})`),
    str(GALLERY_IDS.sourceField, result.page),
    ...(credit === "" ? [] : [str(GALLERY_IDS.creditField, credit)]),
    ...(result.prompt === undefined ? [] : [str(GALLERY_IDS.promptField, result.prompt)]),
    ...(result.negative === undefined ? [] : [str(GALLERY_IDS.negativeField, result.negative)]),
    ...(result.width === undefined ? [] : [num(GALLERY_IDS.widthField, result.width)]),
    ...(result.height === undefined ? [] : [num(GALLERY_IDS.heightField, result.height)]),
  ];
}

function pathOf(output: unknown): string | null {
  return typeof output === "object" &&
    output !== null &&
    "path" in output &&
    typeof output.path === "string"
    ? output.path
    : null;
}

function idOf(output: unknown): string | null {
  return typeof output === "object" &&
    output !== null &&
    "id" in output &&
    typeof output.id === "string"
    ? output.id
    : null;
}

export function saveEffect(send: SourceFetch) {
  return Effect.fn("ext.gallery.save")(function* (
    input: z.infer<typeof gallerySaveDef.inputSchema>,
  ): Effect.fn.Return<{ id: string; asset: string }, DomainError, KbCtx> {
    const { adapter } = yield* adapterOf(input.source);
    const { bytes, ext } = yield* download(send, adapter, input.result.image);
    const uploaded = pathOf(
      yield* call({
        id: "asset.upload",
        input: { bytes: base64Of(bytes), encoding: "base64", ext },
      }),
    );
    if (uploaded === null) return yield* domainError("internal", "asset.upload answered no path");
    const ctx = yield* KbCtx;
    const parent =
      input.parent ??
      refOf(ctx.index.getNode(extensionNodeId("gallery")), GALLERY_IDS.saveIntoField);
    const added = idOf(
      yield* call({
        id: "node.add",
        input: {
          text: input.result.title,
          tags: [GALLERY_IDS.visualTag],
          props: visualProps(input.result, uploaded),
          ...(parent === null ? {} : { parent }),
        },
      }),
    );
    if (added === null) return yield* domainError("internal", "node.add answered no id");
    return { id: added, asset: uploaded };
  });
}

/** The id `node.addTree` minted for the outline's line `line`, or null. */
function idAtLine(output: unknown, line: number): string | null {
  if (typeof output !== "object" || output === null || !("lines" in output)) return null;
  const lines: unknown = output.lines;
  if (typeof lines !== "object" || lines === null) return null;
  const id: unknown = Object.entries(lines).find(([key]) => key === String(line))?.[1];
  return typeof id === "string" ? id : null;
}

function idsOf(output: unknown): string[] {
  if (typeof output !== "object" || output === null || !("ids" in output)) return [];
  const ids: unknown = output.ids;
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
}

/** `ext.gallery.starter`: the starter outline, then its `Library` as the gallery's `save into`. */
export const starterEffect = Effect.fn("ext.gallery.starter")(function* (): Effect.fn.Return<
  { library: string; ids: string[] },
  DomainError,
  KbCtx
> {
  const outline = starterOutline();
  const added = yield* call({ id: "node.addTree", input: { outline } });
  // The library is the outline's last line (`starterOutline`).
  const library = idAtLine(added, outline.split("\n").length);
  if (library === null) return yield* domainError("internal", "node.addTree answered no Library");
  yield* call({
    id: "node.update",
    input: {
      id: extensionNodeId("gallery"),
      setProps: [{ field: GALLERY_IDS.saveIntoField, value: { t: "ref", v: library } }],
    },
  });
  return { library, ids: idsOf(added) };
});
