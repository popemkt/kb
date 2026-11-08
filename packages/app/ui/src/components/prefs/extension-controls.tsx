/** Settings operates on the catalog's effective source; approval belongs to ActionApproval. */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { ActionInvocation, ExtensionReportRow, ExtensionScope } from "@kb/contracts";
import { DEFAULT_EXTENSION_SCOPE } from "@kb/contracts";
import type { marketplaceListDef } from "@kb/operations";
import { ActionApproval, EnumSelect, latestRead } from "@kb/ui-sdk";
import { extensionNodeId } from "@kb/model";
import { usePrefsStore } from "@/stores/prefs.store";
import { subscribeManifest } from "@/lib/manifest";
import { changeExtensions } from "@/actions/extensions";
import { readMarketplaces } from "@/lib/extension-report";

const BUTTON =
  "rounded-sm border border-border px-2 py-1 text-label hover:bg-foreground/5 disabled:opacity-40";
const SCOPE_OPTIONS = [
  { value: "store", label: "Store (committed)" },
  { value: "local", label: "This root (private)" },
  { value: "user", label: "All stores (user)" },
] as const;
const NO_PENDING: readonly string[] = [];
const INPUT = "w-full rounded-sm border border-border bg-background px-2 py-1 text-ui";

/** One mutation/error lifetime shared by the install and row controls. */
function useExtensionAction() {
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  function run(id: string, input: Record<string, unknown>, onComplete?: () => void) {
    setPending(true);
    setProblem(null);
    setNotice(null);
    return changeExtensions(id, input)
      .then((message) => {
        setNotice(message);
        return onComplete?.();
      })
      .catch((error: unknown) => {
        setProblem(error instanceof Error ? error.message : String(error));
      })
      .finally(() => setPending(false));
  }
  return { pending, problem, notice, run };
}

function ReviewSheet({
  row,
  close,
}: {
  readonly row: ExtensionReportRow;
  readonly close: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();
  const invocation = useMemo<ActionInvocation>(
    () => ({
      id: "sandbox.trust",
      actor: "human",
      input: {
        digest: row.digest,
        ...(row.origin.kind === "install"
          ? { extension: { name: row.name, files: row.files } }
          : {}),
      },
    }),
    [row],
  );
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  function answer(approved: boolean) {
    if (!approved) return Promise.resolve(close());
    return changeExtensions(invocation.id, invocation.input).then(close);
  }
  return (
    <dialog
      ref={dialog}
      aria-labelledby={title}
      onCancel={close}
      className="m-auto max-h-[85vh] w-full max-w-3xl overflow-auto rounded-md border border-border bg-card p-5 text-foreground"
    >
      <h3 id={title} className="text-title">
        Review &amp; trust
      </h3>
      <ActionApproval invocation={invocation} answer={answer} />
    </dialog>
  );
}

export function ExtensionControls({ row }: { readonly row: ExtensionReportRow }) {
  const [review, setReview] = useState(false);
  const task = useExtensionAction();
  if (row.digest === undefined) return null;
  const scope = row.origin.kind === "install" ? row.origin.scope : null;
  return (
    <div
      className="my-2 space-y-2"
      data-extension-state={
        row.running !== undefined && row.trusted === false
          ? "pending-update"
          : row.trusted === false
            ? "untrusted"
            : "trusted"
      }
    >
      <p className="text-meta font-medium">
        {row.trusted === false
          ? row.running === undefined
            ? "Untrusted"
            : "Pending update · untrusted"
          : "Trusted"}
      </p>
      <p className="break-all font-mono text-caption">Selected: {row.digest}</p>
      {row.running !== undefined && (
        <p className="break-all font-mono text-caption">Running: {row.running.digest}</p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={BUTTON} onClick={() => setReview(true)}>
          {row.trusted === false ? "Review & trust" : "Review"}
        </button>
        {scope !== null && (
          <>
            <button
              type="button"
              className={BUTTON}
              disabled={task.pending}
              onClick={() => void task.run("extension.update", { name: row.name, scope })}
            >
              Update
            </button>
            <button
              type="button"
              className={BUTTON}
              disabled={task.pending}
              onClick={() => void task.run("extension.remove", { name: row.name, scope })}
            >
              Remove
            </button>
          </>
        )}
      </div>
      {task.notice !== null && (
        <p role="status" className="text-label text-foreground/60">
          {task.notice}
        </p>
      )}
      {task.problem !== null && (
        <p role="alert" className="text-label text-destructive">
          {task.problem}
        </p>
      )}
      {review && <ReviewSheet row={row} close={() => setReview(false)} />}
    </div>
  );
}

type Markets = ReturnType<typeof marketplaceListDef.outputSchema.parse>["marketplaces"];
function useMarketplaces() {
  const [markets, setMarkets] = useState<Markets>([]);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    const read = latestRead(
      () =>
        readMarketplaces()
          .then((catalog) => ({ markets: catalog, problem: null }))
          .catch((error: unknown) => ({
            markets: [],
            problem: error instanceof Error ? error.message : String(error),
          })),
      (next) => {
        if (live) {
          setMarkets(next.markets);
          setProblem(next.problem);
        }
      },
    );
    void read();
    const unsubscribe = subscribeManifest(() => void read());
    return () => {
      live = false;
      unsubscribe();
    };
  }, []);
  return { markets, problem };
}

function InstallForm({
  kind,
  onComplete,
}: {
  readonly kind: "extension" | "marketplace";
  readonly onComplete: () => void;
}) {
  const source = useRef<HTMLInputElement>(null);
  const [scope, setScope] = useState<ExtensionScope>(DEFAULT_EXTENSION_SCOPE);
  const task = useExtensionAction();
  const title = kind === "extension" ? "Add from GitHub" : "Add marketplace";
  return (
    <form
      className="my-3 space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        void task.run(
          kind === "extension" ? "extension.install" : "extension.marketplace.add",
          { source: source.current?.value.trim() ?? "", scope },
          onComplete,
        );
      }}
    >
      <label className="block text-label">
        {title}
        <input
          required
          aria-label={`${title} source`}
          className={INPUT}
          placeholder="github:owner/repo/path@ref"
          ref={source}
        />
      </label>
      <label className="block text-label">
        Scope
        <EnumSelect className={INPUT} value={scope} options={SCOPE_OPTIONS} onChange={setScope} />
      </label>
      <div className="flex gap-2">
        <button type="submit" className={BUTTON} disabled={task.pending}>
          {task.pending ? "Adding…" : title}
        </button>
        <button type="button" className={BUTTON} onClick={onComplete}>
          Cancel
        </button>
      </div>
      {task.problem !== null && (
        <p role="alert" className="text-label text-destructive">
          {task.problem}
        </p>
      )}
    </form>
  );
}

export function ExtensionAdd({ awaiting = NO_PENDING }: { readonly awaiting?: readonly string[] }) {
  const setFold = usePrefsStore((state) => state.setSettingsFold);
  const [form, setForm] = useState<"extension" | "marketplace" | null>(null);
  const { markets, problem } = useMarketplaces();
  const task = useExtensionAction();

  return (
    <section aria-label="Add extensions" className="mb-4 space-y-2">
      {awaiting.length > 0 && (
        <p className="text-label">
          {awaiting.length} extensions await review:{" "}
          {awaiting.map((name) => (
            <a
              key={name}
              className="mr-2 underline"
              href={`#extension-review-${name}`}
              onClick={() => setFold(extensionNodeId(name), true)}
            >
              {name}
            </a>
          ))}
        </p>
      )}

      <div className="flex gap-2">
        <button type="button" className={BUTTON} onClick={() => setForm("extension")}>
          Add from GitHub
        </button>
        <button type="button" className={BUTTON} onClick={() => setForm("marketplace")}>
          Add marketplace
        </button>
      </div>
      {form !== null && <InstallForm key={form} kind={form} onComplete={() => setForm(null)} />}
      <details>
        <summary className="cursor-pointer text-label">Pick from a marketplace</summary>
        <p className="text-meta text-muted-foreground">
          Marketplace installs use{" "}
          {SCOPE_OPTIONS.find((option) => option.value === DEFAULT_EXTENSION_SCOPE)?.label} scope.
        </p>
        {markets.length === 0 && (
          <p className="text-meta text-muted-foreground">
            Add a marketplace to browse its pinned entries.
          </p>
        )}
        {markets.map((market) => (
          <div key={`${market.scope}:${market.name}`} className="my-2 space-y-2">
            <p className="text-meta">
              {market.name} · {market.scope}
            </p>
            {market.error !== undefined && <p role="alert">{market.error}</p>}
            {market.entries.map((entry) => (
              <div key={entry.name} className="flex items-center justify-between gap-2 text-label">
                <span>
                  {entry.name} · {entry.description}
                </span>
                <button
                  type="button"
                  className={BUTTON}
                  disabled={task.pending}
                  onClick={() =>
                    void task.run("extension.install", {
                      source: `${entry.name}@${market.name}`,
                      scope: DEFAULT_EXTENSION_SCOPE,
                    })
                  }
                >
                  Install {entry.name}
                </button>
              </div>
            ))}
          </div>
        ))}
      </details>
      {problem !== null && (
        <p role="alert" className="text-label text-destructive">
          {problem}
        </p>
      )}
      {task.problem !== null && (
        <p role="alert" className="text-label text-destructive">
          {task.problem}
        </p>
      )}
    </section>
  );
}

/** Retained graph nodes remain useful after their source selection is removed. */
export function RetainedExtension({ name }: { readonly name: string }) {
  const { markets, problem } = useMarketplaces();
  const task = useExtensionAction();
  return (
    <div className="my-2 space-y-2 text-label">
      <p>Not installed. Its nodes remain.</p>
      {markets.flatMap((market) =>
        market.entries
          .filter((entry) => entry.name === name)
          .map((entry) => (
            <button
              key={`${market.name}:${market.scope}`}
              type="button"
              className={BUTTON}
              disabled={task.pending}
              onClick={() =>
                void task.run("extension.install", {
                  source: `${entry.name}@${market.name}`,
                  scope: DEFAULT_EXTENSION_SCOPE,
                })
              }
            >
              Install {name} from {market.name} ({DEFAULT_EXTENSION_SCOPE})
            </button>
          )),
      )}
      {problem !== null && <p role="alert">{problem}</p>}
      {task.problem !== null && <p role="alert">{task.problem}</p>}
    </div>
  );
}
