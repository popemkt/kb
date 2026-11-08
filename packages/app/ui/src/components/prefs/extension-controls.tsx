/**
 * Settings' extension controls (DESIGN-UI.md → Settings → Extensions): the
 * review sheet, where the person's click is the only thing that trusts; the
 * one way to add an extension, by browsing the pinned marketplaces or
 * pasting a GitHub source; the line that names what awaits review; and the
 * card of an extension whose selection was removed while its nodes stay.
 * Approval itself belongs to `ActionApproval`.
 */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { ActionInvocation, ExtensionReportRow, ExtensionScope } from "@kb/contracts";
import { DEFAULT_EXTENSION_SCOPE } from "@kb/contracts";
import { ActionApproval, cn, EnumSelect } from "@kb/ui-sdk";
import { extensionNodeId } from "@kb/model";
import { PlusIcon } from "@phosphor-icons/react";
import { usePrefsStore } from "@/stores/prefs.store";
import { changeExtensions } from "@/actions/extensions";
import type { MarketplaceReading } from "@/lib/extension-report";
import {
  BUTTON,
  PRIMARY_BUTTON,
  SCOPE_OPTIONS,
  SCOPES,
  useExtensionAction,
} from "./extension-actions";

const INPUT =
  "w-full rounded-sm border border-border bg-background px-2 py-1 text-ui text-foreground placeholder:text-faint-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const NO_NAMES: readonly string[] = [];

/** The sheet a person trusts an extension's exact selection in; Decline closes it and trusts nothing. */
export function ReviewSheet({
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

/** The scope a control writes, chosen once beside it. */
function ScopeSelect({
  value,
  onChange,
}: {
  readonly value: ExtensionScope;
  readonly onChange: (scope: ExtensionScope) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-label text-muted-foreground">
      Install into
      <EnumSelect
        className={cn(INPUT, "w-auto py-0.5 text-label")}
        value={value}
        options={SCOPE_OPTIONS}
        onChange={onChange}
        testId="extension-scope"
      />
    </label>
  );
}

/** A GitHub source, pasted: an extension to install, or a marketplace to add. */
function SourceForm({
  kind,
  scope,
  onDone,
}: {
  readonly kind: "extension" | "marketplace";
  readonly scope: ExtensionScope;
  readonly onDone?: () => void;
}) {
  const source = useRef<HTMLInputElement>(null);
  const task = useExtensionAction();
  const title = kind === "extension" ? "Add from GitHub" : "Add marketplace";
  return (
    <form
      className="space-y-1.5"
      onSubmit={(event) => {
        event.preventDefault();
        void task.run(
          kind === "extension" ? "extension.install" : "extension.marketplace.add",
          { source: source.current?.value.trim() ?? "", scope },
          () =>
            kind === "extension"
              ? "Installed. Review it below to run it."
              : "Marketplace added: its entries are listed above.",
          () => {
            if (source.current !== null) source.current.value = "";
            onDone?.();
          },
        );
      }}
    >
      <div className="flex gap-2">
        <input
          required
          aria-label={`${title} source`}
          className={INPUT}
          placeholder={
            kind === "extension"
              ? "github:owner/repo/path@ref"
              : "github:owner/repo — a repository with kb-marketplace.json"
          }
          ref={source}
        />
        <button type="submit" className={cn(BUTTON, "flex-none")} disabled={task.pending}>
          {task.pending ? "Adding…" : kind === "extension" ? "Install" : "Add"}
        </button>
      </div>
      {task.notice !== null && (
        <p role="status" className="text-label text-muted-foreground">
          {task.notice}
        </p>
      )}
      {task.problem !== null && (
        <p role="alert" className="text-label text-destructive">
          {task.problem}
        </p>
      )}
    </form>
  );
}

/** One marketplace entry: its name and line, and Install, or that it is installed already. */
function MarketEntry({
  name,
  description,
  market,
  installed,
  scope,
}: {
  readonly name: string;
  readonly description: string | undefined;
  readonly market: string;
  readonly installed: boolean;
  readonly scope: ExtensionScope;
}) {
  const task = useExtensionAction();
  return (
    <li className="flex items-start gap-3 py-2" data-market-entry={name}>
      <div className="min-w-0 flex-1">
        <p className="text-ui font-medium text-foreground">{name}</p>
        {description !== undefined && (
          <p className="text-meta text-muted-foreground">{description}</p>
        )}
        {task.problem !== null && (
          <p role="alert" className="text-label text-destructive">
            {task.problem}
          </p>
        )}
      </div>
      {installed ? (
        <span className="pt-0.5 text-label text-muted-foreground">Installed</span>
      ) : (
        <button
          type="button"
          className={BUTTON}
          disabled={task.pending}
          aria-label={`Install ${name} from ${market}`}
          onClick={() => void task.run("extension.install", { source: `${name}@${market}`, scope })}
        >
          {task.pending ? "Installing…" : "Install"}
        </button>
      )}
    </li>
  );
}

/**
 * The one way to add an extension: Browse lists every pinned marketplace's
 * entries with Install, and adds a marketplace; From GitHub installs a
 * pasted source. Both write the scope chosen beside them, and nothing they
 * do trusts: an installed extension waits for review.
 */
function AddPanel({
  markets,
  installed,
}: {
  readonly markets: MarketplaceReading;
  readonly installed: readonly string[];
}) {
  const [tab, setTab] = useState<"browse" | "github">("browse");
  const [scope, setScope] = useState<ExtensionScope>(DEFAULT_EXTENSION_SCOPE);
  const [adding, setAdding] = useState(false);
  const tabs = [
    { id: "browse", label: "Browse marketplaces" },
    { id: "github", label: "From GitHub" },
  ] as const;
  return (
    <div
      className="mt-2 space-y-3 rounded-md border border-border bg-card p-3 text-card-foreground"
      data-testid="extension-add"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="tablist" aria-label="Add from" className="flex gap-1">
          {tabs.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className="rounded-sm px-2 py-1 text-label text-muted-foreground hover:text-foreground aria-selected:bg-foreground/8 aria-selected:text-foreground"
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <ScopeSelect value={scope} onChange={setScope} />
      </div>
      <p className="text-meta text-muted-foreground">
        Installing fetches the code and pins it to one commit. Nothing runs until you review it and
        trust it.
      </p>
      {tab === "github" ? (
        <SourceForm kind="extension" scope={scope} />
      ) : (
        <div className="space-y-3">
          {markets.problem !== null && (
            <p role="alert" className="text-label text-destructive">
              {markets.problem}
            </p>
          )}
          {markets.markets.length === 0 && markets.problem === null && (
            <p className="text-meta text-muted-foreground">
              No marketplaces yet. A marketplace is a GitHub repository with a{" "}
              <code className="font-mono">kb-marketplace.json</code> index; add one to browse it.
            </p>
          )}
          {markets.markets.map((market) => {
            const { repo, rev } = market.selection.locked;
            return (
              <section
                key={`${market.scope}:${market.name}`}
                aria-label={`${market.name} marketplace`}
              >
                <h4 className="flex flex-wrap items-baseline gap-x-2 text-meta">
                  <span className="kb-label text-muted-foreground">{market.name}</span>
                  <span className="font-mono text-caption text-faint-foreground">
                    {repo} @ {rev.slice(0, 7)} · {SCOPES[market.scope].label.toLowerCase()}
                  </span>
                </h4>
                {market.error !== undefined && (
                  <p role="alert" className="text-label text-destructive">
                    {market.error}
                  </p>
                )}
                <ul className="divide-y divide-border">
                  {market.entries.map((entry) => (
                    <MarketEntry
                      key={entry.name}
                      name={entry.name}
                      description={entry.description}
                      market={market.name}
                      installed={installed.includes(entry.name)}
                      scope={scope}
                    />
                  ))}
                </ul>
              </section>
            );
          })}
          {adding || markets.markets.length === 0 ? (
            <SourceForm kind="marketplace" scope={scope} onDone={() => setAdding(false)} />
          ) : (
            <button
              type="button"
              className="text-label text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              onClick={() => setAdding(true)}
            >
              Add a marketplace…
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The top of the Extensions part: what awaits review, each a link to its
 * card, and the one Add extension entry point.
 */
export function ExtensionAdd({
  awaiting = NO_NAMES,
  installed = NO_NAMES,
  markets,
}: {
  readonly awaiting?: readonly string[];
  readonly installed?: readonly string[];
  readonly markets: MarketplaceReading;
}) {
  const setFold = usePrefsStore((state) => state.setSettingsFold);
  const [open, setOpen] = useState(false);
  return (
    <section aria-label="Add extensions" className="mb-2">
      {awaiting.length > 0 && (
        <p
          className="mb-2 rounded-md bg-warning/10 px-3 py-2 text-label text-warning"
          data-testid="extensions-awaiting"
        >
          {awaiting.length === 1 ? "1 extension awaits" : `${awaiting.length} extensions await`}{" "}
          your review:{" "}
          {awaiting.map((name, at) => (
            <span key={name}>
              {at > 0 && ", "}
              <a
                className="font-medium underline underline-offset-2"
                href={`#extension-review-${name}`}
                onClick={() => setFold(extensionNodeId(name), true)}
              >
                {name}
              </a>
            </span>
          ))}
        </p>
      )}
      <button
        type="button"
        className={PRIMARY_BUTTON}
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
      >
        <PlusIcon size={12} weight="bold" aria-hidden />
        Add extension
      </button>
      {open && <AddPanel markets={markets} installed={installed} />}
    </section>
  );
}

/** An extension whose selection was removed: its nodes stay, and a marketplace that lists it offers it again. */
export function RetainedExtension({
  name,
  markets,
}: {
  readonly name: string;
  readonly markets: MarketplaceReading;
}) {
  const task = useExtensionAction();
  const offers = markets.markets.flatMap((market) =>
    market.entries.some((entry) => entry.name === name) ? [market] : [],
  );
  return (
    <div className="space-y-2 pb-2 text-meta text-muted-foreground">
      <p>Not installed. Its nodes remain, and install brings it back.</p>
      <div className="flex flex-wrap gap-2">
        {offers.map((market) => (
          <button
            key={`${market.name}:${market.scope}`}
            type="button"
            className={BUTTON}
            aria-label={`Install ${name} from ${market.name}`}
            title={`Into the ${SCOPES[DEFAULT_EXTENSION_SCOPE].label.toLowerCase()}`}
            disabled={task.pending}
            onClick={() =>
              void task.run("extension.install", {
                source: `${name}@${market.name}`,
                scope: DEFAULT_EXTENSION_SCOPE,
              })
            }
          >
            Install from {market.name}
          </button>
        ))}
      </div>
      {task.problem !== null && (
        <p role="alert" className="text-label text-destructive">
          {task.problem}
        </p>
      )}
    </div>
  );
}
