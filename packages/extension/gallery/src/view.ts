/**
 * The gallery's views: the composer page, and the workflows it hosts.
 *
 * The page is a workflow host, as the graph page is a renderer host
 * (DESIGN-UI.md → The gallery). A workflow is a view of the family
 * `gallery.workflow`: its key carries the question it answers (where the
 * person is coming from), its steps, and the tags it reads and writes, so
 * the chooser lists every workflow provided, the gallery's and any other
 * family's, from the keys alone. What a workflow works on (the library, the
 * look being made, what the page's services offer) is the host's, never its
 * params; its params name only the node it starts from.
 */
import { Schema } from "effect";
import { viewKey, type ViewKey } from "@kb/views";
import { GALLERY_IDS } from "./ids.ts";

/** The namespace of the gallery's view ids: what draws them, the gallery family. */
const GALLERY_NAMESPACE = "gallery";

/** The discriminant a workflow's key carries (`ViewKey.family`). */
const WORKFLOW_FAMILY = "gallery.workflow";

/** What a workflow starts from: a node's id (a visual, a look, any node), or nothing. */
export const WorkflowParams = Schema.Struct({
  from: Schema.optional(Schema.String),
});
export type WorkflowParams = typeof WorkflowParams.Type;

/** The composer page: the workflow it shows (by its local id), and what that starts from. */
export const ComposerParams = Schema.Struct({
  workflow: Schema.optional(Schema.String),
  from: Schema.optional(Schema.String),
});
export type ComposerParams = typeof ComposerParams.Type;

// The page's id is frozen data: it was first stored as the library.
export const GalleryView = viewKey(
  `${GALLERY_NAMESPACE}.library`,
  "Gallery",
  ComposerParams.annotate({
    description:
      "The visual composer: a workflow, chosen by where the person starts from, and the look it makes.",
  }),
);

/** What a workflow is to the chooser and to its host, beyond its params. */
export interface WorkflowTraits {
  /** Where the person is coming from, as the chooser asks it. */
  readonly question: string;
  /** What it does, in one line. */
  readonly blurb: string;
  /** Its steps, in order. */
  readonly steps: readonly string[];
  /** The tags of the nodes it reads. */
  readonly reads: readonly string[];
  /** The tags of the nodes it writes. */
  readonly writes: readonly string[];
}

/** A workflow's key: a view of the composer's family, with its traits. */
export interface WorkflowKey extends ViewKey<WorkflowParams> {
  readonly family: typeof WORKFLOW_FAMILY;
  readonly workflow: WorkflowTraits;
}

/** Whether a view's key is a workflow's: what the chooser lists. */
export function isWorkflowKey(key: ViewKey<unknown>): key is WorkflowKey {
  return key.family === WORKFLOW_FAMILY;
}

/**
 * A workflow's key, `<namespace>.<name>`, for any family: a workflow another
 * family provides is made here too, under its own namespace.
 */
export function workflowKey(
  id: `${string}.${string}`,
  label: string,
  traits: WorkflowTraits,
): WorkflowKey {
  return {
    ...viewKey(id, label, WorkflowParams.annotate({ description: traits.blurb })),
    family: WORKFLOW_FAMILY,
    workflow: traits,
    // A workflow is drawn inside the composer page, open on it.
    page: () => ({ key: GalleryView, input: { workflow: id.slice(id.indexOf(".") + 1) } }),
  };
}

const { visualTag, styleTag, facetTag, lookTag, sourceTag } = GALLERY_IDS;

export const KnowWorkflow = workflowKey(`${GALLERY_NAMESPACE}.know`, "Compose", {
  question: "I know what I want",
  blurb: "Type the words; the library completes them, and the references that match appear.",
  steps: ["Name it", "See the references", "Keep the look"],
  reads: [styleTag, facetTag, visualTag],
  writes: [lookTag],
});

export const SceneWorkflow = workflowKey(`${GALLERY_NAMESPACE}.scene`, "Scene", {
  question: "Set up a scene",
  blurb:
    "Describe it, then fill each part of the shot from the library's pictures: camera, lighting, style, motion.",
  steps: ["Describe it", "Fill each part", "Keep the look"],
  reads: [styleTag, facetTag, visualTag],
  writes: [lookTag],
});

export const ArticulateWorkflow = workflowKey(`${GALLERY_NAMESPACE}.articulate`, "Articulate", {
  question: "Help me articulate it",
  blurb:
    "Start from words, images or links; see it broken into axes, then react to references until it is named.",
  steps: ["Start from anything", "Reflect", "React", "Keep the look"],
  reads: [styleTag, facetTag, visualTag, sourceTag],
  writes: [lookTag, visualTag],
});

export const ReferenceWorkflow = workflowKey(`${GALLERY_NAMESPACE}.reference`, "Reference", {
  question: "I have a picture",
  blurb: "Pick one visual: what it is called, more like it, and variations along one axis.",
  steps: ["Pick a picture", "Name it", "Vary it"],
  reads: [visualTag, styleTag, facetTag],
  writes: [lookTag],
});

export const BrowseWorkflow = workflowKey(`${GALLERY_NAMESPACE}.browse`, "Browse", {
  question: "Browse my library",
  blurb: "Every visual, filtered by facet, and the online sources.",
  steps: ["Filter", "Open", "Use its styles"],
  reads: [visualTag, styleTag, facetTag, sourceTag],
  writes: [visualTag],
});

export const CaptureWorkflow = workflowKey(`${GALLERY_NAMESPACE}.capture`, "Capture", {
  question: "I found something",
  blurb: "Paste, drop or link pictures into the inbox, then give each its styles and a look.",
  steps: ["Capture", "Triage"],
  reads: [visualTag, styleTag, facetTag, lookTag],
  writes: [visualTag, lookTag],
});

export const RemixWorkflow = workflowKey(`${GALLERY_NAMESPACE}.remix`, "Remix", {
  question: "Mix what I have",
  blurb:
    "The lighting of one, the palette of another: take each axis from the reference you choose.",
  steps: ["Choose the sources", "Take each axis", "Keep the look"],
  reads: [visualTag, lookTag, styleTag, facetTag],
  writes: [lookTag],
});

export const NodeWorkflow = workflowKey(`${GALLERY_NAMESPACE}.node`, "For a node", {
  question: "It is for something in kb",
  blurb:
    "Start from a project, scene or note: its words become the brief, and the look links back.",
  steps: ["Pick the node", "Shape the look", "Keep the look"],
  reads: [],
  writes: [lookTag],
});

/** The gallery's own workflows, in the chooser's order. */
export const GALLERY_WORKFLOWS: readonly WorkflowKey[] = [
  KnowWorkflow,
  ArticulateWorkflow,
  SceneWorkflow,
  ReferenceWorkflow,
  BrowseWorkflow,
  CaptureWorkflow,
  RemixWorkflow,
  NodeWorkflow,
];
