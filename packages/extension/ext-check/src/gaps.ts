import { Effect } from "effect";
import { FileSystem } from "effect/FileSystem";
import { KbCtx } from "@kb/contracts";
import {
  buildCheckModel,
  gapsOutput,
  hasTag,
  propValues,
  type CheckModel,
  type GapFinding,
  type GapsInput,
} from "./model.ts";
import { isFile, pathInRoot } from "./repo-files.ts";

/**
 * A gap marker — `GAP` and the node id in double brackets — is a deferral
 * site naming the `#gap` node that records it (AGENTS.md → Drift markers and
 * gaps).
 */
const GAP_MARKER = /GAP\s+\[\[([^\]]+)\]\]/g;

/** The `status` values that close a gap: its marker has nothing left to name. */
const CLOSED_GAP_STATUSES: ReadonlySet<string> = new Set(["done", "dropped"]);

interface Marker {
  readonly file: string;
  readonly line: number;
  readonly id: string;
}

function markersIn(file: string, content: string): Marker[] {
  const markers: Marker[] = [];
  for (const [index, line] of content.split("\n").entries()) {
    for (const match of line.matchAll(GAP_MARKER)) {
      const id = match[1]?.trim();
      if (id !== undefined && id !== "") markers.push({ file, line: index + 1, id });
    }
  }
  return markers;
}

/** What is wrong with one marker, or nothing when it names an open `#gap`. */
function markerFinding(model: CheckModel, marker: Marker): GapFinding | undefined {
  const at = `${marker.file}:${marker.line}`;
  const located = { file: marker.file, line: marker.line, id: marker.id };
  const node = model.nodesById.get(marker.id);
  if (node === undefined) {
    return {
      kind: "gap-missing",
      ...located,
      message: `${at}: the gap marker names ${marker.id}, which is no node`,
    };
  }
  // Fail closed: a store that defines no #gap tag has no gap a marker can name.
  if (!hasTag(node, model.gapTagIds)) {
    return {
      kind: "gap-untagged",
      ...located,
      message: `${at}: the gap marker names ${marker.id}, which is not tagged #gap`,
    };
  }
  const closed = propValues(model, node, "status").find(
    (value) => typeof value.v === "string" && CLOSED_GAP_STATUSES.has(value.v),
  );
  if (closed !== undefined) {
    return {
      kind: "gap-closed",
      ...located,
      message: `${at}: the gap marker names ${marker.id}, which is ${String(closed.v)}; delete the marker or cite a gap still open`,
    };
  }
  return undefined;
}

/**
 * `ext.check.gaps`: every gap marker in the listed files names a
 * `#gap` node that is still open. The caller lists the files, so a root that
 * is not a git checkout (a pre-commit snapshot, say) is scanned exactly as
 * its index says; a listed file that cannot be read is a finding, not a skip.
 */
export const checkGapsEffect = Effect.fn("ext.check.gaps")(function* (input: GapsInput) {
  const ctx = yield* KbCtx;
  const fs = yield* FileSystem;
  const model = buildCheckModel(ctx.nodes);
  const findings: GapFinding[] = [];
  let markers = 0;
  for (const file of input.files) {
    const path = pathInRoot(ctx.root, file);
    const content =
      path !== undefined && (yield* isFile(path))
        ? yield* fs.readFileString(path).pipe(Effect.orElseSucceed(() => undefined))
        : undefined;
    if (content === undefined) {
      findings.push({
        kind: "file-unreadable",
        file,
        message: `${file}: not a readable file of this repository`,
      });
      continue;
    }
    for (const marker of markersIn(file, content)) {
      markers += 1;
      const finding = markerFinding(model, marker);
      if (finding !== undefined) findings.push(finding);
    }
  }
  return gapsOutput.parse({
    clean: findings.length === 0,
    scanned: input.files.length,
    markers,
    findings,
  });
});
