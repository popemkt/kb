/**
 * `@kb/ui-sdk`: the host API a browser plugin builds against (DESIGN-UI.md →
 * Extension UI halves). A family's UI half imports this package and nothing
 * else of the shell. The shell builds on it too, so each piece below has one
 * home.
 *
 * It holds the UI points and the command point, the primitives, the page's
 * pure helpers, and the graph's shapes as the page holds them. The shell's
 * state (stores, writes, the invoke path) is reached only through
 * `BrowserHost`, which the shell provides; this package never imports a
 * store, and the hooks below are built over the host once.
 */

// The host, and the hooks built over it. A sandbox frame's run and handle are
// what the host's sandbox bridge takes and gives.
export {
  useAppearance,
  useDebugFieldIds,
  useDebugFields,
  useViewSettingsFrame,
  useFollow,
  useFrameView,
  useFrameViewNode,
  useFrameViews,
  useGeneration,
  useGraphRead,
  useAnswered,
  useAnswers,
  useReplicaQueries,
  useIsActive,
  useIsSelected,
  useNode,
  useNodePaletteOpen,
  useNodes,
  useNodeTextBinding,
  useOpenNode,
  usePageActivity,
  usePageGraph,
  usePaneScreen,
  usePrefs,
  useQueryRows,
  useRefInk,
  useSchema,
  useWireNodes,
} from "./hooks";

export {
  browserHost,
  type BrowserHost,
  BrowserHostService,
  type ProposedView,
  type ViewProposal,
} from "./host";
export type { HostedFrame, SandboxEvents, SandboxPorts, SandboxRun } from "./sandbox";
// Running sandboxed code the one way: its trust, its ports and the calls
// waiting on a person, its frame, and the card a person answers them on.
export { useSandboxPorts, useSandboxTrust, type SandboxTrust } from "./sandbox-run";
export { SandboxFrame } from "./components/sandbox-frame";
export { ActionReviewDialog } from "./components/action-review-dialog";
export { ActionApproval } from "./components/action-approval";
export { ActionReviewPoint, type ApprovalView } from "./lib/action-review";
export { SandboxApprovalCard } from "./components/sandbox-approval-card";
// A view's scripts: its event channel, and the host the family that keeps
// scripts provides.
export {
  ScriptHostService,
  createViewLayout,
  createViewEvents,
  type ScriptHostProps,
  type ViewLayout,
  type ScreenRegion,
} from "./view-scripts";
export { ViewScripts } from "./components/view-scripts";

// The UI points: routes, views, sidebar sections, docks, node commands and
// palette steps, and the slot one view embeds another through.
export {
  type Command,
  type CommandContext,
  CommandPoint,
  type CommandTarget,
  nodeAction,
  type NodeCommand,
  type NodeCommandListing,
  NODE_MENU_GROUPS,
  nodeMenu,
  type OutlineCommandApi,
  type PaletteStep,
  PaletteStepPoint,
  paletteStepsPlugin,
  type PaletteSurface,
} from "./lib/command-point";
export { callInput, invokeAction, PICKED } from "./lib/action-call";
export { provideCommand, providePaletteStep } from "./lib/command-forms";

export {
  currentContributions,
  currentView,
  currentService,
  pointReader,
  providedFrameViews,
  pageFootprint,
  PAGE_FAMILY_KERNEL,
  subscribeUiKernel,
  syncUiPlugins,
  uiKernelReader,
  useContributions,
  configureUiRoles,
  replacementApproved,
  BACKDROP_BUDGETS,
  type BackdropBudget,
} from "./lib/plugins.ts";
export {
  familyViews,
  findView,
  type Placement,
  type ProvidedView,
  provideView,
  ViewPoint,
  type Drawn,
  type RowSubject,
  type ViewProps,
} from "./lib/view-point.ts";
export {
  type MatchedRoute,
  matchRoute,
  pageFrameOf,
  paramsOf,
  provideRoute,
  type ResolvedRoute,
  RoutePoint,
  useRoute,
} from "./lib/route-point.ts";
export { type Dock, DockPoint, OverlayPoint, SidebarSectionPoint } from "./lib/shell-points.ts";
export { type PageActivity, type PageEvents, QUIET_ACTIVITY } from "./lib/page-activity.ts";
export { chosenDeclared, provideDeclared } from "./lib/declared.ts";

export {
  type FamilyView,
  MAX_VIEW_DEPTH,
  type SlotChain,
  slotLink,
  slotRenders,
} from "./lib/view-key";
export { useSlotChain } from "./components/slot-chain";
export { ViewSlot } from "./components/view-slot";

export { HoldStill } from "./components/hold-still";
export { deferred } from "./components/deferred";

// The primitives.
export { Bullet } from "./components/bullet";
export { EdnEditor } from "./components/edn-editor";
export { type EnumOption, EnumSelect } from "./components/enum-select";
export { FieldRow } from "./components/field-row";
export { ManagedNote } from "./components/managed-field";
export { useFieldWrite } from "./lib/field-write";
export { Button } from "./components/button";
export { IconButton } from "./components/icon-button";
export { KnobControl } from "./components/deferred-parts";
export { MENU_ROW, MENU_SURFACE, useMenuKeys } from "./components/menu";
export { MenuSeparator } from "./components/menu-separator";
export { InlineMarkdown, MdView } from "./components/md-view";
export { NodeLinkRow } from "./components/node-link-row";
export { NodeSectionPoint, useNodeSections, type NodeSectionProps } from "./lib/node-sections";
export { NodeRow } from "./components/node-row";
export { menuAnchor, menuAnchorOf } from "./lib/menu-anchor";
export {
  type CaretIntent,
  NodeTextHost,
  type NodeTextHostBinding,
  type NodeTextHostProps,
} from "./components/node-text-host";
export { type NodeTextPort } from "./components/node-text-port";
export { NoFrame } from "./components/no-frame";
export { NotFound } from "./components/not-found";
export { PickerList } from "./components/picker-list";
export { PrefFieldRow } from "./components/pref-field-row";
export { POPOVER_VALUE_CLASS, PopoverShell } from "./components/popover-shell";
export { OntologyPicker } from "./components/ontology-picker";
export { type SidebarNavItem, SidebarRow, SidebarSection } from "./components/sidebar-row";
export { OptionChip, TagChip, TagChipGroup } from "./components/tag-chip";
export { ViewOptionsGlyph } from "./components/view-options-glyph";
export { useAnchoredPosition } from "./components/use-anchored-position";
export { useDismiss } from "./components/use-dismiss";
export { useRevealMarkup } from "./components/use-reveal-markup";
export { ViewErrorBoundary } from "./components/view-error-boundary";
export { WorkspaceBoundary } from "./components/workspace-boundary";
export { WorkspaceState } from "./components/workspace-state";
export { ViewNotLoaded, ViewUnavailable } from "./components/view-unavailable";

// The graph as the page holds it: nodes, values, the schema and its field
// types, references, instances, perspectives, and the replica's one query seam.
export {
  contextualTargetOf,
  isContextualRef,
  rowText,
  rowTextOf,
  rowTextReadOnlyReason,
  shownNode,
  shownNodeId,
  showsAncestor,
} from "./lib/contextual-ref";
export { failureText, personRefusal, refusalNames } from "./lib/refusal";
export {
  clearAllowedRefIdsCache,
  emptyValueForType,
  FIELD_TYPE_OPTION_IDS,
  FIELD_TYPES,
  type FieldType,
  fieldTypeValue,
  isValueMismatch,
  resolveAllowedRefIds,
  resolveAllowedRefIdsCached,
  resolveFieldTypeById,
} from "./lib/field-type";
export { isFieldHidden, resolveVisibleProps } from "./lib/field-visibility";
export {
  type CompletionReply,
  type CompletionRequest,
  type ModelCompletion,
  ModelCompletionService,
} from "./lib/model-completion";
export { type Board, type BoardCard, type BoardReply, BoardService } from "./lib/board";
export {
  type NodeLinkGraph,
  type NodeLinkGraphs,
  NodeLinkGraphService,
  type NodeLinkNode,
} from "./lib/node-link";
export {
  forestRootIds,
  formatPropValue,
  loadExpansion,
  loadIdSet,
  resolveProps,
  saveExpansionChanges,
  type ExpansionChanges,
  saveIdSet,
  type Expansion,
  wireToOutlineMap,
  withExpansion,
} from "./lib/graph-view";
export {
  canvasInstanceKey,
  childInstanceKey,
  hostOfInstance,
  isProjectedInstance,
  isQueryResultInstance,
  MAIN_OUTLINE_HOST,
  outlineHostOfPane,
  outlineInstanceKey,
  pageTitleInstanceKey,
  queryResultInstanceKey,
} from "./lib/instance-key";
export { isPinned, listPinnedNavItems, pinnedRefIds, pinnedRefIdsFor } from "./lib/pinned";
export {
  closesCycleOf,
  nodeCandidates,
  type RefCreation,
  refCreationOf,
  refSearchOf,
  refUses,
} from "./lib/refs";
export {
  fieldCarriersQuery,
  queryFieldCarriers,
  queryTaggedInstances,
  type SchemaHit,
  kindOfType,
  schemaZoomKind,
  taggedInstancesQuery,
} from "./lib/schema-zoom";
export {
  frameConfigOf,
  frameReport,
  type FrameView,
  frameViewLabelOf,
  frameViewOf,
  getViewConfig,
} from "./lib/frame-view";
export {
  applyViewFilters,
  EMPTY_GROUP_KEY,
  flattenBoardOrder,
  groupChildrenForBoard,
  resolveTableColumns,
  sortChildrenForTable,
  type TableColumnSpec,
} from "./lib/frame-layout";
export { frameRows, type FrameRowsInput } from "./lib/frame-rows";
export { UNDO_DEPTH } from "./lib/undo-depth";
export {
  type PageCaptureTarget,
  CaptureTargetService,
  captureTarget,
  pageCapturePlanner,
  topLevelCapture,
} from "./lib/capture-target";
export { type Landing, LandingService, land, landOnce, stayHome } from "./lib/landing";
export { type DateTarget, DateTargetService, dateTarget, leadsNowhere } from "./lib/date-target";
export {
  type FieldEditorProps,
  type FieldRowProps,
  FieldEditorService,
  provideFieldEditor,
  useFieldEditor,
} from "./lib/field-editor";
export {
  type FrameRowTextProps,
  type FrameSubject,
  FrameSubjectContext,
  useFrameSubject,
} from "./lib/frame-subject";
export { isReferenceRow, resolveRowChrome } from "./lib/row-chrome";
export { type GraphRead, type GraphSource } from "./lib/graph-read";
export {
  type GraphChange,
  inScope,
  listOntologyItems,
  type PageGraphState,
  type ScopeSource,
  scopedWireOf,
  shownNodesOf,
} from "./lib/page-graph";
export {
  EMPTY_EDITOR,
  EMPTY_PROJECTION,
  editorTextPort,
  type PageEditor,
  PageEditorService,
  type PageProjection,
  PageProjectionService,
} from "./lib/page-ports";
export type { PageWrites } from "./lib/page-writes";
export {
  type FieldContext,
  fieldContextOf,
  type FieldContextSource,
  type SchemaIndex,
  schemaOf,
  schemaOfGraph,
} from "./lib/schema";
export {
  DEBUG_FIELDS_STORAGE_KEY,
  EXPANDED_STORAGE_KEY,
  EXPANSION_STORAGE_KEY,
  isSysPrefixed,
  type NodeMap,
  type OutlineNode,
  type PropValue,
  SYSTEM_IDS,
  type TagBadge,
  WORKSPACE_ROOT_ID,
} from "./lib/types";
export { resultNodeIds } from "./lib/use-query-node-rows";
export {
  answerOf,
  derivedWith,
  type EdnRunner,
  type EnginePort,
  type FromEngine,
  type KbIndex,
  type NodeIndex,
  queryBacklinks,
  queryFamilyViewNodes,
  queryNeighbourhood,
  queryRecords,
  type QueryRecords,
  RemoteIndex,
  type Timers,
} from "./query";
export {
  answerMessage,
  type AnswerClock,
  type QueryAnswer,
  type QueryAnswers,
  ReplicaQueries,
} from "./lib/replica-queries";
export { useAnswersOf, useLastSettled } from "./lib/use-replica-queries";

// Pure helpers: bullets, the caret, class names, colours, the DOM, keys,
// labels, logging, markdown, motion, panes, pickers, pointers, routing,
// text, themes, timing and toasts.
export {
  BULLET_GEOMETRY,
  BULLET_GLYPH,
  BULLET_GLYPHS,
  BULLET_HALO_RADIUS,
  BULLET_INK,
  BULLET_QUERY_ICON,
  BULLET_SYS_OPACITY,
  bulletAppearance,
  type BulletAppearance,
  type BulletAppearanceInput,
  type BulletPaint,
  bulletRingDash,
  type BulletShape,
  outlineBulletAppearance,
  queryHandleStart,
  queryIconPath,
} from "./lib/bullet-mode";
export {
  offsetFromPoint,
  readCaretGeometry,
  verticalArrowDecision,
  type VerticalNavDecision,
} from "./lib/caret";
export { cn, ELEVATIONS, TYPE_STEPS } from "./lib/cn";
export { oklchToRgb, readTokenColor, toRenderableColor, provideColorTokens } from "./lib/css-color";
export {
  asElement,
  asInstance,
  isTextEntry,
  isTyping,
  isTextNode,
  SIDEBAR_REGION_SELECTOR,
  sidebarRegionProps,
} from "./lib/dom";
export {
  bulletClickIntent,
  type Follow,
  type FollowFrom,
  type FollowHow,
  type FollowTarget,
  nodeTarget,
  OpenNodeContext,
  routePointerClick,
  useFollowThrough,
} from "./lib/follow";
export {
  graphDisplayText,
  type GraphLabelFace,
  graphLabelFont,
  wrapGraphLabel,
} from "./lib/graph-label";
export { guideLineStyle, indentStyle } from "./lib/indent";
export { keptLoad } from "./lib/kept-load";
export {
  type Chord,
  chordsOverlap,
  isPrintableKey,
  type KeyChordEvent,
  keyChordEvent,
  lookupChord,
  matchesChord,
  PALETTE_CHORD,
  printableExcept,
  TEXT_HISTORY_CHORD,
} from "./lib/keychord";
export {
  admitKeybindings,
  admitKeymaps,
  currentKeymap,
  type KeyContext,
  keyContextOf,
  KeyContextPoint,
  type KeyCall,
  keyCallOf,
  type Keybinding,
  KeybindingPoint,
  type Keymap,
  provideKeybinding,
  runKeyCall,
  tellKeymaps,
} from "./lib/keybindings";
export {
  ATTACH_FILE,
  ingestPort,
  provideIngest,
  type Ingested,
  type IngestHandler,
  type IngestPort,
} from "./lib/ingest";
export { logError, logWarn } from "./lib/log";
export {
  getCaretSerializedOffset,
  INLINE_TEXT_CLASSES,
  KB_REF_ID_ATTR,
  readInlineInput,
  type RefInk,
  renderInlineMarkdown,
  revealMarkupAtSelection,
  serializeEditable,
  setCaretSerializedOffset,
} from "./lib/md-edit";
export { assetSrcUrl, KB_TEXT_CLASS } from "./lib/md-inline";
export { HeldStill, prefersReducedMotion, useReducedMotion } from "./lib/motion";
export { MAIN_PANE, PaneContext, usePane } from "./lib/pane";
export {
  type PaneReport,
  type PaneScreenPort,
  type PaneCarryOut,
  type PaneCommand,
  type PaneSelection,
} from "./lib/pane-screen";
export {
  CREATE_ROW_ID,
  labelRuns,
  matchCandidate,
  orderCandidates,
  type PickerCandidate,
  type PickerRow,
  pickerRows,
} from "./lib/picker";
export {
  LONG_PRESS_MS,
  pastSlop,
  pointerKind,
  POINTER_SLOPS,
  type PointerKind,
} from "./lib/pointer-slop";

export {
  getPath,
  navigate,
  nodePath,
  ontologyPath,
  outlineLocationOf,
  type OutlineLocation,
  outlinePath,
  replacePath,
  subscribePath,
} from "./lib/router";
export {
  type ReloadState,
  browserBuildEnv,
  followServerProtocol,
  reloadNow,
  watchForNewBuild,
} from "./lib/stale-build";
export {
  djb2Hash,
  hashTagColor,
  nodeTagColors,
  optionColorOf,
  refInkOf,
  TAG_PALETTE,
  tagChipColors,
  tagColorAlpha,
  tagColorOf,
  tagPalette,
  type TagPalette,
  UNTAGGED_COLOR,
} from "./lib/tag-color";
export { hasText, textOr } from "./lib/text";
export {
  type Appearance,
  appearanceOf,
  type Prefs,
  type ThemePref,
  THEMES,
  type WidthPref,
  WIDTHS,
} from "./lib/theme";

export { OptionPreviewPoint, useOptionPreview, type PreviewSize } from "./lib/option-preview";
export {
  provideValueKind,
  ValueKindPoint,
  type EditHandle,
  type EditorMode,
  type FieldHandle,
  type FieldTypeKind,
  type RejectedInput,
  type ValueKindSpec,
  type ValueSurfaceProps,
  type ValueView,
} from "./lib/value-kind";
export {
  approach,
  approachRate,
  approachShare,
  clampStep,
  type CubicBezier,
  easeAt,
  readTiming,
  type Spring,
  springRate,
  springResponse,
  stepSpring,
  type Timing,
  TIMING_FALLBACK,
} from "./lib/timing";
export { setToastSink, toast } from "./lib/toast";
export { usePickerKeys } from "./lib/use-picker";
export { useNarrowViewport } from "./lib/viewport";
export { BREAKOUT_CLASS, useBreakoutShift } from "./lib/breakout";
export { useLoadSeed } from "./lib/load-seed";
export { tagOpeningOf, tagRowViewOf, type TagOpening } from "./lib/tag-opening";

export { usePath } from "./lib/router.ts";
export { componentSchema } from "./lib/component-schema.ts";
