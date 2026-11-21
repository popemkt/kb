import { Effect } from "effect";
import { FileSystem } from "effect/FileSystem";
import { KbCtx, SavedQueries } from "@kb/contracts";
import { SYSTEM_IDS, type KbNode, type NodeId } from "@kb/model";
import { parseViewFilterEdn } from "@kb/views";
import {
  auditOutput,
  buildCheckModel,
  derivedEnforcement,
  isCheck,
  propRefs,
  propText,
  propValues,
  type CheckModel,
  type EmptyInput,
  type Finding,
} from "./model.ts";
import { isFile, pathInRoot } from "./repo-files.ts";
import { findInvocationUnwired } from "./surface-invocations.ts";
import { textMatchesOf } from "./text-matches.ts";

/** GitHub's anchor for a heading: lower case, punctuation dropped (`_` and `-` kept), spaces to `-`. */
function githubHeadingSlug(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{N}\s_-]/gu, "")
    .replaceAll(/\s/g, "-");
}

function headingSlugs(markdown: string): Set<string> {
  const slugs = new Set<string>();
  for (const line of markdown.split("\n")) {
    const match = /^(?:#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    const heading = match?.[1];
    if (heading !== undefined) slugs.add(githubHeadingSlug(heading));
  }
  return slugs;
}

/**
 * A home in another repository is named by URL, and only its form is checked:
 * an `https:` URL with a host. The audit reads this repository, and reaching
 * the network would make a commit's answer depend on someone else's site.
 */
function urlHomeIsValid(home: string): boolean {
  if (!URL.canParse(home)) return false;
  const url = new URL(home);
  return url.protocol === "https:" && url.hostname !== "";
}

/** A home is a file in this repository, with an optional heading anchor, or an `https:` URL. */
const homeIsValid = Effect.fn("ext.check.homeIsValid")(function* (
  root: string,
  home: string | undefined,
) {
  if (home === undefined || home === "") return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(home)) return urlHomeIsValid(home);
  const hash = home.lastIndexOf("#");
  const pathText = hash < 0 ? home : home.slice(0, hash);
  const anchor = hash < 0 ? undefined : home.slice(hash + 1);
  const path = pathInRoot(root, pathText);
  if (!(yield* isFile(path))) return false;
  if (anchor === undefined) return true;
  if (anchor === "" || path === undefined || !pathText.toLowerCase().endsWith(".md")) return false;
  const fs = yield* FileSystem;
  const markdown = yield* fs.readFileString(path).pipe(Effect.orElseSucceed(() => ""));
  return headingSlugs(markdown).has(anchor);
});

function findCheckMissing(model: CheckModel): Finding[] {
  const checkMissing: Finding[] = [];
  for (const rule of model.rules) {
    for (const check of propRefs(model, rule, "check")) {
      if (!isCheck(model, check)) {
        checkMissing.push({
          kind: "check-missing",
          rule: rule.id,
          check,
          message: `rule ${rule.id} references ${check}, which is not tagged check`,
        });
      }
    }
  }
  return checkMissing;
}

const findEvidenceMissing = Effect.fn("ext.check.findEvidenceMissing")(function* (
  root: string,
  model: CheckModel,
) {
  const evidenceMissing: Finding[] = [];
  for (const check of model.checks) {
    const evidence = propText(model, check, "evidence");
    if (!(yield* isFile(pathInRoot(root, evidence)))) {
      evidenceMissing.push({
        kind: "evidence-missing",
        check: check.id,
        message: `check ${check.id} evidence is not a repo file: ${evidence ?? "(missing)"}`,
      });
    }
  }
  return evidenceMissing;
});

function findEnforcementStale(model: CheckModel): Finding[] {
  const enforcementStale: Finding[] = [];
  for (const rule of model.rules) {
    const derived = derivedEnforcement(model, rule);
    const stored = propText(model, rule, "enforcement");
    if (derived.value === undefined || stored !== derived.value) {
      enforcementStale.push({
        kind: "enforcement-stale",
        rule: rule.id,
        ...(derived.check === undefined ? {} : { check: derived.check }),
        message: `rule ${rule.id} enforcement is ${stored ?? "(missing)"}; expected ${derived.value ?? "one shared check surface"}`,
      });
    }
  }
  return enforcementStale;
}

function findGateAndCheck(model: CheckModel): Finding[] {
  const gateAndCheck: Finding[] = [];
  for (const rule of model.rules) {
    const checks = propRefs(model, rule, "check");
    if (checks.length > 0 && propValues(model, rule, "gate").length > 0) {
      gateAndCheck.push({
        kind: "gate-and-check",
        rule: rule.id,
        check: checks[0] ?? "",
        message: `rule ${rule.id} carries both gate and check`,
      });
    }
  }
  return gateAndCheck;
}

const findHomeBroken = Effect.fn("ext.check.findHomeBroken")(function* (
  root: string,
  model: CheckModel,
) {
  const homeBroken: Finding[] = [];
  for (const rule of model.rules) {
    const home = propText(model, rule, "home");
    if (!(yield* homeIsValid(root, home))) {
      homeBroken.push({
        kind: "home-broken",
        rule: rule.id,
        message: `rule ${rule.id} home does not resolve: ${home ?? "(missing)"}`,
      });
    }
  }
  return homeBroken;
});

/** What a query names by text: the literals it matches node text against by equality. */
function queryTextRef(edn: string): string | undefined {
  const texts = textMatchesOf(edn);
  return texts.length === 0
    ? undefined
    : `matches node text against ${texts.map((text) => JSON.stringify(text)).join(", ")}`;
}

/**
 * What a view filter names by text: its field, when that is not a field
 * node's id, or its value, when the field holds references and the value is
 * not a node's id. Matching by contains (`{:text …}`) is search.
 */
function filterTextRef(nodesById: ReadonlyMap<NodeId, KbNode>, edn: string): string | undefined {
  const filter = parseViewFilterEdn(edn);
  if (filter?.kind !== "field-is") return undefined;
  const field = nodesById.get(filter.field);
  const isField = (field?.props[SYSTEM_IDS.typeField] ?? []).some(
    (value) => value.t === "ref" && value.v === SYSTEM_IDS.field,
  );
  if (field === undefined || !isField) return `names its field by text: ${filter.field}`;
  const holdsRefs = (field.props[SYSTEM_IDS.fieldTypeField] ?? []).some(
    (value) => value.t === "ref" && value.v === SYSTEM_IDS.ftRef,
  );
  const value = filter.values[0].v;
  return holdsRefs && !nodesById.has(value)
    ? `names a value of ${field.id} by text: ${JSON.stringify(value)}`
    : undefined;
}

/**
 * Every stored reference that names a node by its text: a query held in any
 * node's value (a query node's, a lens's, an ontology's, a check's — a value
 * that reads as one datalog query is one, whichever field holds it), a saved
 * query, and a view's filter.
 */
const findRefByText = Effect.fn("ext.check.findRefByText")(function* (nodes: readonly KbNode[]) {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const refByText: Finding[] = [];
  for (const node of nodes) {
    for (const [field, values] of Object.entries(node.props)) {
      for (const value of values) {
        if (value.t !== "str") continue;
        const named =
          field === SYSTEM_IDS.viewFilterField
            ? filterTextRef(nodesById, value.v)
            : queryTextRef(value.v);
        if (named === undefined) continue;
        refByText.push({
          kind: "ref-by-text",
          at: node.id,
          message: `${field} on ${node.id} ${named}; name the node by :node/id`,
        });
      }
    }
  }
  for (const query of yield* (yield* SavedQueries).list) {
    const named = queryTextRef(query.edn);
    if (named === undefined) continue;
    const at = `.kb/queries/${query.name}.edn`;
    refByText.push({
      kind: "ref-by-text",
      at,
      message: `${at} ${named}; name the node by :node/id`,
    });
  }
  return refByText;
});

export const checkAuditEffect = Effect.fn("ext.check.audit")(function* (_input: EmptyInput) {
  const ctx = yield* KbCtx;
  const model = buildCheckModel(ctx.nodes);
  const checkMissing = findCheckMissing(model);
  const evidenceMissing = yield* findEvidenceMissing(ctx.root, model);
  const invocationUnwired = yield* findInvocationUnwired(ctx.root, model);
  const enforcementStale = findEnforcementStale(model);
  const gateAndCheck = findGateAndCheck(model);
  const homeBroken = yield* findHomeBroken(ctx.root, model);
  const refByText = yield* findRefByText(ctx.nodes);

  const findings = [
    ...checkMissing,
    ...evidenceMissing,
    ...invocationUnwired,
    ...enforcementStale,
    ...gateAndCheck,
    ...homeBroken,
    ...refByText,
  ];
  return auditOutput.parse({ clean: findings.length === 0, findings });
});
