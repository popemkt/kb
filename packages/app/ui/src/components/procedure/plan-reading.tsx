/**
 * A procedure step's changes, drawn (DESIGN-UI.md → Procedure page): the
 * plan reading its `changes` call answers, grouped by what each write does
 * and capped, each write its node (a link that opens it) and its parts'
 * before and after, whitespace made visible. The reading is the action's
 * (`PlanReadingSchema`), the diff and the marks `@kb/model`'s, so the page
 * shows what `kb migrate --plan` prints and builds no diff of its own.
 */
import { useEffect, useMemo, useState } from "react";
import type { z } from "zod";
import { PlanReadingSchema, type ProcedureCall } from "@kb/contracts";
import { WRITE_KINDS, partDiff, visibleText } from "@kb/model";
import { Button, browserHost, cn, failureText, usePane } from "@kb/ui-sdk";
import { nodePath } from "@kb/views";
import { useGraphStore } from "@/stores/graph.store";
import { useWorkspaceStore } from "@/stores/workspace.store";

type Reading = z.infer<typeof PlanReadingSchema>;
type Write = Reading["writes"][number];
type Kind = Write["kind"];
type Part = Write["parts"][number];

/** How many writes a group shows before its "Show all". */
const GROUP_CAP = 25;

const GROUP_TITLE: Readonly<Record<Kind, string>> = {
  change: "Changes",
  create: "Creates",
  delete: "Deletes",
};

/** The reading of `call`, read again when the store moves; what the card says while it is unread or unreadable. */
function useReading(call: ProcedureCall) {
  const rev = useGraphStore((state) => state.rev);
  const [read, setRead] = useState<
    { readonly reading: Reading } | { readonly problem: string } | undefined
  >();
  const { action, input } = call;
  const inputKey = JSON.stringify(input);
  // What a reading is of: the call, at this revision of the store.
  const key = useMemo(() => ({ action, inputKey, rev }), [action, inputKey, rev]);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const receipt = await browserHost().invoke(key.action, JSON.parse(key.inputKey) as unknown);
        if (cancelled) return;
        if (receipt.status === "failed") throw new Error(failureText(receipt));
        setRead({ reading: PlanReadingSchema.parse(receipt.output) });
      } catch (cause) {
        if (!cancelled) setRead({ problem: String(cause) });
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [key]);
  return read;
}

/** Each of `pieces` with a key: its kind and where it starts in the text they make together. */
function byOffset<T>(
  pieces: readonly T[],
  textOf: (piece: T) => string,
  kindOf: (piece: T) => string,
) {
  let offset = 0;
  return pieces.map((piece) => {
    const key = `${kindOf(piece)}@${offset}`;
    offset += textOf(piece).length;
    return { piece, key };
  });
}

/**
 * `text` with its whitespace drawn by `visibleText`. In shared text a mark
 * is faint, so it reads as a mark and not as text; in a change (`spaces`) it
 * is as strong as the change's text, since there it may be all the change is. A
 * character the person wrote stays as it is, a `·` among them.
 */
function Marked({ text, spaces }: { readonly text: string; readonly spaces: boolean }) {
  return (
    <>
      {byOffset(
        text.split(/([\n\t\r ])/u),
        (piece) => piece,
        () => "text",
      ).map(({ piece, key }) => {
        const mark = visibleText(piece, spaces);
        return mark === piece ? (
          piece
        ) : (
          <span key={key} className={spaces ? "font-semibold" : "text-faint-foreground"}>
            {mark}
          </span>
        );
      })}
    </>
  );
}

/** A part's change as one run: what it keeps plain, removed struck on the destructive tint, added on the success tint. */
function Diff({ part }: { readonly part: Part }) {
  return (
    <span className="min-w-0 break-all font-mono text-label" data-plan-diff>
      {byOffset(
        partDiff(part),
        (span) => span.text,
        (span) => span.kind,
      ).map(({ piece: span, key }) =>
        span.kind === "same" ? (
          <Marked key={key} text={span.text} spaces={false} />
        ) : (
          <span
            key={key}
            className={cn(
              "rounded-sm px-0.5",
              span.kind === "removed"
                ? "bg-destructive/15 text-foreground line-through decoration-destructive"
                : "bg-success/15 text-foreground",
            )}
            data-plan-span={span.kind}
          >
            <span className="sr-only">{span.kind === "removed" ? "removed: " : "added: "}</span>
            <Marked text={span.text} spaces />
          </span>
        ),
      )}
    </span>
  );
}

/** One write: its node's name (a link that opens it, unless it is deleted) and id, then a row per part. */
function WriteRow({ write }: { readonly write: Write }) {
  const pane = usePane();
  const name = write.name === "" ? "Untitled" : write.name;
  return (
    <li className="space-y-1 py-2" data-plan-write={write.id}>
      <p className="flex min-w-0 flex-wrap items-baseline gap-x-2">
        {write.kind === "delete" ? (
          <span className="min-w-0 break-words text-ui font-medium">{name}</span>
        ) : (
          <button
            type="button"
            className="min-w-0 break-words text-left text-ui font-medium text-foreground underline decoration-border underline-offset-2 hover:decoration-foreground"
            onClick={() => useWorkspaceStore.getState().navigatePane(pane, nodePath(write.id))}
          >
            {name}
          </button>
        )}
        <code className="font-mono text-caption text-faint-foreground">{write.id}</code>
      </p>
      <dl className="grid grid-cols-1 gap-x-3 gap-y-1 sm:grid-cols-[auto_minmax(0,1fr)]">
        {write.parts.map((part) => (
          <div key={part.part} className="contents">
            <dt className="text-label text-muted-foreground">{part.label}</dt>
            <dd className="min-w-0">
              <Diff part={part} />
            </dd>
          </div>
        ))}
      </dl>
    </li>
  );
}

/** One group of writes, headed by its count, its first {@link GROUP_CAP} shown until the person asks for all. */
function Group({ kind, writes }: { readonly kind: Kind; readonly writes: readonly Write[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? writes : writes.slice(0, GROUP_CAP);
  return (
    <section className="space-y-1" data-plan-group={kind}>
      <h3 className="text-label font-semibold text-muted-foreground">
        {GROUP_TITLE[kind]} · {writes.length}
      </h3>
      <ul className="divide-y divide-border">
        {shown.map((write) => (
          <WriteRow key={write.id} write={write} />
        ))}
      </ul>
      {shown.length < writes.length && (
        <Button variant="ghost" onClick={() => setAll(true)}>
          Show all {writes.length}
        </Button>
      )}
    </section>
  );
}

/** The changes a step is about, read through its `changes` call. */
export function PlanChanges({ call }: { readonly call: ProcedureCall }) {
  const read = useReading(call);
  if (read === undefined)
    return (
      <p role="status" className="text-meta text-muted-foreground">
        Reading what it will write…
      </p>
    );
  if ("problem" in read)
    return (
      <p role="alert" className="text-meta">
        Could not read what it will write: {read.problem}
      </p>
    );
  const { reading } = read;
  const total = reading.creates + reading.changes + reading.deletes;
  return (
    <div className="space-y-3 rounded-md border border-border bg-background p-3" data-plan-changes>
      <p className="text-meta">
        {total === 0
          ? "Nothing to write"
          : `Creates ${reading.creates}, changes ${reading.changes}, deletes ${reading.deletes}`}
      </p>
      {WRITE_KINDS.map((kind) => {
        const writes = reading.writes.filter((write) => write.kind === kind);
        return writes.length === 0 ? null : <Group key={kind} kind={kind} writes={writes} />;
      })}
      {reading.more > 0 && (
        <p className="text-meta text-muted-foreground">and {reading.more} more not read</p>
      )}
    </div>
  );
}
