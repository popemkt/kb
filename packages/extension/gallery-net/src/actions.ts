/**
 * The handlers of the gallery's server actions. A search
 * reads the source node, picks its kind's adapter and asks the source. A
 * save downloads the result's image from a host the adapter names and then
 * goes through core's own actions, `asset.upload` and `node.add`, so the
 * asset rules (types, size, SVG sanitising) and the write rules (tags,
 * typed values, the integrity check) have one owner each and the gallery
 * restates neither. Capture keeps a picture a link names, and the starter
 * files the pictures it ships, the same way.
 */
import { Effect } from "effect";
import type { z } from "zod";
import { CoreInvoke, KbCtx, type ActionRequest } from "@kb/contracts";
import { domainError, extensionNodeId, type DomainError, type KbNode } from "@kb/model";
import {
  GALLERY_IDS,
  isTagged,
  type galleryCaptureDef,
  type SourceResult,
  type gallerySaveDef,
  type gallerySearchDef,
} from "@kb/gallery";
import { SOURCE_ADAPTERS, type SearchPage, type SourceAdapter } from "./adapters.ts";
import { starterOutline } from "./starter.ts";
import { STARTER_VISUALS } from "./starter-visuals.ts";
import { ANY_HOST, boundedBytes, getFrom, getJson, reachable, type SourceFetch } from "./http.ts";

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

/**
 * Whether the page may show `result`: its image and thumbnail on the
 * adapter's hosts and its page over https, all as a request would be sent.
 * A source's answer is remote text, so a result that breaks this is dropped,
 * whichever adapter read it.
 */
function admitted(adapter: SourceAdapter, result: SourceResult): boolean {
  return (
    reachable(result.image, adapter.hosts) &&
    reachable(result.thumb, adapter.hosts) &&
    reachable(result.page, ANY_HOST)
  );
}

export function searchEffect(send: SourceFetch) {
  return Effect.fn("ext.gallery.search")(function* (
    input: z.infer<typeof gallerySearchDef.inputSchema>,
  ): Effect.fn.Return<SearchPage, DomainError, KbCtx> {
    const { adapter } = yield* adapterOf(input.source);
    if (input.query.trim() === "") return { results: [] };
    const query = input.query.trim();
    const answer = yield* getJson(send, adapter.searchUrl(query, input.cursor), adapter.hosts);
    const page = adapter.page(answer, query, input.cursor);
    return { ...page, results: page.results.filter((result) => admitted(adapter, result)) };
  });
}

/** The picture at `url`, from a host `allowed` names, as bytes and the extension its type names. */
const download = Effect.fn("gallery.download")(function* (
  send: SourceFetch,
  allowed: (host: string) => boolean,
  url: string,
) {
  const response = yield* getFrom(send, url, allowed, "image/*");
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

/** What a kept picture becomes: a visual named `text`, with `props` around its asset. */
interface Kept {
  readonly text: string;
  readonly props: (asset: string) => readonly unknown[];
  /** Where it goes; the gallery's `save into` when absent. */
  readonly parent?: string | undefined;
}

/**
 * The one way the gallery files a picture: its bytes (base64) written
 * through `asset.upload`, and a visual added around the asset through
 * `node.add`.
 */
const file = Effect.fn("gallery.file")(function* (data: string, ext: string, visual: Kept) {
  const uploaded = pathOf(
    yield* call({ id: "asset.upload", input: { bytes: data, encoding: "base64", ext } }),
  );
  if (uploaded === null) return yield* domainError("internal", "asset.upload answered no path");
  const ctx = yield* KbCtx;
  const parent =
    visual.parent ??
    refOf(ctx.index.getNode(extensionNodeId("gallery")), GALLERY_IDS.saveIntoField);
  const added = idOf(
    yield* call({
      id: "node.add",
      input: {
        text: visual.text,
        tags: [GALLERY_IDS.visualTag],
        props: visual.props(uploaded),
        ...(parent === null ? {} : { parent }),
      },
    }),
  );
  if (added === null) return yield* domainError("internal", "node.add answered no id");
  return { id: added, asset: uploaded };
});

/** A picture from the network, downloaded from a host `allowed` names, then filed. */
const keep = Effect.fn("gallery.keep")(function* (
  send: SourceFetch,
  allowed: (host: string) => boolean,
  url: string,
  visual: Kept,
) {
  const { bytes, ext } = yield* download(send, allowed, url);
  return yield* file(base64Of(bytes), ext, visual);
});

export function saveEffect(send: SourceFetch) {
  return Effect.fn("ext.gallery.save")(function* (
    input: z.infer<typeof gallerySaveDef.inputSchema>,
  ): Effect.fn.Return<{ id: string; asset: string }, DomainError, KbCtx> {
    const { adapter } = yield* adapterOf(input.source);
    // A saved visual links its page; a caller's result is held to what a search admits.
    if (!admitted(adapter, input.result))
      return yield* domainError(
        "invalid_input",
        "a result's image and thumbnail must be on the source's hosts, and its page https",
      );
    return yield* keep(send, adapter.hosts, input.result.image, {
      text: input.result.title,
      props: (asset) => visualProps(input.result, asset),
      parent: input.parent,
    });
  });
}

/**
 * The hosts Capture fetches a picture from: image hosts that serve the
 * picture itself at the link a person copies, and every search source's.
 */
const IMAGE_HOSTS: ReadonlySet<string> = new Set([
  "upload.wikimedia.org",
  "images.unsplash.com",
  "live.staticflickr.com",
  "images.pexels.com",
  "cdn.pixabay.com",
  "i.imgur.com",
  "i.pinimg.com",
  "pbs.twimg.com",
  "i.redd.it",
]);

export function captureHosts(host: string): boolean {
  return IMAGE_HOSTS.has(host) || SOURCE_ADAPTERS.some((adapter) => adapter.hosts(host));
}

export function captureEffect(send: SourceFetch) {
  return Effect.fn("ext.gallery.capture")(function* (
    input: z.infer<typeof galleryCaptureDef.inputSchema>,
  ): Effect.fn.Return<{ id: string; asset: string }, DomainError, KbCtx> {
    if (!reachable(input.url, captureHosts))
      return yield* domainError(
        "forbidden",
        `${URL.canParse(input.url) ? new URL(input.url).hostname : input.url} is not one of the image hosts the gallery fetches from`,
      );
    const title = input.text.replace(/[[\]]/g, "");
    return yield* keep(send, captureHosts, input.url, {
      text: input.text,
      props: (asset) => [
        str(GALLERY_IDS.mediaField, `![${title}](${asset})`),
        str(GALLERY_IDS.sourceField, input.url),
      ],
      parent: input.parent,
    });
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

/** `ext.gallery.starter`: the starter outline, its `Library` as the gallery's `save into`, then its pictures there. */
export const starterEffect = Effect.fn("ext.gallery.starter")(function* (): Effect.fn.Return<
  { library: string; ids: string[]; visuals: string[] },
  DomainError,
  KbCtx
> {
  const outline = starterOutline();
  const added = yield* call({ id: "node.addTree", input: { outline: outline.text } });
  const library = idAtLine(added, outline.library);
  if (library === null) return yield* domainError("internal", "node.addTree answered no Library");
  yield* call({
    id: "node.update",
    input: {
      id: extensionNodeId("gallery"),
      setProps: [{ field: GALLERY_IDS.saveIntoField, value: { t: "ref", v: library } }],
    },
  });
  const visuals = yield* Effect.forEach(STARTER_VISUALS, (visual) =>
    file(visual.jpeg, "jpg", {
      text: visual.title,
      props: (asset) => [
        str(GALLERY_IDS.mediaField, `![${visual.title}](${asset})`),
        str(GALLERY_IDS.sourceField, visual.page),
        str(GALLERY_IDS.creditField, `by ${visual.creator}, ${visual.date} · ${visual.licence}`),
        num(GALLERY_IDS.widthField, visual.width),
        num(GALLERY_IDS.heightField, visual.height),
        ...visual.styles.flatMap((style) => {
          const line = outline.styles.get(style);
          const id = line === undefined ? null : idAtLine(added, line);
          return id === null
            ? []
            : [{ field: GALLERY_IDS.stylesField, value: { t: "ref", v: id } }];
        }),
      ],
      parent: library,
    }).pipe(Effect.map(({ id }) => id)),
  );
  return { library, ids: idsOf(added), visuals };
});
