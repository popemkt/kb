import { Effect } from "effect";
import { FileSystem } from "effect/FileSystem";
import { KbCtx } from "@kb/contracts";
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

const surfaceFiles = Effect.fn("ext.check.surfaceFiles")(function* (
  root: string,
  patterns: readonly string[],
) {
  const fs = yield* FileSystem;
  const files = new Set<string>();
  for (const pattern of patterns) {
    const wildcard = pattern.indexOf("*");
    if (wildcard < 0) {
      const path = pathInRoot(root, pattern);
      if (path !== undefined && (yield* isFile(path))) files.add(path);
      continue;
    }

    const separator = pattern.lastIndexOf("/", wildcard);
    const directory = pathInRoot(root, separator < 0 ? "." : pattern.slice(0, separator));
    const basename = pattern.slice(separator + 1);
    const [prefix, suffix, extra] = basename.split("*");
    if (
      directory === undefined ||
      prefix === undefined ||
      suffix === undefined ||
      extra !== undefined
    ) {
      continue;
    }
    const entries = yield* fs
      .readDirectory(directory)
      .pipe(Effect.orElseSucceed((): string[] => []));
    for (const entry of entries) {
      if (!entry.startsWith(prefix) || !entry.endsWith(suffix)) continue;
      const path = pathInRoot(
        root,
        `${separator < 0 ? "" : pattern.slice(0, separator + 1)}${entry}`,
      );
      if (path !== undefined && (yield* isFile(path))) files.add(path);
    }
  }
  return [...files].toSorted();
});

const invocationIsWired = Effect.fn("ext.check.invocationIsWired")(function* (
  root: string,
  model: CheckModel,
  surface: string | undefined,
  invocation: string | undefined,
) {
  const patterns = surface === undefined ? undefined : model.surfaceFiles.get(surface);
  if (patterns === undefined || invocation === undefined || invocation === "") return false;
  const fs = yield* FileSystem;
  const files = yield* surfaceFiles(root, patterns);
  for (const path of files) {
    const content = yield* fs.readFileString(path).pipe(Effect.orElseSucceed(() => ""));
    // A substring, not a whole command. GAP [[01M56TFECRSQN243PAEB6XGHRY]]
    if (content.includes(invocation)) return true;
  }
  return false;
});

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

const findInvocationUnwired = Effect.fn("ext.check.findInvocationUnwired")(function* (
  root: string,
  model: CheckModel,
) {
  const invocationUnwired: Finding[] = [];
  for (const check of model.checks) {
    const surface = propText(model, check, "surface");
    const invocation = propText(model, check, "invocation");
    if (!(yield* invocationIsWired(root, model, surface, invocation))) {
      invocationUnwired.push({
        kind: "invocation-unwired",
        check: check.id,
        message: `check ${check.id} invocation is not wired on ${surface ?? "(missing)"}: ${invocation ?? "(missing)"}`,
      });
    }
  }
  return invocationUnwired;
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

export const checkAuditEffect = Effect.fn("ext.check.audit")(function* (_input: EmptyInput) {
  const ctx = yield* KbCtx;
  const model = buildCheckModel(ctx.nodes);
  const checkMissing = findCheckMissing(model);
  const evidenceMissing = yield* findEvidenceMissing(ctx.root, model);
  const invocationUnwired = yield* findInvocationUnwired(ctx.root, model);
  const enforcementStale = findEnforcementStale(model);
  const gateAndCheck = findGateAndCheck(model);
  const homeBroken = yield* findHomeBroken(ctx.root, model);

  const findings = [
    ...checkMissing,
    ...evidenceMissing,
    ...invocationUnwired,
    ...enforcementStale,
    ...gateAndCheck,
    ...homeBroken,
  ];
  return auditOutput.parse({ clean: findings.length === 0, findings });
});
