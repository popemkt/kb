/** The pinned extension evidence shared by every approval surface, and what an extension says about itself. */
import { capabilityLines, type ExtensionManifest, type ExtensionReportRow } from "@kb/contracts";
import { DEFAULT_REPLACEMENT_PRIORITY } from "@kb/plugin";
import { extensionSourceLabel } from "@/lib/extension-report";
import type { ExtensionLineDiff } from "@/lib/extension-line-diff";

function SourceChanges({ diff }: { readonly diff: ExtensionLineDiff }) {
  return (
    <div className="space-y-2">
      <p className="break-all text-label text-foreground/60">
        {diff.from === null ? "First approval" : `Baseline ${diff.from}`} · {diff.files.length}{" "}
        {diff.files.length === 1 ? "file" : "files"} changed · +{diff.added} −{diff.removed}
      </p>
      {diff.files.length === 0 && (
        <p className="text-label text-foreground/60">No source changes.</p>
      )}
      {diff.files.map((file) => (
        <details key={file.path} className="rounded-sm border border-foreground/10">
          <summary className="cursor-pointer p-2 font-mono text-label">
            {file.path} · +{file.added} −{file.removed}
            {file.fromMode !== file.toMode && (
              <>
                {" "}
                · {file.fromMode ?? "absent"} → {file.toMode ?? "absent"}
              </>
            )}
          </summary>
          <div className="max-h-80 overflow-auto bg-background p-2 font-mono text-caption">
            {file.parts.map((part) =>
              part.added || part.removed ? (
                <pre
                  key={part.at}
                  data-diff={part.added ? "added" : "removed"}
                  // The text colour on the change's tint: the sign and the tint say which.
                  className={`whitespace-pre-wrap break-all text-foreground ${
                    part.added ? "bg-success/10" : "bg-destructive/10"
                  }`}
                >
                  {part.value
                    .split(/(?<=\n)/)
                    .map((line) => `${part.added ? "+" : "-"} ${line}`)
                    .join("")}
                </pre>
              ) : (
                <details key={part.at}>
                  <summary className="cursor-pointer text-foreground/60">
                    {part.count} unchanged lines
                  </summary>
                  <pre className="whitespace-pre-wrap break-all">{part.value}</pre>
                </details>
              ),
            )}
          </div>
        </details>
      ))}
    </div>
  );
}

/** One fact an extension states: its value, a link where it is one, or "not declared". */
function Stated({ value, link }: { readonly value: string | undefined; readonly link?: boolean }) {
  if (value === undefined) return <dd className="text-faint-foreground">not declared</dd>;
  return (
    <dd className="min-w-0 break-all">
      {link === true ? (
        <a className="underline underline-offset-2" href={value} target="_blank" rel="noreferrer">
          {value.replace(/^https:\/\//, "")}
        </a>
      ) : (
        value
      )}
    </dd>
  );
}

/** An extension's term list: one label column wide enough for every term, so lists stacked on a card align. */
export const TERM_LIST = "grid grid-cols-[7rem_minmax(0,1fr)] gap-x-4 gap-y-1";

/**
 * What an extension says about itself (its manifest, docs/extensions/README.md):
 * who wrote it, its licence, where it lives, then each capability in plain
 * words, every one it leaves out as "not declared". The same on the review
 * sheet and in a card's Details.
 */
export function ExtensionAbout({ manifest }: { readonly manifest: ExtensionManifest | undefined }) {
  return (
    <dl className={TERM_LIST} data-extension-about>
      <dt className="text-foreground/60">Author</dt>
      <Stated value={manifest?.author} />
      <dt className="text-foreground/60">License</dt>
      <Stated value={manifest?.license} />
      <dt className="text-foreground/60">Homepage</dt>
      <Stated value={manifest?.homepage} link />
      <dt className="text-foreground/60">Repository</dt>
      <Stated value={manifest?.repository} link />
      {(manifest?.replaces ?? []).map(({ role, priority, why }) => (
        <div key={role} className="contents" data-replacement-role={role}>
          <dt className="text-foreground/60">Replaces</dt>
          <dd>
            {role} · priority {priority ?? DEFAULT_REPLACEMENT_PRIORITY} · {why}
          </dd>
        </div>
      ))}
      <dt className="col-span-2 mt-1 font-medium text-foreground/80">What it says it reaches</dt>
      {capabilityLines(manifest).map(({ label, text, said }) => (
        <div key={label} className="contents" data-capability={label} data-said={said}>
          <dt className="text-foreground/60">{label}</dt>
          <dd className={said ? "min-w-0" : "text-faint-foreground"}>{text}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ExtensionEvidence({
  row,
  diff,
}: {
  readonly row: ExtensionReportRow;
  readonly diff: ExtensionLineDiff | null;
}) {
  const pin = row.origin.kind === "install" ? row.origin.selection.locked : null;
  return (
    <div className="mt-2 space-y-3 text-label">
      <p className="text-ui font-medium">Review {row.label}</p>
      {row.manifest?.description !== undefined && (
        <p className="text-foreground/80">{row.manifest.description}</p>
      )}
      <p className="text-foreground/70">
        This code runs with your account's access and may be attached in any store on this machine.
        Only trust code you have reviewed.
      </p>
      <ExtensionAbout manifest={row.manifest} />
      {row.reach?.page === true && (
        <p className="text-foreground/70">
          Its page half runs in the page with the page's full power today, whatever page tier it
          declares: what it says it reaches is its author's word, not a boundary.
        </p>
      )}
      <dl className="space-y-1">
        <dt className="text-foreground/60">Source · {extensionSourceLabel(row)}</dt>
        <dd className="break-all font-mono">{row.source}</dd>
        {pin !== null && (
          <>
            <dt className="text-foreground/60">GitHub pin</dt>
            <dd className="break-all font-mono">
              {pin.repo}/{pin.path}@{pin.rev}
            </dd>
          </>
        )}
        <dt className="text-foreground/60">Bundle digest</dt>
        <dd className="break-all font-mono">{row.digest}</dd>
        {row.files !== undefined && (
          <>
            <dt className="text-foreground/60">File set digest</dt>
            <dd className="break-all font-mono">{row.files}</dd>
          </>
        )}
      </dl>
      {row.running !== undefined && (
        <p className="break-all text-foreground/60">
          Currently running approved digest: <code>{row.running.digest}</code>
        </p>
      )}
      {row.reach === undefined ? (
        <p>Static reach information is unavailable.</p>
      ) : (
        <details>
          <summary className="cursor-pointer">Files and static reach</summary>
          <ul className="mt-2 space-y-1 font-mono text-caption">
            {row.reach.files.map((file) => (
              <li key={file.path}>
                {file.path} · {file.bytes} bytes
              </li>
            ))}
          </ul>
          <p className="mt-2">Page half: {row.reach.page ? "yes" : "no"}</p>
          <p className="break-all">
            Host modules (server): {row.reach.host.server.join(", ") || "none declared"}
          </p>
          <p className="break-all">
            Host modules (page): {row.reach.host.page.join(", ") || "none declared"}
          </p>
          <p className="break-all">
            Node builtins: {row.reach.builtins.join(", ") || "none found"}
          </p>
          <p className="mt-2 text-foreground/60">
            Static reach describes imports; it does not restrict what trusted code can do.
          </p>
        </details>
      )}
      {diff === null ? (
        <p className="text-foreground/60">
          Review this local folder in your editor. Linked and own folders do not have a cached
          source diff.
        </p>
      ) : (
        <SourceChanges diff={diff} />
      )}
    </div>
  );
}
