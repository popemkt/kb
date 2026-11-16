/**
 * The Copy as… dialog (DESIGN-UI.md → Outline editor, "Copy, cut and Copy
 * as…"): the format, its options and a live preview of exactly what Copy
 * puts. It opens on the outline family's remembered choice and, when Copy
 * is pressed, writes what changed as one write. Loaded when it first opens.
 */
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { extensionNodeId, type RefForm } from "@kb/model";
import { copyChoiceOf, copyChoiceValues } from "@kb/outline";
import { OUTLINE_FORMATS, type ExportOptions, type OutlineFormatId } from "@kb/outline-paste";
import { browserHost, Button, cn, Dialog, writeFlavours } from "@kb/ui-sdk";
import { copyFlavours } from "./row-copy";

/** Where each format goes, said under it. */
const WHERE: Readonly<Record<OutlineFormatId, string>> = {
  md: "Notes apps, chats and plain editors",
  plain: "Just the words, nested by indent",
  html: "Documents, Slack and mail, as a list; kb cannot read it back",
  tana: "Tana, as Tana Paste",
  logseq: "Logseq, its fields as property lines",
  json: "Everything kb holds, for a script or another kb",
};

const REF_FORMS: readonly { readonly id: RefForm; readonly label: string }[] = [
  { id: "label", label: "Words" },
  { id: "link", label: "[[Links]]" },
  { id: "id", label: "IDs" },
];

const INDENTS: readonly { readonly id: ExportOptions["indent"]; readonly label: string }[] = [
  { id: "spaces", label: "Two spaces" },
  { id: "tabs", label: "A tab" },
];

/** Why an option means nothing to `format`, or null when it applies. */
function ignoredBy(format: OutlineFormatId, option: "fieldsAndTags" | "indent"): string | null {
  if (option === "fieldsAndTags" && format === "plain") return "Plain text has no tags or fields";
  if (option === "indent" && format === "html") return "Rich text has no indent";
  return null;
}

/** One choice among a few, each a pressed button. */
function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  disabled,
}: {
  readonly label: string;
  readonly options: readonly { readonly id: T; readonly label: string }[];
  readonly value: T;
  readonly onChange: (value: T) => void;
  readonly disabled?: string | null;
}) {
  return (
    <div className="flex items-center justify-between gap-2" title={disabled ?? undefined}>
      <span
        className={cn(
          "text-ui text-foreground/70",
          (disabled ?? null) === null ? null : "opacity-50",
        )}
      >
        {label}
      </span>
      <div role="radiogroup" aria-label={label} className="flex gap-0.5">
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={option.id === value}
            disabled={disabled !== null && disabled !== undefined}
            onClick={() => onChange(option.id)}
            className={cn(
              "rounded-md px-2 py-0.5 text-label font-medium transition-colors duration-100 disabled:opacity-50",
              option.id === value
                ? "bg-foreground/[0.08] text-foreground"
                : "text-foreground/50 hover:bg-foreground/[0.04] hover:text-foreground/75",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Check({
  label,
  checked,
  onChange,
  disabled,
}: {
  readonly label: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly disabled?: string | null;
}) {
  return (
    <label
      title={disabled ?? undefined}
      className={cn(
        "flex items-center justify-between gap-2 text-ui text-foreground/70",
        (disabled ?? null) === null ? null : "opacity-50",
      )}
    >
      <span>{label}</span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled !== null && disabled !== undefined}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}

function Section({
  title,
  children,
  className,
}: {
  readonly title: string;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <section className={cn("flex flex-col gap-1.5", className)}>
      <h3 className="text-meta font-medium text-foreground/50">{title}</h3>
      {children}
    </section>
  );
}

/**
 * Rich text drawn as a document would draw it, in a frame that runs
 * nothing: the clipboard's HTML, in the dialog's own ink and face, read
 * from the box it sits in so a dark page draws it dark.
 */
function RichPreview({ html }: { readonly html: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [ink, setInk] = useState<{ color: string; font: string } | null>(null);
  useLayoutEffect(() => {
    if (box.current === null) return;
    const style = getComputedStyle(box.current);
    setInk({ color: style.color, font: style.font });
  }, []);
  const page =
    ink === null
      ? html
      : `<style>body{margin:0.5rem;color:${ink.color};font:${ink.font}}a{color:inherit}</style>${html}`;
  return (
    <div ref={box} className="flex min-h-40 flex-1 text-ui text-foreground">
      <iframe
        title="Rich text preview"
        data-testid="copy-as-preview"
        // No scripts run in it. Its own origin stays the page's, since the
        // page's `frame-ancestors 'self'`, which a srcdoc frame inherits,
        // refuses a frame whose origin is opaque and leaves it blank.
        sandbox="allow-same-origin"
        srcDoc={page}
        className="max-h-80 min-h-40 w-full flex-1 rounded-md border border-border bg-background"
      />
    </div>
  );
}

/** Write the settings `choice` changes from `was`, as one write. */
async function remember(was: ExportOptions, choice: ExportOptions): Promise<void> {
  const before = copyChoiceValues(was);
  const changed = Object.entries(copyChoiceValues(choice)).filter(
    ([field, value]) => JSON.stringify(before[field]) !== JSON.stringify(value),
  );
  if (changed.length === 0) return;
  const { writes } = browserHost();
  const family = extensionNodeId("outline");
  await writes.together(() =>
    Promise.all(changed.map(([field, value]) => writes.replaceField(family, field, [value]))),
  );
}

export default function CopyAsDialog({
  rows,
  onClose,
}: {
  readonly rows: readonly string[];
  readonly onClose: () => void;
}) {
  const was = useMemo(
    () => copyChoiceOf(browserHost().nodes().get(extensionNodeId("outline"))),
    [],
  );
  const [choice, setChoice] = useState(was);
  const set = (patch: Partial<ExportOptions>) => setChoice((current) => ({ ...current, ...patch }));
  const flavours = useMemo(
    () => copyFlavours(rows, browserHost().schema(), choice),
    [rows, choice],
  );
  const format = OUTLINE_FORMATS.find((candidate) => candidate.id === choice.format);
  const html = flavours["text/html"];

  const copy = async () => {
    const copied = await writeFlavours(flavours, format?.label ?? "Outline");
    if (!copied) return;
    await remember(was, choice);
    onClose();
  };

  return (
    <Dialog
      title="Copy as…"
      onClose={onClose}
      testId="copy-as"
      className="sm:max-w-2xl"
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => void copy()}>
            Copy
          </Button>
        </>
      }
    >
      {/* On a phone the preview follows the format it shows; beside it on a wider screen. */}
      <div className="grid gap-4 sm:grid-cols-5">
        <Section title="Format" className="sm:col-span-2 sm:col-start-1 sm:row-start-1">
          <div role="radiogroup" aria-label="Format" className="flex flex-col gap-0.5">
            {OUTLINE_FORMATS.map((candidate) => (
              <button
                key={candidate.id}
                type="button"
                role="radio"
                aria-checked={candidate.id === choice.format}
                data-format={candidate.id}
                onClick={() => set({ format: candidate.id })}
                className={cn(
                  "flex flex-col items-start rounded-md px-2 py-1 text-left transition-colors duration-100",
                  candidate.id === choice.format
                    ? "bg-foreground/[0.08]"
                    : "hover:bg-foreground/[0.04]",
                )}
              >
                <span className="text-ui font-medium text-foreground">{candidate.label}</span>
                <span className="text-meta text-foreground/50">{WHERE[candidate.id]}</span>
              </button>
            ))}
          </div>
        </Section>
        <Section
          title="Preview"
          className="min-w-0 sm:col-span-3 sm:col-start-3 sm:row-span-2 sm:row-start-1"
        >
          {html === undefined ? (
            <pre
              data-testid="copy-as-preview"
              className="max-h-80 min-h-40 min-w-0 flex-1 overflow-auto whitespace-pre rounded-md border border-border bg-background p-2 font-mono text-meta text-foreground"
            >
              {flavours["text/plain"]}
            </pre>
          ) : (
            <RichPreview html={html} />
          )}
        </Section>
        <Section title="Options" className="sm:col-span-2 sm:col-start-1 sm:row-start-2">
          <Check
            label="Include children"
            checked={choice.children}
            onChange={(children) => set({ children })}
          />
          <Check
            label="Include fields and tags"
            checked={choice.fieldsAndTags}
            onChange={(fieldsAndTags) => set({ fieldsAndTags })}
            disabled={ignoredBy(choice.format, "fieldsAndTags")}
          />
          <Segmented
            label="References as"
            options={REF_FORMS}
            value={choice.refs}
            onChange={(refs) => set({ refs })}
          />
          <Segmented
            label="Indent with"
            options={INDENTS}
            value={choice.indent}
            onChange={(indent) => set({ indent })}
            disabled={ignoredBy(choice.format, "indent")}
          />
        </Section>
      </div>
    </Dialog>
  );
}
