/**
 * A proposed view node: a view, settings for it, and the node it is shown
 * for, checked and turned into the props a view node stores, and the write
 * that files it. DESIGN.md → Kinds, roles and options → View nodes states
 * what a proposal promises. Core's `view.propose` commits the write, and a
 * family that writes a view node from settings inside a larger write (a
 * canvas moving its camera onto one) plans it here too, so each writes what
 * an agent's `view.propose` would.
 */
import { Effect, Predicate, Result } from "effect";
import {
  SYSTEM_IDS,
  canonicalJson,
  currentIso,
  domainError,
  freshId,
  hostViewIds,
  placedRank,
  type DomainError,
  type KbNode,
  type NodeId,
  type PropValue,
  type SiblingGroups,
} from "@kb/model";
import { issueText, paramsIssues, type ViewIssue, type ViewKey } from "./view-key.ts";

/** A proposal that checks out: the settings as decoded, and the props that hold them. */
export interface ViewNodeProposal<P> {
  readonly key: ViewKey<P>;
  readonly params: P;
  /** The view node's props: the view it names (`sys.f.view`), then its settings. */
  readonly props: Record<NodeId, PropValue[]>;
}

/**
 * The view node that shows `key`'s view with `input` as its settings, for
 * `host` (the node it is shown for, null when none), or every issue that
 * stops it, each at its path. It is the one check of a proposed view:
 *
 * 1. `input` must be the view's params, every setting legal and none the view
 *    does not declare (`paramsIssues`, strict).
 * 2. The params are written as the view stores them (`config.write`), and the
 *    props must read back (`config.read`, for `host`) as those same params,
 *    with nothing reported. A setting the view takes from its host or its
 *    route instead of a view node, which a view node therefore cannot hold,
 *    is named here by its path.
 *
 * Nothing is written: the caller writes the props.
 */
export function viewNodeFor<P>(
  key: ViewKey<P>,
  input: unknown,
  host: NodeId | null,
): Result.Result<ViewNodeProposal<P>, readonly ViewIssue[]> {
  const params = paramsIssues(key, input, true);
  if (Result.isFailure(params)) return Result.fail(params.failure);
  const settings = key.config.write(params.success);
  const reported: string[] = [];
  const back = paramsIssues(
    key,
    key.config.read(settings, host, (warning) => reported.push(warning)),
  );
  const issues: ViewIssue[] = reported.map((message) => ({ path: [], message }));
  if (Result.isFailure(back))
    issues.push(...back.failure.map((issue) => unheld(key, issue.path, issue.message)));
  else issues.push(...differences(key, params.success, back.success));
  if (issues.length > 0) return Result.fail(issues);
  return Result.succeed({
    key,
    params: params.success,
    props: { [SYSTEM_IDS.viewField]: [{ t: "ref", v: key.option }], ...settings },
  });
}

/** A setting a view node of `key` cannot hold: what it reads back as instead. */
function unheld(key: ViewKey<unknown>, path: readonly string[], readsBack: string): ViewIssue {
  return {
    path,
    message: `a view node of ${key.id} cannot hold this setting; it reads back as: ${readsBack}`,
  };
}

/** Each top-level setting whose stored form reads back as something else. */
function differences(key: ViewKey<unknown>, asked: unknown, back: unknown): ViewIssue[] {
  if (!Predicate.isObject(asked) || !Predicate.isObject(back))
    return canonicalJson(asked) === canonicalJson(back)
      ? []
      : [unheld(key, [], canonicalJson(back))];
  return Object.keys(asked).flatMap((setting) =>
    canonicalJson(asked[setting]) === canonicalJson(back[setting])
      ? []
      : [
          unheld(
            key,
            [setting],
            back[setting] === undefined ? "nothing" : canonicalJson(back[setting]),
          ),
        ],
  );
}

/** The host with `viewId` among its views: last, or first when it is to be the default. */
function naming(host: KbNode, viewId: string, first: boolean, at: string): KbNode {
  const others = hostViewIds(host);
  const views = first ? [viewId, ...others] : [...others, viewId];
  return {
    ...host,
    props: { ...host.props, [SYSTEM_IDS.viewsField]: views.map((v) => ({ t: "ref", v })) },
    updatedAt: at,
  };
}

/** What a view proposal asks for: the view's settings, the node it is shown for, and the node's own. */
export interface ViewProposal {
  readonly params: unknown;
  readonly host?: string | undefined;
  readonly text: string;
  /** First among the host's views, so its default. */
  readonly default: boolean;
  readonly id?: string | undefined;
}

/** A planned view node: the node, what it checked as, and the tx that writes it. */
export interface PlannedView {
  readonly node: KbNode;
  readonly host: KbNode | null;
  readonly params: unknown;
  readonly upserts: readonly KbNode[];
}

/**
 * The write a view proposal makes over a graph as it reads now: nodes found
 * by `nodeOf`, and the new node ranked among its siblings in `groups`. The
 * view node is filed at the end of the Views list (a store without one files
 * it at the forest roots), and the host names it among its views.
 */
export const planViewProposal = Effect.fn("view.propose.plan")(function* (
  nodeOf: (id: NodeId) => KbNode | undefined,
  groups: SiblingGroups<KbNode>,
  key: ViewKey<unknown>,
  proposal: ViewProposal,
): Effect.fn.Return<PlannedView, DomainError> {
  const hostId = proposal.host;
  const host = hostId === undefined ? null : (nodeOf(hostId) ?? null);
  if (hostId !== undefined && host === null)
    return yield* domainError("not_found", `node not found: ${hostId}`, { id: hostId });
  const checked = viewNodeFor(key, proposal.params, host?.id ?? null);
  if (Result.isFailure(checked))
    return yield* domainError(
      "invalid_input",
      `${key.id}: ${checked.failure.map(issueText).join("; ")}`,
      { view: key.id, issues: checked.failure },
    );

  const at = yield* currentIso;
  const id = proposal.id ?? (yield* freshId);
  if (nodeOf(id) !== undefined)
    return yield* domainError("ambiguous", `node id already exists: ${id}`, { id });
  const list = nodeOf(SYSTEM_IDS.viewsList);
  const draft: KbNode = {
    id,
    text: proposal.text,
    props: checked.success.props,
    children: [],
    createdAt: at,
    updatedAt: at,
  };
  const node: KbNode = {
    ...draft,
    order: placedRank(groups, list?.id ?? null, draft, undefined),
  };
  const upserts: KbNode[] = [node];
  if (list !== undefined)
    upserts.push({ ...list, children: [...list.children, id], updatedAt: at });
  if (host !== null) upserts.push(naming(host, id, proposal.default, at));
  return { node, host, params: checked.success.params, upserts };
});
