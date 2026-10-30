/**
 * The composer (DESIGN-UI.md → The gallery): a host of workflows, each a
 * way in, and the look they all make. `/gallery` asks where the person is
 * starting from, listing every workflow provided (`familyViews` over the
 * workflow family, so another family's workflow is listed as the
 * gallery's own are) and the looks made so far, the last workflow chosen
 * first. A workflow's page carries the same choice as tabs, and the look
 * beside it; in a narrow viewport the look is a tab of its own.
 *
 * What a workflow works on travels in the `ComposerFrame`: the library and
 * sources read from the replica (pure readings, so a filter is a pass over
 * memory), where saves go, and the model and the board while a family
 * provides them.
 */
import { useMemo, useState } from "react";
import {
  GALLERY_IDS,
  imageSourcesOf,
  isWorkflowKey,
  libraryOf,
  lookOf,
  looksOf,
  nameOf,
  type ComposerParams,
  type GraphNode,
  type WorkflowKey,
} from "@kb/gallery";
import { localIdOf } from "@kb/views";
import {
  cn,
  familyViews,
  navigate,
  useContributions,
  useNarrowViewport,
  useNodes,
  ViewPoint,
  ViewSlot,
  type FamilyView,
} from "@kb/ui-sdk";
import { lastWorkflow, openLook, rememberWorkflow, useDraft } from "./draft";
import { ComposerFrameContext, type ComposerFrame } from "./frame";
import { LookPanel } from "./look-panel";
import { ComposerModelPoint } from "./model";
import { MoodboardPoint } from "./moodboard";
import { galleryPath } from "./routes";
import { Starter } from "./starter";
import { Tabs } from "./tabs";

const SAVE_INTO = "sys.extension.gallery";

function saveIntoOf(node: (id: string) => GraphNode | undefined): string | null {
  const value = node(SAVE_INTO)?.props[GALLERY_IDS.saveIntoField]?.find((v) => v.t === "ref");
  return value?.t === "ref" ? value.v : null;
}

function useFrame(): ComposerFrame {
  const nodes = useNodes();
  const library = useMemo(() => libraryOf(nodes.values()), [nodes]);
  const sources = useMemo(() => imageSourcesOf(nodes.values()), [nodes]);
  const model = useContributions(ComposerModelPoint)[0]?.value ?? null;
  const board = useContributions(MoodboardPoint)[0]?.value ?? null;
  return useMemo(() => {
    const node = (id: string) => nodes.get(id);
    const open = (workflow: string, from?: string) => {
      rememberWorkflow(workflow);
      navigate(galleryPath({ workflow, ...(from === undefined ? {} : { from }) }));
    };
    return { library, node, sources, saveInto: saveIntoOf(node), model, board, open };
  }, [nodes, library, sources, model, board]);
}

/** How many ways in the chooser draws large, the family's first: the two the gallery is for. */
const LEADING = 2;

function WayIn({
  workflow,
  last,
  large,
  frame,
}: {
  readonly workflow: WorkflowKey;
  readonly last: boolean;
  readonly large: boolean;
  readonly frame: ComposerFrame;
}) {
  const { blurb, steps, reads, writes } = workflow.workflow;
  const tags = (ids: readonly string[]) => ids.map((id) => frame.node(id)?.text ?? id).join(", ");
  const touches = `Reads ${tags(reads)}; makes ${tags(writes)}`;
  return (
    <button
      type="button"
      data-gallery-workflow={localIdOf(workflow)}
      title={large ? touches : `${blurb}\n${steps.join(" → ")}\n${touches}`}
      className={cn(
        "flex flex-col items-start gap-1 rounded-lg border border-border text-left hover:bg-foreground/5",
        large ? "p-4" : "px-3 py-2",
        last && "border-primary/40",
      )}
      onClick={() => frame.open(localIdOf(workflow))}
    >
      <span className={cn("font-medium text-foreground/85", large ? "text-title" : "text-ui")}>
        {workflow.workflow.question}
      </span>
      {large && (
        <>
          <span className="text-meta text-foreground/55">{blurb}</span>
          <span className="text-label text-foreground/40">{steps.join(" → ")}</span>
        </>
      )}
      {last && <span className="text-label text-primary">Last used</span>}
    </button>
  );
}

function Chooser({
  workflows,
  frame,
}: {
  readonly workflows: readonly FamilyView<WorkflowKey>[];
  readonly frame: ComposerFrame;
}) {
  const nodes = useNodes();
  const looks = useMemo(() => looksOf(nodes.values()), [nodes]);
  const last = lastWorkflow();
  // The last way in is offered first, and large, with the family's leading ones.
  const leading = new Set([
    ...(last === null ? [] : [last]),
    ...workflows.slice(0, LEADING).map(({ key }) => localIdOf(key)),
  ]);
  const ordered = workflows.toSorted(
    (a, b) => Number(localIdOf(b.key) === last) - Number(localIdOf(a.key) === last),
  );
  const way = (key: WorkflowKey) => (
    <WayIn
      key={key.id}
      workflow={key}
      last={localIdOf(key) === last}
      large={leading.has(localIdOf(key))}
      frame={frame}
    />
  );
  return (
    <div
      data-testid="gallery-chooser"
      className="mx-auto flex w-full max-w-3xl flex-col gap-6 overflow-y-auto p-6"
    >
      <h1 className="text-title font-medium text-foreground/85">Where are you starting from?</h1>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {ordered.filter(({ key }) => leading.has(localIdOf(key))).map(({ key }) => way(key))}
      </div>
      <div className="flex flex-col gap-2">
        <h2 className="text-meta text-foreground/55">More ways in</h2>
        <div className="flex flex-wrap gap-2">
          {ordered.filter(({ key }) => !leading.has(localIdOf(key))).map(({ key }) => way(key))}
        </div>
      </div>
      {looks.length > 0 && (
        <div className="flex flex-col gap-2">
          <h2 className="text-meta text-foreground/55">Or carry on with a look</h2>
          <div className="flex flex-wrap gap-1">
            {looks.map((look) => (
              <button
                key={look.id}
                type="button"
                className="rounded-md border border-border px-2 py-1 text-meta text-foreground/75 hover:bg-foreground/5"
                onClick={() => {
                  if (openLook(lookOf(look, frame.node), frame.node)) frame.open(last ?? "know");
                }}
              >
                {nameOf(lookOf(look, frame.node))}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const LOOK_TAB = "look";

function Workflow({
  workflow,
  workflows,
  params,
  frame,
}: {
  readonly workflow: WorkflowKey;
  readonly workflows: readonly FamilyView<WorkflowKey>[];
  readonly params: ComposerParams;
  readonly frame: ComposerFrame;
}) {
  const narrow = useNarrowViewport();
  const draft = useDraft();
  const [lookShown, setLookShown] = useState(false);
  const id = localIdOf(workflow);
  const tabs = [
    ...workflows.map(({ key }) => ({
      id: localIdOf(key),
      label: key.label,
      title: key.workflow.question,
    })),
    ...(narrow
      ? [{ id: LOOK_TAB, label: `Look${draft.pins.length + draft.styles.length > 0 ? " •" : ""}` }]
      : []),
  ];
  const pick = (next: string) => {
    if (next === LOOK_TAB) return setLookShown(true);
    setLookShown(false);
    if (next !== id) frame.open(next);
  };
  const slot = (
    <ViewSlot
      view={workflow}
      params={params.from === undefined ? {} : { from: params.from }}
      placement="inline"
      subject={`${id}|${params.from ?? ""}`}
      fallback={
        <p className="p-6 text-meta text-foreground/45">This workflow cannot be shown here.</p>
      }
    />
  );
  return (
    <ComposerFrameContext.Provider value={frame}>
      <div data-testid="gallery-page" className="flex h-full min-h-0 flex-col">
        <div className="flex shrink-0 items-center">
          <button
            type="button"
            title="Where are you starting from?"
            className="shrink-0 px-3 text-meta text-foreground/50 hover:text-foreground/80"
            onClick={() => navigate(galleryPath())}
          >
            Start
          </button>
          <div className="min-w-0 flex-1">
            <Tabs
              label="Workflows"
              tabs={tabs}
              shown={narrow && lookShown ? LOOK_TAB : id}
              onPick={pick}
            />
          </div>
        </div>
        {narrow ? (
          <div className="min-h-0 flex-1 overflow-y-auto">
            {lookShown ? <LookPanel frame={frame} /> : slot}
          </div>
        ) : (
          <div className="flex min-h-0 flex-1">
            <div className="min-w-0 flex-1">{slot}</div>
            <aside className="w-80 shrink-0 overflow-y-auto border-l border-border">
              <LookPanel frame={frame} />
            </aside>
          </div>
        )}
      </div>
    </ComposerFrameContext.Provider>
  );
}

export default function ComposerPage({ params }: { readonly params: ComposerParams }) {
  const frame = useFrame();
  const views = useContributions(ViewPoint);
  const workflows = useMemo(() => familyViews(views, isWorkflowKey), [views]);
  if (frame.library.facets.length === 0 && frame.library.visuals.length === 0) return <Starter />;
  const chosen = workflows.find(({ key }) => localIdOf(key) === params.workflow);
  if (chosen === undefined) return <Chooser workflows={workflows} frame={frame} />;
  return <Workflow workflow={chosen.key} workflows={workflows} params={params} frame={frame} />;
}
