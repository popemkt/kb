/**
 * The Extensions panel (DESIGN-UI.md → Extensions panel): every extension
 * the host composes, as `extension.list` reports it with the page's half
 * joined in (`useExtensionReport`). Each one shows its switch, or that it
 * is required; whether kb's build carries it or a person trusted it, and at
 * which digest; its tags; what it contributed to each point, on the server
 * and in the page; what it injects and provides; which settings it has,
 * the fields of its node, which the Settings page draws; and why any of its
 * plugins failed. Above them are the points whose listeners are asked in
 * turn, each in that order, and the repository extensions refused.
 */
import { extensionNodeId, settingsOf } from "@kb/model";
import {
  type EnumOption,
  EnumSelect,
  type MatchedRoute,
  navigate,
  paramsOf,
  POPOVER_VALUE_CLASS,
  SETTINGS_PATH,
  SidebarRow,
  SidebarSection,
  useGraphRead,
} from "@kb/ui-sdk";
import { ExtensionsView } from "@kb/views";
import { PuzzlePieceIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import {
  EXTENSIONS_PATH,
  switchExtension,
  useExtensionReport,
  type PanelExtension,
  type PanelReport,
} from "@/lib/extension-report";

/** Off first: an optional extension is off until it is switched on. */
const SWITCH_OPTIONS: readonly EnumOption<"off" | "on">[] = [
  { value: "off", label: "off" },
  { value: "on", label: "on" },
];

/** The sidebar's way in. */
export function ExtensionsSection({ route }: { readonly route: MatchedRoute | null }) {
  return (
    <SidebarSection>
      <SidebarRow
        label="Extensions"
        icon={<PuzzlePieceIcon size={14} />}
        active={paramsOf(route, ExtensionsView) !== null}
        onClick={() => navigate(EXTENSIONS_PATH)}
      />
    </SidebarSection>
  );
}

export function ExtensionsPage() {
  const { report, reread } = useExtensionReport();
  return (
    <div className="mx-auto max-w-3xl px-4 py-6" data-testid="extensions-page">
      <h2 className="text-ui font-medium text-foreground/80">Extensions</h2>
      <p className="mt-0.5 mb-4 max-w-md text-meta text-foreground/40">
        What this kb composes: each extension&apos;s switch, trust, contributions and settings, and
        the listeners asked in turn. Its settings are chosen in Settings.
      </p>
      {report === null ? (
        <p className="text-ui text-foreground/40">Reading the extensions…</p>
      ) : typeof report === "string" ? (
        <div className="flex items-baseline gap-3">
          <p role="alert" className="text-ui text-destructive">
            {report}
          </p>
          <button
            type="button"
            className="text-meta text-foreground/50 hover:text-foreground/80"
            onClick={reread}
          >
            Ask again
          </button>
        </div>
      ) : (
        <Report report={report} />
      )}
    </div>
  );
}

function Report({ report }: { readonly report: PanelReport }) {
  return (
    <div className="flex flex-col gap-6">
      {report.points.length > 0 ? (
        <Section label="asked in turn">
          {report.points.map(({ point, source, listeners }) => (
            <div
              key={`${source} ${point}`}
              className="py-1"
              data-testid={`point-${source}-${point}`}
            >
              <div className="text-meta text-foreground/60">
                <span className="font-mono">{point}</span>
                <span className="text-foreground/30"> · {source}</span>
              </div>
              <ol className="list-decimal pl-6 text-meta text-foreground/50">
                {listeners.map(({ owner, id, match }) => (
                  <li key={`${owner} ${id}`}>
                    <span className="font-mono">{id}</span>
                    <span className="text-foreground/30">
                      {" "}
                      ({owner}){match === undefined ? "" : ` on ${match}`}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </Section>
      ) : null}
      {report.failures.length > 0 ? (
        <Section label="refused">
          {report.failures.map(({ file, error }) => (
            <p
              key={file}
              className="py-1 text-meta text-destructive"
              data-testid={`refused-${file}`}
            >
              <span className="font-mono">{file}</span>: {error}
            </p>
          ))}
        </Section>
      ) : null}
      <Section label="extensions">
        {report.extensions.map((extension) => (
          <ExtensionCard key={extension.row.name} extension={extension} />
        ))}
      </Section>
    </div>
  );
}

function Section({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <section aria-label={label}>
      <h3 className="pb-1 text-meta kb-label text-foreground/30">{label}</h3>
      {children}
    </section>
  );
}

/** Whether kb's build carries it, the `kb ui` host composes it, or a person trusted it at a digest. */
function trustOf({ source, digest }: PanelExtension["row"]): string {
  if (source === "bundled") return "part of kb's build";
  if (source === "host") return "composed by kb ui";
  return digest === undefined ? `from ${source}` : `trusted at ${digest} · ${source}`;
}

function ExtensionCard({ extension }: { readonly extension: PanelExtension }) {
  const { row, contributions, seeds } = extension;
  return (
    <article
      aria-label={row.label}
      data-testid={`extension-${row.name}`}
      className="border-b border-foreground/5 py-3"
    >
      <div className="flex items-center gap-2">
        <span className="text-ui text-foreground/80">{row.label}</span>
        <span className="font-mono text-caption text-foreground/30">{row.name}</span>
        <span className="flex-1" />
        {row.optional ? (
          <EnumSelect
            className={`${POPOVER_VALUE_CLASS} max-w-16 flex-none`}
            value={row.enabled ? "on" : "off"}
            options={SWITCH_OPTIONS}
            testId={`switch-${row.name}`}
            onChange={(next) => void switchExtension(row.name, next === "on")}
          />
        ) : (
          <span className="text-meta text-foreground/40">required</span>
        )}
      </div>
      <div className="text-meta text-foreground/40" data-testid={`trust-${row.name}`}>
        {trustOf(row)}
        {row.tags.length > 0 ? ` · tags: ${row.tags.join(", ")}` : ""}
      </div>
      {row.enabled ? null : (
        <div className="text-meta text-foreground/30">off: contributes nothing</div>
      )}
      <Contributions contributions={contributions} seeds={seeds} />
      <Lines
        lines={[
          ...row.injects.map(
            ({ service, from }) => `injects ${service} from ${from ?? "nobody yet"}`,
          ),
          ...row.provides.map((service) => `provides ${service}`),
        ]}
      />
      <Settings family={row.name} />
      {row.failures.map((failure) => (
        <p key={failure} role="alert" className="text-meta text-destructive">
          {failure}
        </p>
      ))}
    </article>
  );
}

function Contributions({ contributions, seeds }: Pick<PanelExtension, "contributions" | "seeds">) {
  if (contributions.size === 0 && seeds === 0) return null;
  return (
    <dl className="mt-1 grid grid-cols-[max-content_1fr] gap-x-3 text-meta">
      {[...contributions].map(([point, rows]) => (
        <div key={point} className="contents">
          <dt className="font-mono text-foreground/45">{point}</dt>
          <dd className="text-foreground/55">
            {rows.map(({ id, source }) => `${id} (${source})`).join(", ")}
          </dd>
        </div>
      ))}
      {seeds > 0 ? (
        <div className="contents">
          <dt className="font-mono text-foreground/45">seed</dt>
          <dd className="text-foreground/55">{seeds} nodes</dd>
        </div>
      ) : null}
    </dl>
  );
}

function Lines({ lines }: { readonly lines: readonly string[] }) {
  if (lines.length === 0) return null;
  return (
    <ul className="mt-1 text-meta text-foreground/45">
      {lines.map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ul>
  );
}

/**
 * Where a family's settings are: how many `settingsOf` reads for its node
 * (the switch left out: the card draws it as its own control), and the way
 * to the Settings page, which draws them. The panel reports what a family
 * is and contributes; choosing among its settings is the Settings page's.
 */
function Settings({ family }: { readonly family: string }) {
  const graph = useGraphRead();
  const nodeId = extensionNodeId(family);
  if (graph.schema.get(nodeId) === undefined) return null;
  const settings = settingsOf(graph.schema.values(), (id) => graph.schema.get(id), nodeId);
  if (settings.length === 0) return null;
  return (
    <p className="mt-1 text-meta text-muted-foreground" aria-label={`${family} settings`}>
      {settings.map(({ label }) => label).join(", ")} ·{" "}
      <button
        type="button"
        className="text-foreground underline-offset-2 hover:underline"
        onClick={() => navigate(SETTINGS_PATH)}
      >
        in Settings
      </button>
    </p>
  );
}
