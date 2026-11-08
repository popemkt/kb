/**
 * An extension as Settings' Extensions part draws it (DESIGN-UI.md →
 * Settings → Extensions): the status it leads with, where it came from, the
 * one action its state asks for and the rest behind a menu, and its
 * details, folded: what it adds in words, its code's digests and paths, the
 * services it injects and provides, and any source it hides.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { ExtensionReportRow } from "@kb/contracts";
import { installMarketplace } from "@kb/contracts";
import { extensionOutdatedDef, extensionUpdateDef } from "@kb/operations";
import { cn, MENU_ROW, MENU_SURFACE, MenuSeparator, useDismiss, useMenuKeys } from "@kb/ui-sdk";
import {
  CheckIcon,
  CopyIcon,
  DotsThreeIcon,
  LockSimpleIcon,
  ArrowSquareOutIcon,
} from "@phosphor-icons/react";
import {
  contributionGroups,
  extensionSourceLabel,
  extensionPower,
  extensionStatus,
  switchExtension,
  type ExtensionStatus,
  type PanelExtension,
  type PanelExtensionGroup,
} from "@/lib/extension-report";
import { BUTTON, PRIMARY_BUTTON, SCOPES, useExtensionAction } from "./extension-actions";
import { Disclosure } from "./settings-fold";

/**
 * Each status in words: the pill it leads with (none for one of kb's build
 * that is on), what its Details say when it adds nothing, and the review it
 * waits on, which leads its actions (any other status reviews from the menu).
 */
const STATUS: Readonly<
  Record<
    ExtensionStatus,
    { pill: { word: string; tone: string } | null; idle: string; review: string | null }
  >
> = {
  error: {
    pill: { word: "Error", tone: "bg-destructive/10 text-destructive" },
    idle: "nothing, while it fails to load",
    review: null,
  },
  update: {
    pill: { word: "Update available", tone: "bg-info/10 text-info" },
    idle: "nothing on this page or server",
    review: "Review update",
  },
  approval: {
    pill: { word: "Needs approval", tone: "bg-warning/10 text-warning" },
    idle: "nothing until you review and trust it",
    review: "Review & trust",
  },
  off: {
    pill: { word: "Off", tone: "bg-foreground/5 text-muted-foreground" },
    idle: "nothing while it is off",
    review: null,
  },
  trusted: {
    pill: { word: "Trusted", tone: "bg-success/10 text-success" },
    idle: "nothing on this page or server",
    review: null,
  },
  on: { pill: null, idle: "nothing on this page or server", review: null },
};

/** The status an extension leads with, as a pill; nothing for one of kb's build that is on. */
export function StatusPill({ status }: { readonly status: ExtensionStatus }) {
  const shown = STATUS[status].pill;
  if (shown === null) return null;
  return (
    <span
      data-extension-status={status}
      className={cn("rounded-full px-2 py-px text-label font-medium", shown.tone)}
    >
      {shown.word}
    </span>
  );
}

/** A required family's lock, saying why in its declaration's words. */
export function RequiredLock({ because }: { readonly because: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 text-label text-muted-foreground"
      title={because}
      data-extension-required
    >
      <LockSimpleIcon size={12} weight="bold" aria-hidden />
      Required
    </span>
  );
}

/** A 64-hex digest as its first twelve, with the whole one copied on request. */
function Digest({ value, label }: { readonly value: string; readonly label: string }) {
  const [copied, setCopied] = useState(false);
  const hex = value.slice(value.indexOf(":") + 1);
  return (
    <span className="inline-flex items-center gap-1">
      <code className="font-mono" title={value}>
        {hex.slice(0, 12)}…
      </code>
      <button
        type="button"
        aria-label={`Copy ${label}`}
        title={`Copy ${label}`}
        className="rounded-xs p-0.5 text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() =>
          void navigator.clipboard
            .writeText(value)
            .then(() => setCopied(true))
            .catch(() => setCopied(false))
        }
      >
        {copied ? <CheckIcon size={12} aria-hidden /> : <CopyIcon size={12} aria-hidden />}
      </button>
    </span>
  );
}

/** A pinned commit's short sha, linking to the tree it names on GitHub. */
function Pin({ repo, path, rev }: { repo: string; path: string; rev: string }) {
  const tree = `https://github.com/${repo}/tree/${rev}${path === "" ? "" : `/${path}`}`;
  return (
    <a
      href={tree}
      target="_blank"
      rel="noreferrer"
      title={rev}
      className="inline-flex items-center gap-0.5 font-mono text-foreground/80 underline-offset-2 hover:underline"
    >
      {rev.slice(0, 7)}
      <ArrowSquareOutIcon size={10} aria-hidden />
    </a>
  );
}

/**
 * Where an installed extension came from, in one line: the marketplace that
 * offered it, the GitHub path it is pinned to and the pin, and the lock that
 * holds the selection; a link or the store's own folder by its path.
 */
export function SourceLine({ row }: { readonly row: ExtensionReportRow }) {
  const { origin } = row;
  const parts: { readonly key: string; readonly node: ReactNode }[] = [];
  if (origin.kind === "install") {
    const { repo, path, rev } = origin.selection.locked;
    const market = installMarketplace(origin);
    if (market !== undefined) parts.push({ key: "market", node: `${market} marketplace` });
    parts.push(
      {
        key: "source",
        node: (
          <span className="break-all font-mono">
            github:{repo}
            {path === "" ? "" : `/${path}`}
          </span>
        ),
      },
      { key: "pin", node: <Pin repo={repo} path={path} rev={rev} /> },
      { key: "scope", node: SCOPES[origin.scope].label },
    );
  } else {
    parts.push(
      { key: "kind", node: extensionSourceLabel(row) },
      { key: "path", node: <span className="break-all font-mono">{row.source}</span> },
    );
  }
  return (
    <p
      className="flex flex-wrap items-baseline gap-x-1.5 text-caption text-muted-foreground"
      data-extension-source={row.name}
    >
      {parts.map(({ key, node }, at) => (
        <span key={key} className="inline-flex items-baseline gap-x-1.5">
          {at > 0 && (
            <span aria-hidden className="text-faint-foreground">
              ·
            </span>
          )}
          {node}
        </span>
      ))}
    </p>
  );
}

/** What an update or a check for one found, in words. */
function changeWords(
  changes: readonly { from: string; to: string; files: readonly string[]; trusted?: boolean }[],
  checking: boolean,
): string {
  if (changes.length === 0) return "Already up to date.";
  return changes
    .map((change) => {
      const span = `${change.from.slice(0, 7)} → ${change.to.slice(0, 7)}`;
      if (change.from === change.to) return `Already at ${change.to.slice(0, 7)}.`;
      const files = `${change.files.length} ${change.files.length === 1 ? "file" : "files"} changed`;
      return checking
        ? `Upstream moved ${span} (${files}). Choose Update to fetch it for review.`
        : `Updated ${span} (${files})${change.trusted === false ? "; review it to run it" : ""}.`;
    })
    .join(" ");
}

/** The confirmation Remove asks for, saying what goes and what stays. */
function RemoveConfirm({
  row,
  leaving,
  onRemove,
  onCancel,
}: {
  readonly row: ExtensionReportRow;
  readonly leaving: string;
  readonly onRemove: () => void;
  readonly onCancel: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      aria-labelledby={title}
      onCancel={onCancel}
      data-testid={`remove-${row.name}`}
      className="m-auto w-full max-w-md rounded-md border border-border bg-card p-5 text-card-foreground shadow-overlay"
    >
      <h3 id={title} className="text-title">
        Remove {row.label}?
      </h3>
      <ul className="mt-3 list-disc space-y-1 pl-5 text-ui text-muted-foreground">
        <li>{leaving}</li>
        <li>Its nodes stay, with everything you wrote on them.</li>
        <li>
          Its fetched code stays cached until <code className="font-mono">kb ext gc</code>, so you
          can install it again.
        </li>
      </ul>
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className={BUTTON} onClick={onCancel} autoFocus>
          Cancel
        </button>
        <button
          type="button"
          className={cn(BUTTON, "border-destructive/40 text-destructive hover:bg-destructive/10")}
          onClick={onRemove}
        >
          Remove
        </button>
      </div>
    </dialog>
  );
}

interface MenuItem {
  readonly label: string;
  readonly run: () => void;
  readonly danger?: boolean;
}

/** The rest of an extension's actions, behind one button. */
function OverflowMenu({
  name,
  groups,
}: {
  readonly name: string;
  readonly groups: readonly (readonly MenuItem[])[];
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const { ref, onKeyDown } = useMenuKeys();
  useDismiss(open, { inside: [ref], trigger }, () => setOpen(false));
  const shown = groups.filter((group) => group.length > 0);
  if (shown.length === 0) return null;
  return (
    <span className="relative">
      <button
        ref={trigger}
        type="button"
        aria-label={`More for ${name}`}
        title="More"
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex h-6 w-6 items-center justify-center rounded-sm text-muted-foreground hover:bg-foreground/5 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => setOpen((was) => !was)}
      >
        <DotsThreeIcon size={16} weight="bold" aria-hidden />
      </button>
      {open && (
        <div
          ref={ref}
          role="menu"
          aria-label={`More for ${name}`}
          className={cn(MENU_SURFACE, "absolute right-0 top-full mt-1 w-48")}
          onKeyDown={onKeyDown}
        >
          {shown.map((group, at) => (
            <div key={group[0]?.label} role="group">
              {at > 0 && <MenuSeparator />}
              {group.map((item, row) => (
                <button
                  key={item.label}
                  type="button"
                  role="menuitem"
                  // The menu opens with its first row focused, for the arrow keys.
                  autoFocus={at === 0 && row === 0}
                  className={cn(MENU_ROW, item.danger === true ? "text-destructive" : "")}
                  onClick={() => {
                    setOpen(false);
                    item.run();
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </span>
  );
}

/**
 * An extension's actions, by its state: the one its status asks for
 * (Review & trust, Review update, Turn on), and the rest in the menu:
 * reviewing a trusted digest, checking for and fetching an update, turning
 * it on or off, and removing it. Nothing here trusts: Review opens the sheet,
 * where only the person's click does.
 */
export function ExtensionActions({
  extension,
  onReview,
}: {
  readonly extension: PanelExtension;
  readonly onReview: () => void;
}) {
  const { row } = extension;
  const task = useExtensionAction();
  const [confirming, setConfirming] = useState(false);
  const status = extensionStatus(row);
  const scope = row.origin.kind === "install" ? row.origin.scope : null;
  const switchable = row.required === undefined;
  const waiting = STATUS[status].review;
  const review: MenuItem = { label: waiting ?? "Review code", run: onReview };
  // On or off is the row's, whatever its status leads with: one off with an update to review
  // still turns on, back to the approved digest; one no host has built has no switch to read.
  const on = switchable ? extensionPower(row) : null;
  const power: MenuItem | null =
    on === null
      ? null
      : on
        ? { label: "Turn off", run: () => void switchExtension(row.name, false) }
        : { label: "Turn on", run: () => void switchExtension(row.name, true) };
  // The one its status asks for: a review waiting, else turning an off one on; the menu holds the rest.
  const primary = waiting !== null ? review : status === "off" ? power : null;
  const reviews: MenuItem[] = row.digest !== undefined && primary !== review ? [review] : [];
  const lifecycle: MenuItem[] =
    scope === null
      ? []
      : [
          {
            label: "Check for updates",
            run: () =>
              void task.run(extensionOutdatedDef.id, { name: row.name }, (output) =>
                changeWords(extensionOutdatedDef.outputSchema.parse(output).extensions, true),
              ),
          },
          {
            label: "Update",
            run: () =>
              void task.run(extensionUpdateDef.id, { name: row.name, scope }, (output) =>
                changeWords(extensionUpdateDef.outputSchema.parse(output).updated, false),
              ),
          },
        ];
  const powers: MenuItem[] = power !== null && power !== primary ? [power] : [];
  const removal: MenuItem[] =
    scope === null ? [] : [{ label: "Remove…", run: () => setConfirming(true), danger: true }];
  return (
    <span className="flex items-center gap-1.5" data-extension-actions={row.name}>
      {primary !== null && (
        <button
          type="button"
          className={PRIMARY_BUTTON}
          disabled={task.pending}
          onClick={primary.run}
        >
          {primary.label}
        </button>
      )}
      <OverflowMenu name={row.label} groups={[reviews, lifecycle, powers, removal]} />
      {confirming && scope !== null && (
        <RemoveConfirm
          row={row}
          leaving={SCOPES[scope].leaving}
          onCancel={() => setConfirming(false)}
          onRemove={() => {
            setConfirming(false);
            void task.run("extension.remove", { name: row.name, scope });
          }}
        />
      )}
      <TaskLine task={task} />
    </span>
  );
}

/** What the last action said, or why it failed; below the heading, so it never crowds it. */
function TaskLine({ task }: { readonly task: ReturnType<typeof useExtensionAction> }) {
  if (task.notice === null && task.problem === null) return null;
  return (
    <span className="basis-full">
      {task.notice !== null && (
        <span role="status" className="block text-label text-muted-foreground">
          {task.notice}
        </span>
      )}
      {task.problem !== null && (
        <span role="alert" className="block text-label text-destructive">
          {task.problem}
        </span>
      )}
    </span>
  );
}

/** One row of the details: a word, then what it says. */
function Detail({ term, children }: { readonly term: string; readonly children: ReactNode }) {
  return (
    <div className="contents">
      <dt className="text-faint-foreground">{term}</dt>
      <dd className="min-w-0 text-muted-foreground">{children}</dd>
    </div>
  );
}

/**
 * Why its plugins failed, then its details, folded: what it adds, in words;
 * its code (digests to copy, where it is loaded from, what it is running
 * while an update waits); its services and tags; and any same-name source
 * the catalog hides.
 */
export function ExtensionDetails({
  nodeId,
  group,
  textOf,
}: {
  readonly nodeId: string;
  readonly group: PanelExtensionGroup;
  readonly textOf: (id: string) => string | undefined;
}) {
  const extension = group.effective;
  const row = extension?.row;
  const adds = extension === undefined ? [] : contributionGroups(extension, textOf);
  const services =
    row === undefined
      ? []
      : [
          ...row.injects.map(
            ({ service, from }) => `injects ${service} from ${from ?? "nobody yet"}`,
          ),
          ...row.provides.map((service) => `provides ${service}`),
        ];
  return (
    <>
      {row?.failures.map((failure) => (
        <p key={failure} role="alert" className="text-meta text-destructive">
          {failure}
        </p>
      ))}
      {row === undefined ? null : (
        <Disclosure id={`${nodeId}:details`} title="Details" level="inner" opensBy={false}>
          <dl
            className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1 text-meta"
            data-testid={`details-${row.name}`}
          >
            {adds.length === 0 ? (
              <Detail term="Adds">{STATUS[extensionStatus(row)].idle}</Detail>
            ) : (
              adds.map(({ kind, names }) => (
                <Detail key={kind} term={kind}>
                  {names.join(" · ")}
                </Detail>
              ))
            )}
            {row.digest !== undefined && (
              <Detail term="Bundle">
                <Digest value={row.digest} label="bundle digest" />
              </Detail>
            )}
            {row.files !== undefined && (
              <Detail term="File set">
                <Digest value={row.files} label="file set digest" />
              </Detail>
            )}
            {row.running !== undefined && (
              <Detail term="Running">
                <Digest value={row.running.digest} label="running digest" /> until the update is
                trusted
              </Detail>
            )}
            <Detail term="Loaded from">
              <span className="break-all font-mono text-caption">{row.source}</span>
            </Detail>
            {row.tags.length > 0 && <Detail term="Tags">{row.tags.join(", ")}</Detail>}
            {services.length > 0 && <Detail term="Services">{services.join("; ")}</Detail>}
          </dl>
        </Disclosure>
      )}
      {group.hidden.length === 0 ? null : (
        <Disclosure
          id={`${nodeId}:hidden`}
          title={`Hidden sources (${group.hidden.length})`}
          level="inner"
          opensBy={false}
        >
          <ul className="space-y-2 text-meta text-muted-foreground">
            {group.hidden.map((hidden) => (
              <li
                key={JSON.stringify([hidden.source, hidden.origin])}
                data-extension-hidden={hidden.name}
              >
                <p>
                  {extensionSourceLabel(hidden)} · hidden by {hidden.shadowed}
                </p>
                <p className="break-all font-mono text-caption">{hidden.source}</p>
                {hidden.digest === undefined ? null : (
                  <p>
                    {hidden.trusted === false ? "untrusted" : "trusted"} at{" "}
                    <Digest value={hidden.digest} label="hidden digest" />
                  </p>
                )}
              </li>
            ))}
          </ul>
        </Disclosure>
      )}
    </>
  );
}
