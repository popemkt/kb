/**
 * What Settings' Extensions and Advanced parts draw beside the rows
 * (DESIGN-UI.md → Settings): an extension's switch and the fold of what
 * it composes, a link to another part, and while the server's report is
 * read, or why it could not be.
 */
import type { NodeId } from "@kb/model";
import { type EnumOption, EnumSelect, navigate, POPOVER_VALUE_CLASS } from "@kb/ui-sdk";
import type { SettingsPart } from "@kb/views";
import type { ReactNode } from "react";
import { switchExtension, type PanelExtension, type PanelReport } from "@/lib/extension-report";
import { settingsPath } from "@/lib/settings-parts";
import { Disclosure } from "./settings-fold";

/** Off first: an optional extension is off until it is switched on. */
const SWITCH_OPTIONS: readonly EnumOption<"off" | "on">[] = [
  { value: "off", label: "off" },
  { value: "on", label: "on" },
];

/** Whether kb's build carries it, the `kb ui` host composes it, or a person trusted it at a digest. */
function trustOf({ source, digest }: PanelExtension["row"]): string {
  if (source === "bundled") return "part of kb's build";
  if (source === "host") return "composed by kb ui";
  return digest === undefined ? `from ${source}` : `trusted at ${digest} · ${source}`;
}

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

/** The switch of an optional extension, or that it is required; nothing until the server reports. */
export function ExtensionSwitch({ extension }: { readonly extension: PanelExtension | undefined }) {
  if (extension === undefined) return null;
  const { row } = extension;
  return row.optional ? (
    <span className="flex items-center gap-2">
      {row.enabled ? null : (
        <span className="text-caption text-faint-foreground">off: contributes nothing</span>
      )}
      <EnumSelect
        className={`${POPOVER_VALUE_CLASS} max-w-16 flex-none`}
        value={row.enabled ? "on" : "off"}
        options={SWITCH_OPTIONS}
        testId={`switch-${row.name}`}
        onChange={(next) => void switchExtension(row.name, next === "on")}
      />
    </span>
  ) : (
    <span className="text-meta text-muted-foreground">required</span>
  );
}

/** Why its plugins failed, then a fold of its trust, tags, contributions and services. */
export function Composes({
  nodeId,
  extension,
}: {
  readonly nodeId: NodeId;
  readonly extension: PanelExtension;
}) {
  const { row, contributions, seeds } = extension;
  const services = [
    ...row.injects.map(({ service, from }) => `injects ${service} from ${from ?? "nobody yet"}`),
    ...row.provides.map((service) => `provides ${service}`),
  ];
  return (
    <>
      {row.failures.map((failure) => (
        <p key={failure} role="alert" className="text-meta text-destructive">
          {failure}
        </p>
      ))}
      <Disclosure id={`${nodeId}:composes`} title="What it composes" level="inner" opensBy={false}>
        <div className="text-meta text-muted-foreground" data-testid={`trust-${row.name}`}>
          {trustOf(row)}
          {row.tags.length > 0 ? ` · tags: ${row.tags.join(", ")}` : ""}
        </div>
        {contributions.size === 0 && seeds === 0 ? null : (
          <dl className="mt-1 grid grid-cols-[max-content_1fr] gap-x-3 text-meta">
            {[...contributions].map(([point, rows]) => (
              <div key={point} className="contents">
                <dt className="font-mono text-faint-foreground">{point}</dt>
                <dd className="text-muted-foreground">
                  {rows.map(({ id, source }) => `${id} (${source})`).join(", ")}
                </dd>
              </div>
            ))}
            {seeds > 0 ? (
              <div className="contents">
                <dt className="font-mono text-faint-foreground">seed</dt>
                <dd className="text-muted-foreground">{seeds} nodes</dd>
              </div>
            ) : null}
          </dl>
        )}
        {services.length === 0 ? null : (
          <ul className="mt-1 text-meta text-muted-foreground">
            {services.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}
      </Disclosure>
    </>
  );
}

/** While the server's report is read, or why it could not be. */
export function ReportStatus({
  report,
  reread,
}: {
  readonly report: PanelReport | string | null;
  readonly reread: () => void;
}) {
  if (report === null) {
    return <p className="py-2 text-ui text-muted-foreground">Reading the extensions…</p>;
  }
  if (typeof report !== "string") return null;
  return (
    <div className="flex items-baseline gap-3 py-2">
      <p role="alert" className="text-ui text-destructive">
        {report}
      </p>
      <button
        type="button"
        className="text-meta text-muted-foreground hover:text-foreground"
        onClick={reread}
      >
        Ask again
      </button>
    </div>
  );
}
