import {
  BACKDROP_DIRECTIONS,
  BACKDROP_DIRECTION_OPTION_IDS,
  BACKDROP_STRENGTHS,
  BACKDROP_STRENGTH_OPTION_IDS,
} from "./backdrop.ts";
import { SYSTEM_IDS, extensionNodeId, type KbNode, type NodeId, nowIso } from "./model.ts";
import {
  FIELD_TYPES,
  FIELD_TYPE_OPTION_IDS,
  cardinalityValue,
  childrenTargetQuery,
  fieldTypeValue,
  type FieldType,
} from "./field-type.ts";
import {
  MOTION_EFFECTS,
  MOTION_FIELD_IDS,
  MOTION_INTENSITIES,
  MOTION_MODES,
  MOTION_SPEEDS,
  MOTION_STYLES,
  motionEffectFieldId,
  motionOptionId,
  type MotionOptionSetting,
  type MotionSettings,
} from "./motion.ts";
import { ONTOLOGY_TARGET_QUERY } from "./ontology.ts";
import type { FoldedSeed } from "./seed-fold.ts";
import { retireSeeded } from "./seed-retirement.ts";
import {
  VIEW_FAMILY_VALUES,
  VIEW_NODE_TARGET_QUERY,
  VIEW_OPTION_TARGET_QUERY,
} from "./view-node.ts";

/**
 * Tags whose `sys.f.fields` template must stay in sync as fields are added to
 * the seed. Exported because it is a real invariant boundary: the generic
 * fill-absent pass does not apply to these, so the property test that asserts
 * the generic rule has to exclude exactly this set — reading it here instead of
 * restating it is what keeps the two from drifting. `sys.tag` is one because
 * it templates `view.default`: a seeded tag, opened before that field existed,
 * gains it in its editor like a tag made since.
 */
export const TEMPLATE_TAGS: readonly string[] = [
  SYSTEM_IDS.field,
  SYSTEM_IDS.ontologyTag,
  SYSTEM_IDS.tag,
];

/** What a field that holds one value declares: its cardinality. */
const SINGLE: KbNode["props"] = { [SYSTEM_IDS.cardinalityField]: [cardinalityValue("one")] };

/** What a field whose values are not drawn as field rows declares: hidden. */
const HIDDEN: KbNode["props"] = { [SYSTEM_IDS.hiddenField]: [{ t: "bool", v: true }] };

/** What a seed says of a field beside its id, name and type. */
interface FieldOptions {
  /** It holds one value, not a list. */
  readonly one?: boolean;
  /** Its values are not drawn as field rows (`sys.f.hidden`). */
  readonly hidden?: boolean;
  /** Any other declaration it carries. */
  readonly props?: KbNode["props"];
}

/**
 * A system field as a seed declares it, core's or a family's.
 *
 * Every seeded field declares its value type — text ones included. A field's
 * declared type is the contract its values are held to, and `fieldTypeOf`
 * reads an absent one as text: right for a user's untyped field, wrong for
 * nearly every system one (`sys.f.type` holds refs, `sys.f.hidden` a bool).
 * So no system field leans on that default; each says what it holds, and the
 * fill-absent pass of {@link ensureSystemSeed} carries the declaration to
 * older stores.
 *
 * A field that is one setting, not a list, says so (`one`). Absent means
 * many, so only the single-valued ones carry the declaration — and the
 * fill-absent pass carries it to stores seeded before it existed.
 *
 * A field whose values are not drawn as field rows says so too (`hidden`,
 * `sys.f.hidden`): one that is a node's structure (its kind, its template,
 * which option set it belongs to) or one a surface of its own draws and
 * writes (a query node's builder, a view's toolbar, the graph's lens
 * settings). Every other system field is drawn and edited like any field
 * (DESIGN.md → Data model → field visibility).
 */
export function seededField(
  id: string,
  text: string,
  type: FieldType,
  at: string,
  { one = false, hidden = false, props = {} }: FieldOptions = {},
): KbNode {
  return {
    id,
    text,
    props: {
      [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.field }],
      [SYSTEM_IDS.fieldTypeField]: [fieldTypeValue(type)],
      ...(one ? SINGLE : {}),
      ...(hidden ? HIDDEN : {}),
      ...props,
    },
    children: [],
    createdAt: at,
    updatedAt: at,
  };
}

/**
 * A system tag as a seed declares it, core's or a family's: a node typed
 * `sys.tag` whose `sys.f.fields` templates `fields`, in order. The template
 * is what a node tagged with it is offered to fill, so a tag and the fields
 * it stands for are declared together.
 */
export function seededTag(id: string, text: string, fields: readonly string[], at: string): KbNode {
  return {
    id,
    text,
    props: {
      [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.tag }],
      [SYSTEM_IDS.fieldsField]: fields.map((field) => ({ t: "ref", v: field })),
    },
    children: [],
    createdAt: at,
    updatedAt: at,
  };
}

/**
 * A command as a seed declares it, core's or a family's: a node typed
 * `sys.command`, which is what ⌘K offers. Its id is the command's, so the
 * `CommandPoint` contribution that runs it is found by that id.
 */
export function seededCommand(id: string, text: string, at: string): KbNode {
  return {
    id,
    text,
    props: { [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.command }] },
    children: [],
    createdAt: at,
    updatedAt: at,
  };
}

/**
 * Core's system nodes, the seed core's declaration contributes. Idempotent —
 * same ids every time. A store is never seeded with these alone: it is
 * seeded with the fold of every bundled declaration ({@link foldSeed}),
 * core's first, which also derives the view options these nodes refer to.
 */
export function systemSeedNodes(at: string = nowIso()): KbNode[] {
  const mk = (id: string, text: string, props: KbNode["props"] = {}): KbNode => ({
    id,
    text,
    props,
    children: [],
    createdAt: at,
    updatedAt: at,
  });

  const typedField = (id: string, text: string, type: FieldType, opts: FieldOptions = {}): KbNode =>
    seededField(id, text, type, at, opts);
  const singleField = (
    id: string,
    text: string,
    type: FieldType,
    opts: FieldOptions = {},
  ): KbNode => seededField(id, text, type, at, { ...opts, one: true });
  // A field whose values a node's structure or a surface of its own holds.
  const HIDE = { hidden: true } as const;

  // A field node's own configuration is a field template, exactly like a tag's.
  // That is what lets one rule — "surface the fields your kinds and tags
  // template" — serve tag pages, field pages, and ordinary tagged nodes alike,
  // instead of a bespoke panel per kind.
  const field = mk(SYSTEM_IDS.field, "sys.field", {
    [SYSTEM_IDS.fieldsField]: [
      { t: "ref", v: SYSTEM_IDS.fieldTypeField },
      { t: "ref", v: SYSTEM_IDS.cardinalityField },
      { t: "ref", v: SYSTEM_IDS.targetTagField },
      { t: "ref", v: SYSTEM_IDS.targetQueryField },
      { t: "ref", v: SYSTEM_IDS.relationInverseField },
    ],
  });
  const typeField = typedField(SYSTEM_IDS.typeField, "type", "ref", HIDE);
  const fieldsField = typedField(SYSTEM_IDS.fieldsField, "fields", "ref", HIDE);
  const colorField = singleField(SYSTEM_IDS.colorField, "color", "text");
  const hiddenField = singleField(SYSTEM_IDS.hiddenField, "hidden", "checkbox");
  /*
   * Field types are nodes, and they are the type field's **children** — the
   * option-set shape (DESIGN → Kinds, roles and options). A `field-type`
   * supertag once existed only so `targetTag` had something to point at; it
   * named no concept, because "text" is not a kind of thing, it is one of the
   * values `fieldType` may take. Parenting says exactly that and nothing more,
   * and it is what a user does for their own option list: add a child under
   * the field. The ordinary ref editor renders the type slot either way.
   * The sys options are write-guarded; a user's own list is not.
   */
  const fieldTypeOptions = FIELD_TYPES.map((type) => mk(FIELD_TYPE_OPTION_IDS[type], type));
  const fieldTypeField: KbNode = {
    ...singleField(SYSTEM_IDS.fieldTypeField, "fieldType", "ref"),
    children: fieldTypeOptions.map((option) => option.id),
  };
  // Cardinality is declared the way a type is: a ref to one of the field's own
  // children. It is one setting itself, so it declares itself single.
  const cardinalityOptions = [
    mk(SYSTEM_IDS.cardinalityOne, "one"),
    mk(SYSTEM_IDS.cardinalityMany, "many"),
  ];
  const cardinalityField: KbNode = {
    ...singleField(SYSTEM_IDS.cardinalityField, "cardinality", "ref"),
    children: cardinalityOptions.map((option) => option.id),
  };
  const targetTagField = typedField(SYSTEM_IDS.targetTagField, "targetTag", "ref");
  const targetQueryField = singleField(SYSTEM_IDS.targetQueryField, "targetQuery", "text");
  const relationInverseField = singleField(SYSTEM_IDS.relationInverseField, "inverse", "text");
  // Deliberately NOT self-typed. `sys.f.type` is the kind slot, and a ref to
  // `sys.tag` there declares "this node is a supertag" — resolveTags skips it
  // precisely so it never renders as a chip. Listing sys.tag among selectable
  // tags would dress a kind change up as tag application, which is a second
  // mechanism for one concept. Promotion is its own gesture instead.
  const tag = mk(SYSTEM_IDS.tag, "sys.tag", {
    [SYSTEM_IDS.fieldsField]: [
      { t: "ref", v: SYSTEM_IDS.colorField },
      { t: "ref", v: SYSTEM_IDS.hiddenField },
      { t: "ref", v: SYSTEM_IDS.viewDefaultField },
    ],
  });

  // Command type + palette command instances (W3)
  const command = mk(SYSTEM_IDS.command, "sys.command");
  const cmd = (id: string, text: string): KbNode => seededCommand(id, text, at);
  const commands: KbNode[] = [
    cmd(SYSTEM_IDS.cmdAddNode, "Add node"),
    cmd(SYSTEM_IDS.cmdAddTag, "Add tag"),
    cmd(SYSTEM_IDS.cmdDefineField, "Define field"),
    cmd(SYSTEM_IDS.cmdGoQuery, "Saved queries"),
    cmd(SYSTEM_IDS.cmdNewQuery, "New query node"),
    // W8a shell commands: device prefs popover + quick toggles
    cmd(SYSTEM_IDS.cmdSettings, "Settings"),
    cmd(SYSTEM_IDS.cmdExtensions, "Settings: Extensions"),
    cmd(SYSTEM_IDS.cmdToggleTheme, "Toggle theme"),
    cmd(SYSTEM_IDS.cmdSwitchDesignSystem, "Switch design system"),
    cmd(SYSTEM_IDS.cmdToggleWidth, "Toggle width"),
    cmd(SYSTEM_IDS.cmdDebugShowFields, "Debug: show all fields"),
    cmd(SYSTEM_IDS.cmdExpandAll, "Expand all"),
    cmd(SYSTEM_IDS.cmdCollapseAll, "Collapse all"),
    // W7.1 view mode + filter commands. The view-as commands name the
    // outline's and the collections' frame views, which are the families'.
    // GAP [[01M536CGS8JJ7XMG3F738WSNYK]]
    cmd(SYSTEM_IDS.cmdViewAsList, "View as: List"),
    cmd(SYSTEM_IDS.cmdViewAsTable, "View as: Table"),
    cmd(SYSTEM_IDS.cmdViewAsBoard, "View as: Board"),
    cmd(SYSTEM_IDS.cmdViewAsCards, "View as: Cards"),
    cmd(SYSTEM_IDS.cmdViewFilter, "Filter…"),
    // r5 ontology commands
    cmd(SYSTEM_IDS.cmdNewOntology, "New ontology"),
    cmd(SYSTEM_IDS.cmdEnterOntology, "Enter ontology…"),
    cmd(SYSTEM_IDS.cmdExitOntology, "Exit ontology"),
    // Panes and layouts
    cmd(SYSTEM_IDS.cmdSaveWorkspace, "Save workspace"),
    cmd(SYSTEM_IDS.cmdClosePane, "Close pane"),
  ];

  // Query nodes as pure system nodes (W4). A query node is any node carrying
  // `sys.f.query`; the field is the kind, so no `#query` supertag is seeded —
  // strip the field and the node is a plain node (DESIGN → Kinds, roles and
  // options).
  const queryField = singleField(SYSTEM_IDS.queryField, "query", "text", HIDE);
  const queryLimitField = singleField(SYSTEM_IDS.queryLimitField, "limit", "number", HIDE);

  // A frame view's settings (W7.0), held by its view node. The sort, display and group slots
  // name field nodes; colwidth is a JSON object held as one string.
  const viewSortField = typedField(SYSTEM_IDS.viewSortField, "view.sort", "ref", HIDE);
  const viewSortDirField = typedField(SYSTEM_IDS.viewSortDirField, "view.sort.dir", "text", HIDE);
  const viewDisplayField = typedField(SYSTEM_IDS.viewDisplayField, "view.display", "ref", HIDE);
  const viewColwidthField = singleField(
    SYSTEM_IDS.viewColwidthField,
    "view.colwidth",
    "text",
    HIDE,
  );
  const viewPagesizeField = singleField(
    SYSTEM_IDS.viewPagesizeField,
    "view.pagesize",
    "number",
    HIDE,
  );
  const viewGroupField = singleField(SYSTEM_IDS.viewGroupField, "view.group", "ref", HIDE);
  const viewFilterField = typedField(SYSTEM_IDS.viewFilterField, "view.filter", "text", HIDE);
  const nodeTextField = typedField(SYSTEM_IDS.nodeTextField, "node.text", "text");

  /*
   * View nodes (DESIGN → Kinds, roles and options → View nodes). The views
   * are an option set read by more than one field (`sys.f.view` takes any of
   * them, a renderer choice only the renderers), so they are children of a
   * list node, and each carries its family, which is what a query partitions
   * them by — the shape of the graph sources. The options themselves are not
   * core's to list: each is derived from a declared view's key when the seed
   * is folded ({@link foldSeed}), so the list node is seeded empty here.
   * The view type a node that names no view opens in (`sys.f.view.default`)
   * is not core's to name either: the fold writes it from the one
   * declaration that provides it ({@link SeedSource.defaultView}).
   */
  const viewFamilyOptions = Object.values(VIEW_FAMILY_VALUES).map((value) =>
    mk(value.id, value.label),
  );
  const viewFamilyField: KbNode = {
    ...singleField(SYSTEM_IDS.viewFamilyField, "view.family", "ref", HIDE),
    children: viewFamilyOptions.map((option) => option.id),
  };
  const viewsRoot = mk(SYSTEM_IDS.viewsRoot, "View types");

  const refField = (id: string, text: string, targetTag?: string, opts: FieldOptions = {}) =>
    typedField(id, text, "ref", {
      ...opts,
      props: {
        ...opts.props,
        ...(targetTag !== undefined && targetTag !== ""
          ? { [SYSTEM_IDS.targetTagField]: [{ t: "ref", v: targetTag }] }
          : {}),
      },
    });
  /*
   * A ref field whose allowed targets are the rows of one EDN query — the
   * general form of a target constraint (`sys.f.targetQuery`). Both callers
   * below used to write this object out inline.
   */
  const refQueryField = (id: string, text: string, edn: string, opts: FieldOptions = {}): KbNode =>
    typedField(id, text, "ref", {
      ...opts,
      props: { ...opts.props, [SYSTEM_IDS.targetQueryField]: [{ t: "str", v: edn }] },
    });

  // The view a node is (one option), and the view nodes a host names (many, in order).
  const viewField = refQueryField(SYSTEM_IDS.viewField, "view", VIEW_OPTION_TARGET_QUERY, {
    one: true,
    hidden: true,
  });
  const viewsField = refQueryField(SYSTEM_IDS.viewsField, "views", VIEW_NODE_TARGET_QUERY, HIDE);
  /*
   * The view type a node that names no view opens in (one option): the
   * store's, held by `sys.views`, and a tag's, held by the tag node, which
   * its nodes open in first (DESIGN → View nodes). A setting of every tag
   * (it configures the kind `sys.tag`), which templates it, so a person
   * chooses a tag's in the editor, a seeded tag's too.
   */
  // GAP [[01M69DX3D78HDQJ7W5E4HGC4PJ]] its options are every view type, not only those a node opens in
  const viewDefaultField = refQueryField(
    SYSTEM_IDS.viewDefaultField,
    "view.default",
    VIEW_OPTION_TARGET_QUERY,
    {
      one: true,
      props: { [SYSTEM_IDS.configuresField]: [{ t: "ref", v: SYSTEM_IDS.tag }] },
    },
  );
  // A docs view's params beside its subject (`lens.query`): which template, written where.
  const viewTemplateField = singleField(SYSTEM_IDS.viewTemplateField, "view.template", "text");
  const viewOutputField = singleField(SYSTEM_IDS.viewOutputField, "view.output", "text");
  const viewSavedQueryField = singleField(
    SYSTEM_IDS.viewSavedQueryField,
    "view.saved-query",
    "text",
  );

  // A view's subject (`lens.query`, `lens.focus`): every view's, so core's,
  // and written by the view that reads it (the graph's lens settings).
  const lensQueryField = singleField(SYSTEM_IDS.lensQueryField, "lens.query", "text", HIDE);
  const lensFocusField = singleField(SYSTEM_IDS.lensFocusField, "lens.focus", "ref", HIDE);

  // A layout view's arrangement (`layout.grid`): its pane tree as JSON text,
  // written by the layout view, never as a row.
  const layoutField = singleField(SYSTEM_IDS.layoutField, "layout", "text", HIDE);

  // Ontologies (r5 core): #ontology tag templating the sys.f.onto.* algebra.
  // No default ontology is seeded — an empty ontology list is a legitimate
  // empty state (unlike a graph page with zero perspectives).
  const ontoIncludeField = refField(
    SYSTEM_IDS.ontoIncludeField,
    "onto.include",
    SYSTEM_IDS.tag,
    HIDE,
  );
  const ontoMemberField = refField(SYSTEM_IDS.ontoMemberField, "onto.member", undefined, HIDE);
  const ontoExcludeField = refField(SYSTEM_IDS.ontoExcludeField, "onto.exclude", undefined, HIDE);
  // targetQuery (not targetTag) so the ref picker offers only #ontology nodes.
  const ontoExtendsField = refQueryField(
    SYSTEM_IDS.ontoExtendsField,
    "onto.extends",
    ONTOLOGY_TARGET_QUERY,
    HIDE,
  );
  const ontoQueryField = singleField(SYSTEM_IDS.ontoQueryField, "onto.query", "text", HIDE);
  const ontoClosureField = singleField(SYSTEM_IDS.ontoClosureField, "onto.closure", "text", HIDE);
  /*
   * Contextual references: one ref-typed field and nothing else. Same anatomy
   * as a query node — the field is the kind — so a contextual reference is an
   * ordinary node in every other respect: children, tags, collapse state,
   * backlinks and keyboard behaviour all come for free.
   *
   * No target constraint on purpose: a reference may point at any node, and a
   * declared `targetTag` would narrow the picker to a rule the feature does
   * not have. `sys.f.onto.member` is unconstrained for the same reason.
   */
  const refTargetField = refField(SYSTEM_IDS.refTargetField, "ref.target", undefined, {
    one: true,
    hidden: true,
  });

  /*
   * The Pinned list. Its children are contextual references to the pinned
   * nodes — a pin is an ordinary reference row, so order, drag-reorder,
   * backlinks and the ⌘K "Turn into reference…" gesture all come for free and
   * no `pinned` supertag has to exist to mark membership.
   *
   * No tag on the node either: it is a list, and being the node the sidebar
   * reads is the whole of what it is.
   */
  /*
   * The sidebar's pins. Core pins nothing: a family may file a pin of its
   * own here through the fold (`SeedSource.files`), as governance pins its
   * policies; every other pin is the person's own.
   */
  const pinnedRoot = mk(SYSTEM_IDS.pinnedRoot, "Pinned");

  /*
   * The Views list: where a view node the UI makes is filed — a saved graph,
   * a frame's view. Being a view node is its `sys.f.view`, never membership
   * here, so a view node filed anywhere else is as much one. User-editable
   * for the Pinned list's reason: every new view writes a child into it.
   */
  const viewsList = mk(SYSTEM_IDS.viewsList, "Views");

  const ontologyTag = seededTag(
    SYSTEM_IDS.ontologyTag,
    "ontology",
    [
      SYSTEM_IDS.ontoIncludeField,
      SYSTEM_IDS.ontoMemberField,
      SYSTEM_IDS.ontoExcludeField,
      SYSTEM_IDS.ontoExtendsField,
      SYSTEM_IDS.ontoQueryField,
      SYSTEM_IDS.ontoClosureField,
    ],
    at,
  );

  /*
   * Extensions (DESIGN.md → Extension families). Each one's node is derived
   * by the fold from its declaration and filed under this list, as a view's
   * option is under `sys.views`, so core seeds the list empty and the switch
   * an optional family's node holds; no extension is named here.
   */
  const extensionsRoot = mk(SYSTEM_IDS.extensionsRoot, "Extensions");
  // A system field that is an extension's setting names it: one of that list's
  // children, or the list itself for a setting every extension's node has.
  const configuresField = refQueryField(
    SYSTEM_IDS.configuresField,
    "configures",
    childrenTargetQuery(SYSTEM_IDS.extensionsRoot),
    { one: true },
  );
  // The switch: a setting of every extension's node.
  const enabled = singleField(SYSTEM_IDS.extensionEnabledField, "enabled", "checkbox");
  const extensionEnabledField: KbNode = {
    ...enabled,
    props: {
      ...enabled.props,
      [SYSTEM_IDS.configuresField]: [{ t: "ref", v: SYSTEM_IDS.extensionsRoot }],
    },
  };

  /*
   * The page head's backdrop (DESIGN-UI.md → Page-head backdrops): settings
   * of core's node, since the slot is core's. Each is an option set, so each
   * is its field's children. Which backdrops there are is not core's to
   * list: each option is derived from a declared backdrop when the seed is
   * folded ({@link foldSeed}), so the field is seeded with none.
   */
  const configuresCore: FieldOptions = {
    props: { [SYSTEM_IDS.configuresField]: [{ t: "ref", v: extensionNodeId("core") }] },
  };
  const backdropField = singleField(SYSTEM_IDS.backdropField, "backdrop", "ref", configuresCore);
  const strengthOptions = BACKDROP_STRENGTHS.map((value) =>
    mk(BACKDROP_STRENGTH_OPTION_IDS[value], value),
  );
  const backdropStrengthField: KbNode = {
    ...singleField(SYSTEM_IDS.backdropStrengthField, "backdrop.strength", "ref", configuresCore),
    children: strengthOptions.map((option) => option.id),
  };
  const directionOptions = BACKDROP_DIRECTIONS.map((value) =>
    mk(BACKDROP_DIRECTION_OPTION_IDS[value], value),
  );
  // The backdrop's art: a file of kb's own assets a backdrop draws in place of its own (`BackdropChoice.art`).
  const backdropArtField = singleField(
    SYSTEM_IDS.backdropArtField,
    "backdrop.art",
    "text",
    configuresCore,
  );
  // The variants a backdrop may show (`BackdropChoice.variants`): any of its field's children, the
  // declared backdrops' variants the fold derives, so it is seeded with none; none pinned, all.
  const backdropVariantField = typedField(
    SYSTEM_IDS.backdropVariantField,
    "backdrop.variant",
    "ref",
    configuresCore,
  );
  const backdropDirectionField: KbNode = {
    ...singleField(SYSTEM_IDS.backdropDirectionField, "backdrop.direction", "ref", configuresCore),
    children: directionOptions.map((option) => option.id),
  };
  /*
   * The design system the page is painted in (DESIGN-UI.md → Design tokens
   * → Design systems): a setting of core's node, since the page is core's.
   * Its options are derived from the declared systems, core's default
   * among them, when the seed is folded, so the field is seeded with none.
   */
  const designSystemField = singleField(
    SYSTEM_IDS.designSystemField,
    "designSystem",
    "ref",
    configuresCore,
  );
  /*
   * Motion options (DESIGN-UI.md → Motion options): settings of core's
   * node, each unset by default, so the shown theme's preset (the same
   * fields on its option node) or the default applies. The four option
   * settings are option sets, so each is its field's children; each effect
   * is a checkbox.
   */
  const motionSetting = <S extends MotionOptionSetting>(
    setting: S,
    values: readonly MotionSettings[S][],
  ): KbNode[] => {
    const options = values.map((value) => mk(motionOptionId(setting, value), value));
    const settingField: KbNode = {
      ...singleField(MOTION_FIELD_IDS[setting], `motion.${setting}`, "ref", configuresCore),
      children: options.map((option) => option.id),
    };
    return [settingField, ...options];
  };
  const motionFields = [
    ...motionSetting("mode", MOTION_MODES),
    ...motionSetting("intensity", MOTION_INTENSITIES),
    ...motionSetting("style", MOTION_STYLES),
    ...motionSetting("speed", MOTION_SPEEDS),
    ...MOTION_EFFECTS.map((effect) =>
      singleField(motionEffectFieldId(effect), `motion.${effect}`, "checkbox", configuresCore),
    ),
  ];

  return [
    field,
    tag,
    typeField,
    fieldsField,
    colorField,
    hiddenField,
    fieldTypeField,
    ...fieldTypeOptions,
    cardinalityField,
    ...cardinalityOptions,
    targetTagField,
    targetQueryField,
    relationInverseField,
    command,
    ...commands,
    queryField,
    queryLimitField,
    viewSortField,
    viewSortDirField,
    viewDisplayField,
    viewColwidthField,
    viewPagesizeField,
    viewGroupField,
    viewFilterField,
    nodeTextField,
    viewField,
    viewsField,
    viewDefaultField,
    viewTemplateField,
    viewOutputField,
    viewSavedQueryField,
    viewFamilyField,
    ...viewFamilyOptions,
    viewsRoot,
    lensQueryField,
    lensFocusField,
    layoutField,
    ontoIncludeField,
    ontoMemberField,
    ontoExcludeField,
    ontoExtendsField,
    ontoQueryField,
    ontoClosureField,
    ontologyTag,
    refTargetField,
    pinnedRoot,
    viewsList,
    extensionsRoot,
    extensionEnabledField,
    configuresField,
    backdropField,
    backdropStrengthField,
    ...strengthOptions,
    backdropDirectionField,
    ...directionOptions,
    backdropArtField,
    backdropVariantField,
    designSystemField,
    ...motionFields,
  ];
}

/**
 * Merge `seed` (the fold of the bundled declarations, {@link foldSeed}) into
 * existing nodes without overwriting user edits to sys.* text/props.
 *
 * First it applies the fold's retirement table ({@link retireSeeded}), so a
 * seeded id renamed since, such as the graph's default perspective
 * `sys.lens.all-mentions` → `lens.all-mentions`, is renamed in place (an
 * edit on the old id kept) or dropped for the replacement already there,
 * and every prop, value and child naming it follows.
 */
export function ensureSystemSeed(
  nodes: KbNode[],
  fold: Pick<FoldedSeed, "nodes" | "retired">,
): {
  nodes: KbNode[];
  seeded: boolean;
  /** Ids removed by migration (must be passed to store.commit deletes). */
  deletes: string[];
} {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const seed = fold.nodes;
  const seededText = new Map(seed.map((node) => [node.id, node.text]));

  // Retire BEFORE seeding defaults, so an edit on an old id is kept, and an
  // unedited label the seed has since changed takes the new one.
  const { deletes, changed: retired } = retireSeeded(byId, fold.retired, (id) =>
    seededText.get(id),
  );
  let seeded = retired;

  const seedById = new Map<string, KbNode>();
  const seedTemplateTags = new Map<string, KbNode>();
  for (const node of seed) {
    seedById.set(node.id, node);
    if (TEMPLATE_TAGS.includes(node.id)) seedTemplateTags.set(node.id, node);
    if (!byId.has(node.id)) {
      byId.set(node.id, node);
      seeded = true;
    }
  }

  // Merge missing template field refs onto existing template tags
  // (ensureSystemSeed otherwise never rewrites existing sys.* props).
  for (const tagId of TEMPLATE_TAGS) {
    const seedTag = seedTemplateTags.get(tagId);
    const existingTag = byId.get(tagId);
    if (!seedTag || !existingTag) continue;
    const want = seedTag.props[SYSTEM_IDS.fieldsField] ?? [];
    const have = existingTag.props[SYSTEM_IDS.fieldsField] ?? [];
    const haveIds = new Set(have.filter((v) => v.t === "ref").map((v) => v.v));
    const missing = want.filter((v) => v.t === "ref" && !haveIds.has(v.v));
    if (missing.length === 0) continue;
    byId.set(tagId, {
      ...existingTag,
      props: {
        ...existingTag.props,
        [SYSTEM_IDS.fieldsField]: [...have, ...missing],
      },
    });
    seeded = true;
  }

  /*
   * Fill seed prop keys an existing sys.* node has never carried.
   *
   * A key the store already has is a value the owner may have chosen, so it is
   * never rewritten. A key that is absent entirely is not a conflict — it is a
   * prop added to the seed after that store was created, and leaving it absent
   * is what made new system behaviour invisible on older stores. This replaces
   * the one-off "cluster-by=parent when absent" special case, which the seed
   * already declares on lens.all-mentions and which this pass therefore covers
   * exactly; adding the next such default now means editing the seed, not
   * adding another block here.
   *
   * GAP [[01M3A0ZEWWG0VEHXEM3YNKRQ0Y]] — "absent" cannot tell a key the store
   * never had from one its owner unset, so an unset seeded key comes back on
   * the next open.
   */
  for (const declared of seedById.values()) {
    const existing = byId.get(declared.id);
    if (existing === undefined || existing === declared) continue;
    const absent = Object.entries(declared.props).filter(([field]) => !(field in existing.props));
    if (absent.length === 0) continue;
    byId.set(declared.id, {
      ...existing,
      props: { ...existing.props, ...Object.fromEntries(absent) },
    });
    seeded = true;
  }

  if (adoptSeedChildren(byId, seedById)) seeded = true;

  return { nodes: [...byId.values()], seeded, deletes };
}

/**
 * Adopt seed-declared children that nothing currently parents.
 *
 * The seed declares structure as well as props — a field's option set is its
 * children (DESIGN → Kinds, roles and options) — and a store created before
 * that declaration has the option nodes sitting at the forest root. Leaving
 * them there would make the declaration a dead seam: the resolver would derive
 * "the children of this field" and find none.
 *
 * Only orphans are adopted, and that is the whole rule. A node the owner has
 * already filed somewhere is their arrangement; re-parenting it here would both
 * overwrite that and hand the node two parents, which `txIntegrityError` rejects
 * outright. Same posture as the fill-absent props pass: an absent declaration is
 * a seed addition, a present one is a choice.
 */
function adoptSeedChildren(
  byId: Map<NodeId, KbNode>,
  seedById: ReadonlyMap<NodeId, KbNode>,
): boolean {
  const parented = new Set<NodeId>();
  for (const node of byId.values()) {
    for (const childId of node.children) parented.add(childId);
  }
  let adopted = false;
  for (const seed of seedById.values()) {
    const existing = byId.get(seed.id);
    if (existing === undefined || existing === seed) continue;
    const adopt = seed.children.filter((id) => byId.has(id) && !parented.has(id));
    if (adopt.length === 0) continue;
    for (const childId of adopt) parented.add(childId);
    byId.set(seed.id, { ...existing, children: [...existing.children, ...adopt] });
    adopted = true;
  }
  return adopted;
}
