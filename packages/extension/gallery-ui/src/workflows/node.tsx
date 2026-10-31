/**
 * It is for something in kb (DESIGN-UI.md → The gallery): a look is often
 * for a project, a scene, a story or a note. The node is the one the
 * workflow was opened on, or one found by its text; picking it makes it
 * the look's `for`, so its backlinks show its art direction, and its words
 * (its text and its first children's, plain) seed an empty brief. The looks
 * already made for it can be carried on; then the look is shaped by
 * articulating it or naming it.
 */
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { lookOf, looksOf, nameOf, type GraphNode, type WorkflowParams } from "@kb/gallery";
import { navigate, nodePath, useNodes } from "@kb/ui-sdk";
import { openLook, updateDraft, useDraft } from "../draft";
import { useComposer, type ComposerFrame } from "../frame";
import { findNodes, isPickable, looksFor, plainOf, seedOf } from "./node-model";
import { NoComposer } from "./no-composer";

const BUTTON =
  "rounded-md border border-border px-2 py-0.5 text-label text-foreground/70 hover:bg-foreground/5";
const HEADING = "text-label text-foreground/45";

/** Make `node` what the look is for, seeding an empty brief with its words. */
function pick(node: GraphNode, get: (id: string) => GraphNode | undefined): void {
  updateDraft((d) =>
    d.forNode === node.id && d.description.trim() !== ""
      ? d
      : {
          ...d,
          forNode: node.id,
          description: d.description.trim() === "" ? seedOf(node, get) : d.description,
        },
  );
}

function NodeSearch({
  frame,
  onPicked,
}: {
  readonly frame: ComposerFrame;
  readonly onPicked: () => void;
}) {
  const nodes = useNodes();
  const [text, setText] = useState("");
  const query = useDeferredValue(text);
  const found = useMemo(() => findNodes(nodes.values(), query), [nodes, query]);
  return (
    <section className="flex flex-col gap-2">
      <span className={HEADING}>What is the look for?</span>
      <input
        type="search"
        value={text}
        placeholder="Find a project, scene or note by its text"
        aria-label="Find the node the look is for"
        className="w-full min-w-0 rounded-md border border-border bg-transparent px-2 py-1 text-meta text-foreground/85"
        onChange={(e) => setText(e.target.value)}
      />
      {query.trim() === "" && found.length > 0 && (
        <p className="text-label text-foreground/45">
          The newest first. The look will name the node it is for, so the node lists its looks.
        </p>
      )}
      {query.trim() !== "" && found.length === 0 && (
        <p className="text-meta text-foreground/45">No node holds those words.</p>
      )}
      <ul className="flex flex-col">
        {found.map((node) => (
          <li key={node.id}>
            <button
              type="button"
              className="w-full truncate rounded-md px-2 py-1 text-left text-meta text-foreground/75 hover:bg-foreground/5"
              onClick={() => {
                pick(node, frame.node);
                onPicked();
              }}
            >
              {plainOf(node.text, frame.node) || node.id}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ForNode({
  frame,
  node,
  onChange,
}: {
  readonly frame: ComposerFrame;
  readonly node: GraphNode;
  readonly onChange: () => void;
}) {
  const nodes = useNodes();
  const looks = useMemo(
    () => looksFor(looksOf(nodes.values()), node.id, frame.node),
    [nodes, node.id, frame.node],
  );
  const words = seedOf(node, frame.node).split("\n");
  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-1">
        <span className={HEADING}>The look is for</span>
        <h2 className="text-ui font-medium break-words text-foreground/85">{words[0]}</h2>
        {words.length > 1 && (
          <p className="text-meta break-words whitespace-pre-line text-foreground/60">
            {words.slice(1).join("\n")}
          </p>
        )}
        <div className="flex flex-wrap gap-1 pt-1">
          <button type="button" className={BUTTON} onClick={() => navigate(nodePath(node.id))}>
            Open node
          </button>
          <button type="button" className={BUTTON} onClick={onChange}>
            Choose another
          </button>
        </div>
      </section>
      {looks.length > 0 && (
        <section className="flex flex-col gap-1">
          <span className={HEADING}>Looks made for it: carry one on</span>
          <div className="flex flex-wrap gap-1">
            {looks.map((look) => (
              <button
                key={look.id}
                type="button"
                className={BUTTON}
                onClick={() => openLook(lookOf(look, frame.node), frame.node)}
              >
                {nameOf(lookOf(look, frame.node))}
              </button>
            ))}
          </div>
        </section>
      )}
      <section className="flex flex-col gap-1">
        <span className={HEADING}>Then shape the look</span>
        <div className="flex flex-wrap gap-1">
          <button
            type="button"
            className="rounded-md border border-primary/40 px-2 py-0.5 text-label text-primary hover:bg-primary/10"
            onClick={() => frame.open("articulate")}
          >
            Articulate it
          </button>
          <button type="button" className={BUTTON} onClick={() => frame.open("know")}>
            I know the words
          </button>
        </div>
      </section>
    </div>
  );
}

function ForNodeWorkflow({
  frame,
  from,
}: {
  readonly frame: ComposerFrame;
  readonly from: GraphNode | null;
}) {
  const draft = useDraft();
  const [choosing, setChoosing] = useState(false);
  // Opened on a node, the look is for it: once, so choosing another is not undone by an edit.
  const fromId = from?.id ?? null;
  useEffect(() => {
    const node = fromId === null ? undefined : frame.node(fromId);
    if (node !== undefined) pick(node, frame.node);
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- once per node opened on, not per graph edit
  }, [fromId]);
  const chosen = draft.forNode === null ? undefined : frame.node(draft.forNode);
  return (
    <div data-testid="gallery-for-node" className="h-full overflow-y-auto p-3">
      {chosen === undefined || choosing ? (
        <NodeSearch frame={frame} onPicked={() => setChoosing(false)} />
      ) : (
        <ForNode frame={frame} node={chosen} onChange={() => setChoosing(true)} />
      )}
    </div>
  );
}

export function NodeSurface({ params }: { readonly params: WorkflowParams }) {
  const frame = useComposer();
  if (frame === null) return <NoComposer />;
  const start = params.from === undefined ? undefined : frame.node(params.from);
  return (
    <ForNodeWorkflow frame={frame} from={start !== undefined && isPickable(start) ? start : null} />
  );
}
