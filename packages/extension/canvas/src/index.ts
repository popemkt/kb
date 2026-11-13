/**
 * The canvas family's shared package (DESIGN.md → Extension families): the
 * JSON Canvas document and the geometry and verbs over it, the family's ids,
 * view keys and seed, and the declaration and shared plugin both hosts load.
 */
export {
  CANVAS_HEADS,
  CANVAS_SIDES,
  CANVAS_ROUTES,
  EMPTY_CANVAS_DOC,
  canvasDepth,
  canvasElevation,
  canvasRotation,
  canvasTop,
  isFileNode,
  isGroupNode,
  isKbNode,
  isNativeEdgeBound,
  isPathNode,
  isPictureFile,
  isShapeNode,
  isTextNode,
  parseCanvasDoc,
  removeCanvasEdge,
  stringifyCanvasDoc,
  upsertCanvasEdge,
  upsertCanvasNode,
  withFlag,
  withDepth,
  withElevation,
  withParent,
  withRotation,
} from "./doc.ts";
export {
  ancestorsOf,
  canvasMembership,
  carriedBy,
  deleteItems,
  carriedPart,
  freeItems,
  editItem,
  groupItems,
  isWithin,
  paintOrder,
  pasteItems,
  placeItems,
  settleMembership,
  transformCarried,
  ungroupItems,
  viewpointFrames,
  withMembers,
} from "./membership.ts";
export type { CanvasCarried, CanvasMembership } from "./membership.ts";
export {
  IDENTITY,
  NO_ROTATION,
  apply,
  axisAngleOf,
  isUnrotated,
  multiply,
  normalizeDegrees,
  rotationMatrix,
  rotationOfMatrix,
  transpose,
  turnAbout,
} from "./rotation.ts";
export type { CanvasMatrix } from "./rotation.ts";
export {
  isStill,
  motionBetween,
  motionOf,
  moveBy,
  selectionPivot,
  stillAbout,
  transformItem,
  transformItems,
  withBox,
} from "./transform.ts";
export type { CanvasTransform } from "./transform.ts";
export {
  TOP_AXES,
  boxBounds,
  boxCorners,
  boxFrame,
  boxRotation,
  boxToLocal,
  boxToWorld,
  boxTop,
  directionToLocal,
  directionToWorld,
  facesCamera,
  facingFrame,
  facingLift,
  frameCorners,
  frontFrame,
  frontReach,
  itemFrame,
  planeCorners,
} from "./box.ts";
export type { CanvasAxes, CanvasFrame, CanvasVec } from "./box.ts";
export {
  CANVAS_CAMERA_FIELDS,
  LEGACY_CAMERA_KEY,
  cameraLookingFrom,
  canvasCameraProps,
  parseLegacyCamera,
  posesAgree,
  projectionOf,
  readCanvasCamera,
} from "./camera.ts";
export {
  CANVAS_ALIGN_EDGES,
  CANVAS_LAYOUTS,
  CANVAS_ORDERS,
  arrangeItems,
  flipItems,
  orderItems,
} from "./arrange.ts";
export type { CanvasLayerValue } from "./arrange.ts";
export { connectItems } from "./connect.ts";
export {
  CARD_BODY_FALLBACK,
  CARD_BODY_STEP,
  CORNER_RADII_FALLBACKS,
  cornerRadius,
  FLEX_PLACES,
  FONT_FACES,
  SELECTED_OUTLINE,
  TEXT_ALIGNS,
  TONE_TOKENS,
  TYPE_STEPS,
  TYPE_STEP_FALLBACKS,
  edgePaint,
  edgeReach,
  itemPaint,
} from "./paint.ts";
export type {
  CanvasTypeStep,
  CornerRadii,
  ChromePaint,
  EdgePaint,
  EdgeState,
  ItemPaint,
  Tone,
  ToneSource,
  WordsPaint,
} from "./paint.ts";
export { paintCss, paletteToken, toneCss } from "./paint-css.ts";
export { canvasSvg } from "./svg.ts";
export { DIAGRAM_FLOWS, DIAGRAM_LIMITS, diagramDoc } from "./diagram.ts";
export type { DiagramFlow, DiagramLink, DiagramSpec } from "./diagram.ts";
export { MERMAID_TEXT_LIMIT, mermaidDiagram } from "./mermaid.ts";

export {
  freehandItem,
  lineThrough,
  isOpenLine,
  itemMarks,
  itemOutline,
  pathHeads,
  smoothThrough,
  withLine,
} from "./paths.ts";

export { controlLead, isLinkNode, isLinkUrl, itemLead, linkCard, withLink } from "./links.ts";
export { inClip, itemClips } from "./clip.ts";
export type { CanvasClip } from "./clip.ts";
export type { CanvasItemLink, CanvasLinkNode } from "./links.ts";
export {
  anchorNear,
  edgeHead,
  edgeRoute,
  headOf,
  looseRoute,
  routeBends,
  routeMidpoint,
  routePoints,
  sideTerminal,
  withEnd,
  withHead,
  withRoute,
} from "./edges.ts";
export type { EdgeEnd, EdgeHead, EdgeRoute } from "./edges.ts";

export { describeCanvas, itemKind, itemWords } from "./describe.ts";

export { CANVAS_LINT_RULES, lintCanvas, lintDiff } from "./lint.ts";
export { canvasReferences } from "./references.ts";
export { boardOf, boardPages, canvasPages, nextPageName } from "./pages.ts";

export {
  commentWrite,
  isCommentNode,
  pinLost,
  pinnedItems,
  type CanvasThread,
  type CommentAnchor,
  type CommentPlace,
} from "./comments.ts";
export { canvasWorld, isCanvasNode } from "./world.ts";
export type { CanvasWorld } from "./world.ts";
export type { CanvasLint, CanvasLintDiff } from "./lint.ts";
export { placeItem } from "./place.ts";
export type { CanvasWhere } from "./place.ts";
export { promotableText, promoteItem } from "./promote.ts";
export {
  CANVAS_DIRECTIONS,
  CanvasRelationError,
  directionFrom,
  facingSides,
  itemBounds,
  overlaps,
} from "./relations.ts";

export { coversFromAbove, rayIntoItem } from "./pick.ts";
export type { CanvasPickItem } from "./pick.ts";
export {
  GRID_STEP,
  restingOn,
  snapCanvasMove,
  snapCarry,
  snapPrecise,
  snapToSurface,
} from "./snap.ts";
export type { SnapGuide, SnappedTransform } from "./snap.ts";
export {
  CANVAS_PALETTE,
  canvasColor,
  isCanvasColor,
  drawsGround,
  ownsWords,
  paintName,
  styleOf,
  withStyle,
  writtenLooks,
} from "./style.ts";
export type { CanvasPaint, CanvasPaletteId } from "./style.ts";
export {
  CANVAS_ALIGNS,
  CANVAS_DASHES,
  CANVAS_FILLS,
  CANVAS_FONTS,
  CANVAS_SIZES,
  CANVAS_VALIGNS,
} from "./style-fields.ts";
export type { CanvasAlign, CanvasFont, CanvasVAlign } from "./style-fields.ts";
export { CANVAS_IDS } from "./ids.ts";
export { CANVAS_EVENTS, CanvasListView, CanvasParams, CanvasView, canvasViewIdOf } from "./view.ts";
export { canvasExtension, canvasPlugin } from "./extension.ts";
export {
  CANVAS_PRESET_KINDS,
  CANVAS_SHAPE_PRESETS,
  CANVAS_SOLID_PRESETS,
  imageItem,
  makeItem,
  placedOnFace,
  presetItem,
  presetType,
} from "./presets.ts";
export {
  CANVAS_FOOTPRINT_KINDS,
  CANVAS_FOOTPRINTS,
  CANVAS_SHAPES,
  faceShare,
  topFace,
  faceStands,
  itemShape,
  onFootprint,
  outlinePoints,
  shapeOutline,
  svgPathData,
  topView,
  tracePath,
} from "./shapes.ts";
export type { CanvasFootprint, CanvasPathCommand, CanvasVolume } from "./shapes.ts";
export type { CanvasPresetKind } from "./presets.ts";
export type { CanvasCamera, CanvasPose, CanvasProjectionKind } from "./camera.ts";
export type {
  CanvasDoc,
  CanvasEdge,
  CanvasHead,
  CanvasItemFlag,
  CanvasFileNode,
  CanvasGroupNode,
  CanvasKbNode,
  CanvasNode,
  CanvasPathNode,
  CanvasShapeKind,
  CanvasShapeNode,
  CanvasSide,
  CanvasTextNode,
  KbLinkMode,
} from "./doc.ts";
export { CANVAS_OPEN, CANVAS_SELECTION } from "./context.ts";
export { editCanvas, landItems, nudgeItems, patchItem, requireItems, takeItems } from "./edit.ts";
export type { CanvasEdit } from "./edit.ts";
export { MAX_FLOW_ROUNDS, flowPlan, runFlow } from "./flow.ts";
export type { FlowResult, FlowStep } from "./flow.ts";
export { tldrawBoard, tldrawKeys, tldrawText } from "./tldraw.ts";
export type { TldrawValue } from "./tldraw.ts";

export {
  STROKE_TOOLS,
  HOLDING_TOOLS,
  TOOL_FAMILIES,
  type CanvasTool,
  type CanvasToolPick,
  type CanvasToolFamily,
  type CanvasStrokeTool,
} from "./tool-model.ts";
export type {
  CanvasAxis,
  TransformConstraint,
  TransformMode,
  TransformKey,
} from "./transform-input-model.ts";
export { MIN_ZOOM, MAX_ZOOM, ZOOM_STEP, MAX_PITCH, CANVAS_VIEW_PRESETS } from "./camera-stops.ts";
export {
  CANVAS_CONTEXT_IDS,
  CANVAS_SHORTCUTS,
  CANVAS_VIEW_COMMANDS,
  type CanvasKeyEvent,
  type CanvasIntent,
  type PresentAct,
  type TransformAct,
  type CanvasKeyContextName,
  type CanvasShortcutSection,
  type CanvasShortcut,
  type CanvasMenuName,
  type CanvasViewCommand,
} from "./keybindings.ts";

export { CANVAS_RUN_FIELDS, planCanvasRunFields, type CanvasRunFields } from "./run-fields.ts";
