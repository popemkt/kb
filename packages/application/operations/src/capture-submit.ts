import { Effect } from "effect";
import {
  Assets,
  CAPTURE_SUBMIT,
  CaptureDeviceDigest,
  CaptureReceiptSchema,
  CaptureSubmitSchema,
  KbCtx,
  type ActionDefinition,
  type CaptureSubmit,
} from "@kb/contracts";
import {
  SYSTEM_IDS,
  canonicalJson,
  currentIso,
  domainError,
  fieldTypeOf,
  freshId,
  mediaKindFromHref,
  planNodeAdd,
  present,
  refValuesOf,
  strValueOf,
  syncDomain,
  type DomainError,
  type KbNode,
  type NodeId,
  type NodeGraph,
  type PropEntry,
} from "@kb/model";
import { ASSET_MAX_BYTES, prepareAsset, sanitizeExt } from "./assets.ts";
import { captureCredential, captureStore } from "./capture-devices.ts";
import { CAPTURE_IDS, captureDigest, digestText, recordsIn } from "./capture-model.ts";
import { placeOf, placedGraph } from "./place.ts";
import { persistPlannedEffect } from "./session.ts";

export const captureSubmitDef = {
  id: CAPTURE_SUBMIT,
  title: "Submit a raw capture",
  description:
    "File an original share through the store's capture target and return its durable receipt.",
  mode: { kind: "write" },
  callers: ["person", "program", "capture-device"],
  batchOf: ["node.add", "asset.upload"],
  inputSchema: CaptureSubmitSchema,
  outputSchema: CaptureReceiptSchema,
} satisfies ActionDefinition;

function soleHttpUrl(text: string | undefined): string | undefined {
  const candidate = text?.trim();
  if (candidate === undefined || !/^https?:\/\/\S+$/i.test(candidate)) return undefined;
  return URL.canParse(candidate) ? candidate : undefined;
}

const urlProps = Effect.fn("capture.urlProps")(function* (
  graph: NodeGraph,
  url: string | undefined,
): Effect.fn.Return<PropEntry[], DomainError> {
  if (url === undefined) return [];
  const [fieldId = CAPTURE_IDS.urlField] = refValuesOf(
    graph.get(CAPTURE_IDS.settings),
    CAPTURE_IDS.urlSetting,
  );
  const field = graph.get(fieldId);
  if (
    !refValuesOf(field, SYSTEM_IDS.typeField).includes(SYSTEM_IDS.field) ||
    fieldTypeOf(field?.props, (id) => graph.get(id)) !== "url"
  ) {
    return yield* domainError(
      "invalid_input",
      "configure a URL field for capture in Core settings",
      { fieldId },
    );
  }
  return [{ field: fieldId, value: { t: "str", v: url } }];
});

const uploadedPath = /^assets\/[a-z0-9_-]+\.[a-z0-9]{1,12}$/i;

function attachmentFailure(index: number, name: string) {
  return (err: DomainError) =>
    domainError(err.code, `attachment ${index + 1} (${name}): ${err.message}`, { index, name });
}

const attachment = Effect.fn("capture.attachment")(function* (
  file: NonNullable<CaptureSubmit["files"]>[number],
) {
  const assets = yield* Assets;
  if ("path" in file) {
    if (!uploadedPath.test(file.path)) {
      return yield* domainError("invalid_input", "expected a path returned by asset.upload");
    }
    yield* syncDomain(() => sanitizeExt(undefined, file.path));
    yield* assets.read(file.path, ASSET_MAX_BYTES);
    return { write: Effect.succeed(file.path) };
  }
  const prepared = yield* prepareAsset({
    bytes: file.bytes,
    encoding: "base64",
    filename: file.name,
  });
  const id = yield* captureDigest(new Uint8Array(prepared.data));
  return {
    write: assets.write(id, prepared.ext, prepared.data),
  };
});

function attachmentText(name: string, path: string): string {
  const label = name.replace(/[[\]\\\r\n]/g, " ");
  const prefix = mediaKindFromHref(path) === null ? "" : "!";
  return `${prefix}[${label}](${path})`;
}

export const captureSubmitEffect = Effect.fn("capture.submit")(function* (input: CaptureSubmit) {
  const ctx = yield* KbCtx;
  const store = yield* captureStore(ctx.root);
  if (input.target?.store !== undefined && input.target.store !== store.key) {
    return yield* domainError("not_found", "capture targets a different store", {
      store: input.target.store,
    });
  }
  const credential = yield* CaptureDeviceDigest;
  const captureId = input.captureId.toLowerCase();
  const { version: _version, ...raw } = input;
  const digest = yield* digestText(canonicalJson({ ...raw, captureId }));
  const url = input.url ?? soleHttpUrl(input.text);
  const body =
    url === undefined || (input.url !== undefined && input.text !== url) ? input.text : undefined;
  const title = (input.title ?? "").trim() === "" ? undefined : input.title;
  const files = input.files ?? [];
  if ((body ?? "").trim() === "" && url === undefined && files.length === 0) {
    return yield* domainError("invalid_input", "capture has no text, URL or files");
  }

  const plan = Effect.fn("capture.submit.plan")(function* (nodes: readonly KbNode[]) {
    const device = credential === undefined ? undefined : captureCredential(nodes, credential);
    if (credential !== undefined && device === undefined) {
      return yield* domainError("forbidden", "capture device credential is invalid or revoked");
    }
    const binding = yield* digestText(canonicalJson({ digest, deviceId: device?.id ?? null }));
    const earlier = recordsIn(nodes, CAPTURE_IDS.receipts).find(
      (record) => strValueOf(record, CAPTURE_IDS.key) === captureId,
    );
    if (earlier !== undefined) {
      const [nodeId] = refValuesOf(earlier, CAPTURE_IDS.result);
      if (nodeId === undefined || strValueOf(earlier, CAPTURE_IDS.digest) !== binding) {
        return yield* domainError(
          "conflict",
          "captureId was already used with different content or device",
          { captureId },
        );
      }
      return { receipt: { captureId, nodeId, store: store.key }, upserts: [], deletes: [] };
    }

    const place = yield* placeOf(input.target?.parent, nodes);
    const { graph, upserts } = placedGraph(nodes, place.upserts);
    const at = yield* currentIso;
    const nodeId = yield* freshId;
    const props = yield* urlProps(graph, url);
    const rootText = title ?? url ?? body ?? files[0]?.name ?? "";
    const { written } = yield* syncDomain(() =>
      planNodeAdd(
        graph,
        {
          text: rootText,
          props,
          ...(place.parent === null ? {} : { parent: place.parent }),
        },
        nodeId,
        at,
      ),
    );

    const prepared = yield* Effect.forEach(files, (file, index) =>
      attachment(file).pipe(Effect.mapError(attachmentFailure(index, file.name))),
    );
    const children = body === undefined || body === rootText ? [] : [body];
    // GAP [[01M7QT8YBS8V0B97VWRP4D717F]] Retried writes reuse each atomic, content-derived asset.
    for (const [index, asset] of prepared.entries()) {
      const file = present(files[index], "one file per prepared attachment");
      const path = yield* asset.write.pipe(Effect.mapError(attachmentFailure(index, file.name)));
      children.push(attachmentText(file.name, path));
    }
    const childIds: NodeId[] = [];
    for (const text of children) {
      const id = yield* freshId;
      const child = yield* syncDomain(() => planNodeAdd(graph, { text, parent: nodeId }, id, at));
      childIds.push(...child.written);
    }
    const recordId = yield* freshId;
    const record = yield* syncDomain(() =>
      planNodeAdd(
        graph,
        {
          parent: CAPTURE_IDS.receipts,
          text: "Capture receipt",
          props: [
            { field: CAPTURE_IDS.key, value: { t: "str", v: captureId } },
            { field: CAPTURE_IDS.digest, value: { t: "str", v: binding } },
            { field: CAPTURE_IDS.result, value: { t: "ref", v: nodeId } },
            { field: CAPTURE_IDS.capturedAt, value: { t: "str", v: input.capturedAt } },
            ...(input.source?.app === undefined
              ? []
              : [{ field: CAPTURE_IDS.source, value: { t: "str" as const, v: input.source.app } }]),
          ],
        },
        recordId,
        at,
      ),
    );

    return {
      receipt: { captureId, nodeId, store: store.key },
      upserts: upserts([...written, ...childIds, ...record.written]),
      deletes: [],
    };
  });
  return present(yield* persistPlannedEffect(ctx, plan), "capture planning supplies a receipt")
    .receipt;
});
