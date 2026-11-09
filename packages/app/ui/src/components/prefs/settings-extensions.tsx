/**
 * What Settings' Extensions and Advanced parts draw beside the rows
 * (DESIGN-UI.md → Settings): an extension's heading control (its switch,
 * its lock, or its actions), the lede under its heading (what it adds in a
 * line, where it came from, why it is required), a link to another part,
 * and while the server's report is read, or why it could not be.
 */
import { waitingForPoint } from "@kb/contracts";
import { useState, type ReactNode } from "react";
import { type EnumOption, EnumSelect, navigate, POPOVER_VALUE_CLASS } from "@kb/ui-sdk";
import type { SettingsPart } from "@kb/views";
import { switchExtension, extensionStatus, type PanelExtension } from "@/lib/extension-report";
import { settingsPath } from "@/lib/settings-parts";
import { ExtensionActions, RequiredLock, SourceLine, StatusPill } from "./extension-card";
import { ReviewSheet } from "./extension-controls";

/** Off first: an extension that starts off is off until it is switched on. */
const SWITCH_OPTIONS: readonly EnumOption<"off" | "on">[] = [
  { value: "off", label: "off" },
  { value: "on", label: "on" },
];

export function PartLink({
  part,
  children,
}: {
  readonly part: SettingsPart;
  readonly children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="text-foreground underline-offset-2 hover:underline"
      onClick={() => navigate(settingsPath(part))}
    >
      {children}
    </button>
  );
}

/** A built-in family's switch, as the server reports it; it calls `extension.switch`, never the browser. */
function ExtensionSwitch({ row }: { readonly row: PanelExtension["row"] }) {
  return (
    <EnumSelect
      className={`${POPOVER_VALUE_CLASS} max-w-16 flex-none`}
      value={row.enabled ? "on" : "off"}
      options={SWITCH_OPTIONS}
      testId={`switch-${row.name}`}
      onChange={(next) => void switchExtension(row.name, next === "on")}
    />
  );
}

/**
 * An extension's heading control: a required family's lock, whether or
 * not the server reports it (core is the kernel, not a row); else nothing
 * until the server reports; a built-in family's switch; an installed
 * extension's actions by its state, with the review sheet they open.
 */
export function ExtensionAside({
  extension,
  installed,
  required,
}: {
  readonly extension: PanelExtension | undefined;
  readonly installed: boolean;
  readonly required: string | undefined;
}) {
  const [review, setReview] = useState(false);
  if (required !== undefined) return <RequiredLock because={required} />;
  if (extension === undefined) return null;
  const { row } = extension;
  if (!installed) return <ExtensionSwitch row={row} />;
  return (
    <>
      <ExtensionActions extension={extension} onReview={() => setReview(true)} />
      {review && <ReviewSheet row={row} close={() => setReview(false)} />}
    </>
  );
}

/**
 * The heading's caption: the name the CLI knows it by, when its label is
 * not already that name, and the status it leads with.
 */
export function ExtensionCaption({
  name,
  label,
  extension,
}: {
  readonly name: string;
  readonly label: string;
  readonly extension: PanelExtension | undefined;
}) {
  return (
    <>
      {label !== name && <span className="font-mono">{name}</span>}
      {extension === undefined ? null : <StatusPill status={extensionStatus(extension.row)} />}
    </>
  );
}

/**
 * Under an extension's heading, folded or open: what it adds, in its own
 * line (else a marketplace's); where an installed one came from; why a
 * required one is required.
 */
export function ExtensionLede({
  extension,
  description,
  required,
  installed,
}: {
  readonly extension: PanelExtension | undefined;
  readonly description: string | undefined;
  readonly required: string | undefined;
  readonly installed: boolean;
}) {
  const row = extension?.row;
  if (description === undefined && required === undefined && row === undefined) return null;
  return (
    <div className="space-y-0.5" data-extension-lede>
      {description !== undefined && <p className="text-meta text-foreground/80">{description}</p>}
      {[
        ...new Set(row?.uses.filter(({ from }) => from === null).map(({ point }) => point) ?? []),
      ].map((point) => (
        <p key={point} data-waiting-point={point} className="text-meta text-muted-foreground">
          {waitingForPoint(point)}
        </p>
      ))}
      {installed && row !== undefined && <SourceLine row={row} />}
      {required !== undefined && (
        <p className="text-caption text-muted-foreground">Required: {required}</p>
      )}
    </div>
  );
}

/** While the server's report is read, or why it could not be. */
export function ReportStatus({
  report,
  reread,
}: {
  readonly report: unknown;
  readonly reread: () => void;
}) {
  if (report === null) {
    return (
      <div className="space-y-2 py-2" aria-busy="true" data-testid="extensions-reading">
        <p className="text-ui text-muted-foreground">Reading the extensions…</p>
        {[0, 1, 2].map((at) => (
          <div key={at} className="h-12 animate-pulse rounded-md bg-foreground/5" aria-hidden />
        ))}
      </div>
    );
  }
  if (typeof report !== "string") return null;
  return (
    <div className="flex items-baseline gap-3 rounded-md bg-destructive/10 px-3 py-2">
      <p role="alert" className="text-ui text-destructive">
        {report}
      </p>
      <button
        type="button"
        className="text-meta text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        onClick={reread}
      >
        Ask again
      </button>
    </div>
  );
}
