/**
 * The gallery's workflows as views of the composer's family: each key with
 * its surface, loaded in its own chunk, and its place among the tabs. A
 * workflow of another family is provided the same way from that family's
 * UI half (`provideView` of a `workflowKey`), and the composer lists it.
 */
import {
  ArticulateWorkflow,
  BrowseWorkflow,
  CaptureWorkflow,
  KnowWorkflow,
  NodeWorkflow,
  ReferenceWorkflow,
  RemixWorkflow,
  SceneWorkflow,
  type WorkflowKey,
  type WorkflowParams,
} from "@kb/gallery";
import { createElement, lazy, type ComponentType, type FunctionComponent } from "react";

/** What a workflow's surface is drawn with: what it starts from. */
type WorkflowSurface = FunctionComponent<{ readonly params: WorkflowParams }>;

/**
 * A workflow's surface, loaded with its own chunk the first time it is
 * shown; the slot it is drawn in holds its place while it loads.
 */
function lazyWorkflow(
  load: () => Promise<ComponentType<{ readonly params: WorkflowParams }>>,
): WorkflowSurface {
  const Loaded = lazy(async () => ({ default: await load() }));
  return ({ params }) => createElement(Loaded, { params });
}

export const GALLERY_WORKFLOW_SURFACES: ReadonlyArray<{
  readonly key: WorkflowKey;
  readonly Component: WorkflowSurface;
}> = [
  { key: KnowWorkflow, Component: lazyWorkflow(async () => (await import("./know")).KnowSurface) },
  {
    key: ArticulateWorkflow,
    Component: lazyWorkflow(async () => (await import("./articulate")).ArticulateSurface),
  },
  {
    key: SceneWorkflow,
    Component: lazyWorkflow(async () => (await import("./scene")).SceneSurface),
  },
  {
    key: ReferenceWorkflow,
    Component: lazyWorkflow(async () => (await import("./reference")).ReferenceSurface),
  },
  {
    key: BrowseWorkflow,
    Component: lazyWorkflow(async () => (await import("./browse")).BrowseSurface),
  },
  {
    key: CaptureWorkflow,
    Component: lazyWorkflow(async () => (await import("./capture")).CaptureSurface),
  },
  {
    key: RemixWorkflow,
    Component: lazyWorkflow(async () => (await import("./remix")).RemixSurface),
  },
  { key: NodeWorkflow, Component: lazyWorkflow(async () => (await import("./node")).NodeSurface) },
];
