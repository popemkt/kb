/**
 * The studio's knob panel: a backdrop's knobs and its variant's, drawn with
 * the one knob control (`KnobControl`), as the lab's info card draws a
 * study's, each with a reset to its default. The values are the nodes'
 * (`knobValues`): what the panel writes is what every page head shows.
 */
import { ArrowCounterClockwiseIcon } from "@phosphor-icons/react";
import { knobFieldId, knobValues, type Knob, type KnobValue, type NodeId } from "@kb/model";
import { KnobControl, useNode, useNodes } from "@kb/ui-sdk";
import { useSettlingKnobs } from "./knob-writes";

/** A run of knobs and the node that holds their values: a backdrop's own, or its variant's. */
export interface KnobGroup {
  readonly title: string;
  readonly holder: NodeId;
  readonly knobs: readonly Knob[];
}

type Settling = ReturnType<typeof useSettlingKnobs>;

function ResetButton({
  label,
  held,
  onReset,
}: {
  label: string;
  held: boolean;
  onReset: () => void;
}) {
  return (
    <button
      type="button"
      className="rounded-sm p-0.5 text-foreground/45 hover:text-foreground/80 focus-visible:outline focus-visible:outline-primary disabled:opacity-0"
      aria-label={`Reset ${label} to its default`}
      title="Reset to default"
      disabled={!held}
      onClick={onReset}
    >
      <ArrowCounterClockwiseIcon size={12} aria-hidden="true" />
    </button>
  );
}

function GroupRows({ group, settling }: { group: KnobGroup; settling: Settling }) {
  const props = useNode(group.holder)?.props;
  const values = knobValues(group.knobs, group.holder, props);
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1 text-label font-medium text-foreground/45">{group.title}</legend>
      {group.knobs.map((knob) => {
        const field = knobFieldId(group.holder, knob.id);
        const draft: KnobValue | undefined = settling.drafts[field];
        return (
          <div key={knob.id} className="flex items-center gap-1" data-knob={knob.id}>
            <div className="min-w-0 flex-1">
              <KnobControl
                knob={knob}
                value={draft === undefined ? values[knob.id] : draft}
                onChange={(value) => settling.set(group.holder, knob, value)}
              />
            </div>
            <ResetButton
              label={knob.label}
              held={props?.[field] !== undefined || draft !== undefined}
              onReset={() => settling.reset(group.holder, knob)}
            />
          </div>
        );
      })}
    </fieldset>
  );
}

/** Whether any of `groups`' knobs holds a value of its own. */
function useAnyHeld(groups: readonly KnobGroup[]): boolean {
  const nodes = useNodes();
  return groups.some(({ holder, knobs }) =>
    knobs.some(({ id }) => nodes.get(holder)?.props[knobFieldId(holder, id)] !== undefined),
  );
}

export function KnobPanel({ groups }: { readonly groups: readonly KnobGroup[] }) {
  const settling = useSettlingKnobs();
  const anyHeld = useAnyHeld(groups);
  const shown = groups.filter(({ knobs }) => knobs.length > 0);
  return (
    <section
      aria-label="Knobs"
      className="pointer-events-auto flex w-80 flex-col gap-3 rounded-lg border border-foreground/10 bg-popover/85 p-3 text-meta shadow-floating backdrop-blur-md"
    >
      <header className="flex items-center gap-2">
        <h2 className="flex-1 font-medium text-foreground/80">Knobs</h2>
        <button
          type="button"
          className="rounded-sm px-1.5 text-label text-foreground/50 hover:text-foreground/80 focus-visible:outline focus-visible:outline-primary disabled:opacity-40"
          disabled={!anyHeld}
          onClick={() => {
            for (const { holder, knobs } of shown)
              for (const knob of knobs) settling.reset(holder, knob);
          }}
        >
          Reset all
        </button>
      </header>
      {shown.length === 0 ? (
        <p className="text-foreground/50">This backdrop has no knobs.</p>
      ) : (
        shown.map((group) => <GroupRows key={group.holder} group={group} settling={settling} />)
      )}
      <p className="text-label leading-snug text-foreground/40">
        Saved for every page that shows it. Agents set the same values with <code>kb set</code>.
      </p>
    </section>
  );
}
