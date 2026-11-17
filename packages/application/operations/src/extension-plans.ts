import { Effect } from "effect";
import {
  SourceReader,
  extensionTree,
  marketplaceTree,
  marketplaceName,
  marketplaceEntryPin,
  parseSource,
  type PinnedSource,
  type MarketplaceIndex,
  type SelectedSource,
} from "@kb/extension-source";
import {
  BundledMarketplaces,
  ExtensionStorage,
  type ExtensionScope,
  type ExtensionSelection,
  type ExtensionLock,
  type ExtensionTransaction,
  type MarketplaceOrigin,
} from "@kb/contracts";
import type { SelectionSnapshot } from "./extension-locks.ts";
import { domainError } from "@kb/model";

export const sourceFailure = (error: { readonly message: string }) =>
  domainError("invalid_input", error.message);
export const resolveGithub = Effect.fn("extensions.resolveGithub")(function* (original: string) {
  const source = yield* Effect.try({
    try: () => parseSource(original),
    catch: (error) => domainError("invalid_input", String(error)),
  });
  return yield* (yield* SourceReader).resolve(source).pipe(Effect.mapError(sourceFailure));
});
export const extensionPlan = Effect.fn("extensions.extensionPlan")(function* (
  pin: PinnedSource,
  expected?: { readonly name: string; readonly files?: string },
) {
  const cached = yield* (yield* ExtensionStorage).cached({ kind: "extension", pin });
  const source =
    cached === null
      ? yield* (yield* SourceReader).read(pin).pipe(
          Effect.flatMap((tree) => extensionTree(tree, expected)),
          Effect.mapError(sourceFailure),
        )
      : yield* extensionTree(cached.source, expected).pipe(Effect.mapError(sourceFailure));
  if (cached !== null && (cached.name !== source.name || cached.files !== source.hash))
    return yield* domainError(
      "invalid_input",
      "cached extension projection does not match its index",
    );
  return { pin, cached, source: { ...source, ignored: cached?.ignored ?? source.ignored } };
});
export const marketplacePlan = Effect.fn("extensions.marketplacePlan")(function* (
  pin: PinnedSource,
) {
  const cached = yield* (yield* ExtensionStorage).cached({ kind: "marketplace", pin });
  const raw =
    cached?.source ??
    (yield* (yield* SourceReader)
      .read({ ...pin, path: [pin.path, "kb-marketplace.json"].filter(Boolean).join("/") })
      .pipe(Effect.mapError(sourceFailure)));
  const { index, source } = yield* marketplaceTree(raw).pipe(Effect.mapError(sourceFailure));
  if (cached !== null && (cached.name !== index.name || cached.files !== source.hash))
    return yield* domainError(
      "invalid_input",
      "cached marketplace projection does not match its index",
    );
  return { cached, index, source: { ...source, ignored: cached?.ignored ?? source.ignored } };
});
export interface PinnedMarketplace {
  readonly name: string;
  readonly origin: MarketplaceOrigin;
  readonly selection: ExtensionSelection;
  readonly index: MarketplaceIndex;
  readonly source: SelectedSource;
}
/** A marketplace's identity is its repository and directory, independent of revision. */
export function marketplaceIdentity(selection: ExtensionSelection): string {
  return JSON.stringify([selection.locked.repo.toLowerCase(), selection.locked.path]);
}
/**
 * Every selected marketplace, the first of each name by precedence: the
 * scopes in effect, then kb's own build, the lowest layer, so a scope that
 * selects the same index overrides it. One name bound to two indexes is
 * refused, whichever layers bind it.
 */
export const marketplaceSelections = Effect.fn("extensions.marketplaceSelections")(function* (
  snapshot: readonly SelectionSnapshot[],
) {
  const groups = new Map<
    string,
    { name: string; origin: MarketplaceOrigin; selection: ExtensionSelection }[]
  >();
  const bundled = yield* BundledMarketplaces;
  // kb's own lead the list, whichever layer selects them.
  for (const { name } of bundled) groups.set(name, []);
  const layers: {
    readonly origin: MarketplaceOrigin;
    readonly marketplaces: readonly (readonly [string, ExtensionSelection])[];
  }[] = [
    ...snapshot.map(({ scope, selections }) => ({
      origin: scope,
      marketplaces: Object.entries(selections.marketplaces),
    })),
    {
      origin: "bundled",
      marketplaces: bundled.map(({ name, selection }) => [name, selection]),
    },
  ];
  for (const { origin, marketplaces } of layers)
    for (const [name, selection] of marketplaces) {
      const group = groups.get(name) ?? [];
      group.push({ name, origin, selection });
      groups.set(name, group);
    }
  const selected: { name: string; origin: MarketplaceOrigin; selection: ExtensionSelection }[] = [];
  for (const [name, group] of groups) {
    if (new Set(group.map((entry) => marketplaceIdentity(entry.selection))).size > 1)
      return yield* domainError(
        "invalid_input",
        `ambiguous marketplace ${name}: ${group.map((entry) => `${entry.origin}: ${entry.selection.locked.repo}/${entry.selection.locked.path}`).join(", ")}; remove or replace the conflicting scope selection`,
      );
    const first = group[0];
    if (first !== undefined) selected.push(first);
  }
  return selected;
});
/** A selected index as one reader of it sees it: the one reading listing and install by name share. */
export type SelectedMarketplace = Effect.Success<ReturnType<typeof marketplaceSelections>>[number];
/** The bytes a selection pins, offline: a scope's from the source cache, kb's own from its build. */
const selectedTree = Effect.fn("extensions.selectedTree")(function* (entry: SelectedMarketplace) {
  if (entry.origin !== "bundled") {
    const tree = yield* (yield* ExtensionStorage).tree({
      kind: "marketplace",
      name: entry.name,
      files: entry.selection.locked.files,
    });
    if (tree === null)
      return yield* domainError(
        "not_found",
        `marketplace ${entry.name} is not fetched; run kb ext install`,
      );
    return tree.source;
  }
  const bundled = (yield* BundledMarketplaces).find(({ name }) => name === entry.name);
  if (bundled === undefined) return yield* domainError("internal", "bundled marketplace missing");
  const text = yield* Effect.promise(bundled.index);
  return { files: [{ path: INDEX_FILE, mode: "100644" as const, bytes: encoder.encode(text) }] };
});
const INDEX_FILE = "kb-marketplace.json";
const encoder = new TextEncoder();
/** The index a selection pins, offline: its pinned bytes, which must hash to the pin and still be named as selected. */
export const readSelectedIndex = Effect.fn("extensions.readSelectedIndex")(function* (
  entry: SelectedMarketplace,
) {
  const { index, source } = yield* marketplaceTree(yield* selectedTree(entry)).pipe(
    Effect.mapError(sourceFailure),
  );
  if (source.hash !== entry.selection.locked.files)
    return yield* domainError("invalid_input", `marketplace ${entry.name} does not match its pin`);
  if (index.name !== entry.name)
    return yield* domainError("invalid_input", "marketplace name does not match its lock");
  return { index, source };
});
export const pinnedMarketplaces = Effect.fn("extensions.pinnedMarketplaces")(function* (
  snapshot: readonly SelectionSnapshot[],
) {
  const result: PinnedMarketplace[] = [];
  for (const entry of yield* marketplaceSelections(snapshot))
    result.push({ ...entry, ...(yield* readSelectedIndex(entry)) });
  return result;
});
/**
 * Record the index an install or update resolved through in the scope's
 * marketplaces it writes, with its tree in the cache, so the lock can
 * resolve and refresh the extension by name on its own. Not kb's own: every
 * kb that reads the lock ships it, and a copy would hold the person's
 * catalog at this pin past the next release.
 */
export const recordIndex = Effect.fn("extensions.recordIndex")(function* (
  tx: ExtensionTransaction,
  marketplaces: Map<string, ExtensionSelection>,
  marketplace: PinnedMarketplace | undefined,
) {
  if (marketplace === undefined || marketplace.origin === "bundled") return;
  yield* tx.store({ kind: "marketplace", pin: marketplace.selection.locked }, marketplace.source);
  marketplaces.set(marketplace.name, marketplace.selection);
});
/** Request resolution consumes a catalog of reviewed pins; refresh is a separate explicit operation. */
export const resolveExtensionRequest = Effect.fn("extensions.resolveRequest")(function* (
  original: string,
  marketplaces: readonly PinnedMarketplace[],
) {
  if (original.startsWith("github:") || original.startsWith("https://github.com/"))
    return {
      original,
      pin: yield* resolveGithub(original),
      marketplace: undefined,
      name: undefined,
    };
  const request = yield* Effect.try({
    try: () => marketplaceName(original),
    catch: (error) => domainError("invalid_input", String(error)),
  });
  const matches = marketplaces.flatMap((marketplace) =>
    request.marketplace !== undefined && request.marketplace !== marketplace.name
      ? []
      : marketplace.index.extensions
          .filter((entry) => entry.name === request.name)
          .map((entry) => ({ marketplace, entry })),
  );
  if (matches.length !== 1)
    return yield* domainError(
      "invalid_input",
      matches.length === 0
        ? `no marketplace offers ${original}`
        : `ambiguous ${request.name}: ${matches.map(({ marketplace }) => `${request.name}@${marketplace.name}`).join(", ")}`,
    );
  const match = matches[0];
  if (match === undefined) return yield* domainError("internal", "marketplace match missing");
  return {
    original: `${request.name}@${match.marketplace.name}`,
    pin: marketplaceEntryPin(match.marketplace.selection.locked, match.entry.source),
    marketplace: match.marketplace,
    name: request.name,
  };
});

/** A recorded marketplace install refreshes the index belonging to its own self-contained lock. */
export const resolveRecordedRequest = Effect.fn("extensions.resolveRecorded")(function* (
  original: string,
  snapshot: readonly SelectionSnapshot[],
  scope: ExtensionScope,
  lock: Pick<ExtensionLock, "marketplaces">,
) {
  if (original.startsWith("github:") || original.startsWith("https://github.com/"))
    return yield* resolveExtensionRequest(original, []);
  const requested = yield* Effect.try({
    try: () => marketplaceName(original),
    catch: (error) => domainError("invalid_input", String(error)),
  });
  const selections = new Map(
    (yield* marketplaceSelections(snapshot)).map((entry) => [entry.name, entry]),
  );
  for (const [name, selection] of Object.entries(lock.marketplaces))
    selections.set(name, { name, origin: scope, selection });
  const refreshed: PinnedMarketplace[] = [];
  for (const selected of selections.values()) {
    if (requested.marketplace !== undefined && requested.marketplace !== selected.name) continue;
    const pin = yield* resolveGithub(selected.selection.original);
    const plan = yield* marketplacePlan(pin);
    if (plan.index.name !== selected.name)
      return yield* domainError(
        "invalid_input",
        `marketplace changed name from ${selected.name} to ${plan.index.name}`,
      );
    refreshed.push({
      name: selected.name,
      origin: selected.origin,
      index: plan.index,
      source: plan.source,
      selection: {
        original: selected.selection.original,
        locked: { ...pin, files: plan.source.hash },
      },
    });
  }
  return yield* resolveExtensionRequest(original, refreshed);
});

/** An omitted name selects every entry; both update surfaces share this policy. */
export function namedEntries<T>(
  entries: Readonly<Record<string, T>>,
  name?: string,
): [string, T][] {
  return Object.entries(entries).filter(([held]) => name === undefined || held === name);
}
