import {
  extractMentions,
  fieldTypeOf,
  type FieldType,
  type KbNode,
  type NodeId,
  type PropValue,
} from "@kb/model";

/**
 * The ref attributes the datom build derives from a node, beside the ones a
 * node states (its id, text, children and props): each is one entry of one
 * table (`CORE_DERIVED`), named once with its cardinality and fed by the
 * carriers declared for it. The build reads only the table, so a new way of
 * pointing at a node is a carrier added to an entry, and a new derived
 * relation is an entry — never a second pass beside the build.
 *
 * `:node/mentions` is THE reference relation — "this node references that
 * one" — and it is carrier-independent by design. A question about the
 * relation ("what references X?" — `kb backlinks`, the UI's References
 * section) never has to remember which carrier was used; asking twice and
 * unioning at every call site is the second `if` on one distinction that
 * Rule 1 forbids. The carrier distinction survives only where it is
 * genuinely a lens: the graph's `mention` / `ref-prop` edge kinds, which
 * label provenance and scan text and props separately for exactly that
 * reason.
 */

/**
 * The declared type of each field, in the graph a node is read in: how a
 * carrier tells a date from text when both are stored as `{t:"str"}`.
 */
export type FieldTypes = (field: NodeId) => FieldType;

/** {@link FieldTypes} over the graph `nodeOf` reads, as every surface reads a field's type (`fieldTypeOf`). */
export function fieldTypesIn(nodeOf: (id: NodeId) => KbNode | undefined): FieldTypes {
  return (field) => fieldTypeOf(nodeOf(field)?.props, nodeOf);
}

/**
 * One reference a carrier reads off a node: the id it names, and the field
 * whose value names it. A reference in no field (the node's own text, the
 * owner a host hands the index) has none.
 */
export interface CarriedRef {
  readonly id: NodeId;
  readonly field?: NodeId;
}

/**
 * One way a node points at other nodes: the references it reads, resolvable
 * or not, in order. What it reads is the node itself and the declared type of
 * each field the node holds, and nothing else of the graph, so the index
 * knows when to read it again: when the node changes, when a target starts
 * or stops existing, or when a field it holds changes type.
 */
export interface RefCarrier {
  readonly refsOf: (node: KbNode, types: FieldTypes) => Iterable<CarriedRef>;
}

/**
 * A ref attribute derived at build: one datom per (node, target that
 * exists) from every carrier feeding it, deduplicated, so the attribute
 * reads the same whichever carrier produced a reference.
 */
export interface DerivedRef {
  readonly attr: `:node/${string}`;
  readonly cardinality: "one" | "many";
  readonly carriers: readonly RefCarrier[];
}

/**
 * Every id a node mentions in text: `[[id]]` tokens in its own text and in
 * each text (`{t:"str"}`) value it holds. A token is a mention wherever the
 * text lives — a text field's value is written, rendered and followed exactly
 * like node text, so it references exactly like node text. In order, with
 * repeats (a caller that wants a set dedupes).
 */
export function nodeMentions(node: Pick<KbNode, "text" | "props">): NodeId[] {
  return textTokens(node).map((ref) => ref.id);
}

/** {@link nodeMentions} as references: a token in a text value is in that value's field. */
function textTokens(node: Pick<KbNode, "text" | "props">): CarriedRef[] {
  const out: CarriedRef[] = extractMentions(node.text).map((id) => ({ id }));
  for (const [field, values] of Object.entries(node.props)) {
    for (const pv of values)
      if (pv.t === "str") out.push(...extractMentions(pv.v).map((id) => ({ id, field })));
  }
  return out;
}

/** A `[[id]]` token in text, the node's own or a text value's (`nodeMentions`). */
const TEXT_TOKENS: RefCarrier = { refsOf: textTokens };

/** A `{t:"ref"}` prop value, in any field. */
const REF_PROPS: RefCarrier = {
  refsOf: (node) =>
    Object.entries(node.props).flatMap(([field, values]) =>
      values.flatMap((pv) => (pv.t === "ref" ? [{ id: pv.v, field }] : [])),
    ),
};

/** The reference relation's attribute: "this node references that one" (`CORE_DERIVED`). */
const REFERENCE_ATTR = ":node/mentions";

/** The carriers that feed the reference relation in `derived`. */
export function referenceCarriers(derived: readonly DerivedRef[]): readonly RefCarrier[] {
  return derived.find((d) => d.attr === REFERENCE_ATTR)?.carriers ?? [];
}

/**
 * The derived ref attributes every index builds:
 * - `:node/mentions`, the reference relation, fed by text and ref props;
 * - `:node/owner`, the declaration a seeded node came from, as its family's
 *   node. It is fed only by the owners a host hands the index
 *   (`derivedWith`), so an index built without them derives none.
 */
export const CORE_DERIVED: readonly DerivedRef[] = [
  { attr: REFERENCE_ATTR, cardinality: "many", carriers: [TEXT_TOKENS, REF_PROPS] },
  { attr: ":node/owner", cardinality: "one", carriers: [] },
];

/** The field a value is in, as a {@link ValueRefCarrier} reads it: its id and declared type. */
export interface ValueField {
  readonly id: NodeId;
  readonly type: FieldType;
}

/**
 * Values that carry references a family knows how to read, beyond `[[id]]`
 * tokens and ref values: a canvas document's cards in the canvas field, or
 * a date in any date-typed field. A family declares it
 * (`ExtensionDeclaration.refCarriers`), and the reference relation reads it
 * as one more carrier.
 */
export interface ValueRefCarrier {
  /** The one field whose values it reads; absent, it reads every field's. */
  readonly field?: NodeId;
  /** The node ids one value points at, given the field it is in; none for a value it cannot read. */
  readonly refsOf: (value: PropValue, field: ValueField) => Iterable<NodeId>;
}

/** `carrier` as a node's carrier: what each value it reads points at, in prop order. */
function valueCarrier({ field, refsOf }: ValueRefCarrier): RefCarrier {
  return {
    refsOf: (node, types) =>
      Object.entries(node.props)
        .filter(([held]) => field === undefined || held === field)
        .flatMap(([held, values]) => {
          const at: ValueField = { id: held, type: types(held) };
          return values.flatMap((value) =>
            [...refsOf(value, at)].map((id) => ({ id, field: held })),
          );
        }),
  };
}

/**
 * Each seeded node's owner, as the id of the node it is owned by: the
 * family node (`sys.extension.<name>`) of the declaration whose seed holds
 * it. A family's own node is one of its seed's, but a node is never its own
 * owner, so it carries none.
 */
function ownerCarrier(owners: ReadonlyMap<NodeId, NodeId>): RefCarrier {
  return {
    refsOf: (node) => {
      const owner = owners.get(node.id);
      return owner === undefined || owner === node.id ? [] : [{ id: owner }];
    },
  };
}

/** What the families of a host add to `CORE_DERIVED`, read from their declarations and their fold. */
export interface DerivedSources {
  /** The values they say carry references (`ValueRefCarrier`). */
  readonly carriers?: readonly ValueRefCarrier[];
  /** Who owns each node they seed, as the owner's node id (`ownerCarrier`). */
  readonly owners?: ReadonlyMap<NodeId, NodeId>;
}

/**
 * `CORE_DERIVED`, each entry fed by what `sources` add to it: each value
 * carrier feeds the reference relation, and the owners feed `:node/owner`
 * and, an owner being a node its seed points at, the reference relation too,
 * so a family's node lists what it seeds among its References.
 */
export function derivedWith({ carriers = [], owners }: DerivedSources): readonly DerivedRef[] {
  const owner = owners === undefined ? [] : [ownerCarrier(owners)];
  const fed: Readonly<Record<DerivedRef["attr"], readonly RefCarrier[]>> = {
    [REFERENCE_ATTR]: [...carriers.map(valueCarrier), ...owner],
    ":node/owner": owner,
  };
  return CORE_DERIVED.map((entry) => ({
    ...entry,
    carriers: [...entry.carriers, ...(fed[entry.attr] ?? [])],
  }));
}
