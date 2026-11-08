/** The pinned extension evidence shared by every approval surface. */
import type { ExtensionReportRow } from "@kb/contracts";
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
                  className={`whitespace-pre-wrap break-all ${
                    part.added ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"
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
      <p className="text-foreground/70">
        This code runs with your account's access and may be attached in any store on this machine.
        Only trust code you have reviewed.
      </p>
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
