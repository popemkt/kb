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
  changedFields,
  currentIso,
  domainError,
  freshId,
  hostViewIds,
  placedRank,
  viewHostsOf,
  viewOptionOf,
  type DomainError,
  type KbNode,
  type NodeId,
  type NodeProps,
  type NodeWrite,
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
  const { reported, back } = readViewNode(key, settings, host);
  const issues: ViewIssue[] = [...reported];
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

/**
 * A view node's stored settings read by `key` for `host` (the node it is
 * shown for, null when none): what its read reported, each at the root, and
 * the params they decode as, or each setting they cannot decode, at its
 * path. The one reading of stored settings that both a proposal's round trip
 * and the commit's check of a written view node take.
 */
function readViewNode<P>(
  key: ViewKey<P>,
  props: NodeProps,
  host: NodeId | null,
): {
  readonly reported: readonly ViewIssue[];
  readonly back: Result.Result<P, readonly ViewIssue[]>;
} {
  const reported: ViewIssue[] = [];
  const read = key.config.read(props, host, (message) => reported.push({ path: [], message }));
  return { reported, back: paramsIssues(key, read) };
}

/** Every issue a view node's stored settings have for `host`: reported, then undecodable. */
function storedIssues(key: ViewKey<unknown>, props: NodeProps, host: NodeId | null): ViewIssue[] {
  const { reported, back } = readViewNode(key, props, host);
  return Result.isFailure(back) ? [...reported, ...back.failure] : [...reported];
}

/** A view node a commit writes whose settings its view cannot read, and why. */
export interface WrittenViewIssue {
  readonly id: NodeId;
  readonly view: string;
  readonly issues: readonly ViewIssue[];
}

/** The graph as a commit leaves it: `stored`, with each of `writes` applied. */
function* committed(stored: Iterable<KbNode>, writes: readonly NodeWrite[]): Iterable<KbNode> {
  const written = new Map<NodeId, KbNode | undefined>();
  for (const { before, after } of writes) written.set(after?.id ?? before?.id ?? "", after);
  for (const node of stored) {
    if (!written.has(node.id)) yield node;
  }
  for (const node of written.values()) if (node !== undefined) yield node;
}

/**
 * The first view node `writes` leave holding a setting its view cannot read
 * (DESIGN.md → View nodes → every write of a view node is checked by its
 * key), whatever action wrote it. A view is judged by its key, found by
 * `keyOf` from the node's view option; a view no key is found for (its
 * family not loaded) is not judged, as the data outlives the code. It is
 * read for the node that names it among its views once the commit lands
 * (`viewHostsOf`), as a proposal is read for its host.
 *
 * Only what a write adds is judged, as a value is (`tx.ts`): a node whose
 * props the write leaves as they were is passed over, and an issue its
 * settings already had is not counted, so a store that holds an unreadable
 * setting stays editable and the view's read reports it as before. A field
 * the view does not read is a person's own, never an issue.
 */
export function writtenViewIssue(
  keyOf: (option: NodeId) => ViewKey<unknown> | undefined,
  writes: readonly NodeWrite[],
  stored: () => Iterable<KbNode>,
): WrittenViewIssue | null {
  const judged = writes.flatMap(({ before, after }) => {
    if (after === undefined || changedFields(before, after).length === 0) return [];
    const option = viewOptionOf(after);
    const key = option === null ? undefined : keyOf(option);
    return key === undefined ? [] : [{ before, after, key }];
  });
  if (judged.length === 0) return null;
  const hostOf = viewHostsOf(committed(stored(), writes));
  for (const { before, after, key } of judged) {
    const host = hostOf(after.id) ?? null;
    const held =
      before !== undefined && viewOptionOf(before) === key.option
        ? new Set(storedIssues(key, before.props, host).map(issueText))
        : new Set<string>();
    const issues = storedIssues(key, after.props, host).filter(
      (issue) => !held.has(issueText(issue)),
    );
    if (issues.length > 0) return { id: after.id, view: key.id, issues };
  }
  return null;
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
