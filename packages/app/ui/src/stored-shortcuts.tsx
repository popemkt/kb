/** Ordinary graph shortcuts lower into the page's existing keyboard point. */
import { Effect } from "effect";
import { familyTags, KeybindingPoint, KeyContextPoint } from "@kb/contracts";
import { definePlugin, type Contribution, type PluginHandle, type PluginContext } from "@kb/plugin";
import {
  admitKeymaps,
  describeChord,
  SHORTCUT_IDS,
  keyContextOf,
  shortcutConfirmation,
  storedKeybindings,
  STORED_KEY_OWNER,
  type Keybinding,
} from "@kb/keybindings";
import { coreExtension, sandboxTrustDef } from "@kb/operations";
import { canonicalJson, refValuesOf } from "@kb/model";
import {
  ActionReviewPoint,
  BrowserHostService,
  type BrowserHost,
  CommandPoint,
  currentContributions,
  currentService,
  nodeMenu,
  OverlayPoint,
  subscribeUiKernel,
  uiKernelReader,
  toast,
} from "@kb/ui-sdk";
import { KeyboardIcon } from "@phosphor-icons/react";
import { ShortcutReview } from "@/shortcut-review";
import { changeExtensions } from "@/actions/extensions";
import {
  shortcutState,
  shortcutProblem,
  publish,
  currentRow,
  readShortcutApproval,
  type ShortcutReading,
} from "@/lib/stored-shortcuts";
import { commandsFor } from "@/lib/commands";
import { servedManifest, subscribeManifest } from "@/lib/manifest";
import { pageCommandContext, pageCommandTarget } from "@/stores/page-commands";
import { useWorkspaceStore } from "@/stores/workspace.store";
import { useGraphStore } from "@/stores/graph.store";

function keySource(owner: string) {
  const provenance = uiKernelReader.provenance(owner);
  return {
    provider: provenance?.root ?? owner,
    implementation: provenance?.digest ?? "page",
  };
}

/** The first elected runner entry decides membership, as it does on dispatch. */
function liveRegistrations() {
  let context: ReturnType<typeof pageCommandContext> | undefined;
  let commands: ReturnType<typeof commandsFor> | undefined;
  return {
    contexts: currentContributions(KeyContextPoint).map(keyContextOf),
    bindings: currentContributions(KeybindingPoint).filter(
      ({ owner }) => uiKernelReader.provenance(owner)?.root !== STORED_KEY_OWNER,
    ),
    source: keySource,
    command: (id: string) => {
      context ??= pageCommandContext(pageCommandTarget(), { close: () => {}, openStep: () => {} });
      commands ??= commandsFor(context);
      const elected = commands.find(({ command }) => command.id === id);
      if (elected === undefined || !(elected.command.when?.(context) ?? true)) return undefined;
      return {
        id,
        source:
          elected.source.kind === "contribution"
            ? keySource(elected.source.registration.owner)
            : { provider: "page", implementation: "host-command" },
      };
    },
    action: (id: string) => {
      const entry = servedManifest()?.actions?.find((action) => action.id === id);
      return entry === undefined
        ? undefined
        : {
            id: entry.aliasOf ?? entry.id,
            source: { provider: "action-catalog", implementation: entry.id },
          };
    },
  };
}

function readShortcuts(host: BrowserHost) {
  const registrations = liveRegistrations();
  // wireNodes is the complete replica, independent of the outline's ontology scope.
  const nodes = useGraphStore.getState().wireNodes;
  const graph = new Map(nodes.map((node) => [node.id, node]));
  const decoded = storedKeybindings(nodes, registrations);
  const summaryOf = (candidate: (typeof decoded.candidates)[number]) => {
    const row = graph.get(candidate.nodeId);
    const reference = (field: string) =>
      row === undefined ? undefined : refValuesOf(row, field)[0];
    const label = (id: string | undefined) => {
      if (id === undefined) return "Unavailable";
      const text = graph.get(id)?.text.trim();
      return text === undefined || text === "" ? id : text;
    };
    const keys = candidate.contributions.map(({ value }) => describeChord(value.chord)).join(" / ");
    const context =
      candidate.contributions[0]?.value.context.replaceAll(".", " ") ?? "unavailable context";
    const holder = reference(SHORTCUT_IDS.replaces);
    return `${keys} in ${context}: ${label(reference(SHORTCUT_IDS.runs))}${holder === undefined ? "" : ` instead of ${label(holder)}`}`;
  };
  const manifest = servedManifest();
  const trusted = new Set(manifest?.trusted ?? []);
  const rows = decoded.candidates.map((candidate) => ({
    candidate,
    digest: manifest?.root === undefined ? null : shortcutConfirmation(manifest.root, candidate),
  }));
  const eligible = rows.filter(
    ({ candidate, digest }) =>
      candidate.contributions.every(({ value }) => value.replaces === undefined) ||
      (digest !== null && trusted.has(digest)),
  );
  const stored = new Set(eligible.flatMap(({ candidate }) => candidate.contributions));
  const maps = admitKeymaps(
    registrations.contexts,
    [...registrations.bindings, ...stored],
    (owner, binding) => stored.has(binding) || host.replacementApproved(owner),
  );
  const heldIds = new Set([...maps.values()].flatMap(({ held }) => held.map(({ id }) => id)));
  const refusals = [...maps.values()].flatMap(({ refused }) => refused);
  const readings: ShortcutReading[] = rows.map(({ candidate, digest }) => {
    const pending =
      candidate.contributions.some(({ value }) => value.replaces !== undefined) &&
      (digest === null || !trusted.has(digest));
    const reason = refusals.find(({ id }) =>
      candidate.contributions.some((binding) => binding.id === id),
    )?.reason;
    return {
      candidate,
      digest,
      summary: summaryOf(candidate),
      state: pending
        ? "pending"
        : candidate.contributions.some((binding) => heldIds.has(binding.id))
          ? "active"
          : "refused",
      ...(reason === undefined ? {} : { reason }),
    };
  });
  return {
    rows: readings,
    bindings: eligible.map(({ candidate }) => candidate),
    native: registrations.bindings,
    problems: decoded.refused,
  };
}

/** Publication and subscriptions share the page plugin's activation lifetime. */
const watchShortcuts = Effect.fn("kb.shortcuts.watch")(function* (
  ctx: PluginContext,
  host: BrowserHost,
) {
  let handles: PluginHandle[] = [];
  let signature = "";
  let native: readonly Contribution<Keybinding>[] = [];
  let refreshing = false;
  let open = true;
  const refreshEffect = Effect.fn("kb.shortcuts.refresh")(function* () {
    if (!open || refreshing) return;
    refreshing = true;
    try {
      const next = readShortcuts(host);
      const key = canonicalJson(next.bindings.map(({ nodeId, content }) => ({ nodeId, content })));
      if (
        key !== signature ||
        next.native.length !== native.length ||
        next.native.some((binding, i) => {
          const previous = native[i];
          return (
            previous === undefined ||
            binding.id !== previous.id ||
            binding.owner !== previous.owner ||
            binding.value !== previous.value
          );
        })
      ) {
        signature = key;
        native = next.native;
        for (const handle of handles.toReversed()) yield* handle.unload;
        handles = [];
        for (const candidate of next.bindings) {
          handles.push(
            yield* ctx.plugin(
              definePlugin({
                name: candidate.nodeId,
                namespace: "",
                apply: (child) =>
                  Effect.forEach(candidate.contributions, (binding) =>
                    child.contribute(KeybindingPoint, { id: binding.id, value: binding.value }),
                  ).pipe(Effect.asVoid),
              }),
            ),
          );
        }
      }
      // A changed row may remain displayed in its old review; its answer is checked afresh.
      publish({
        rows: next.rows,
        review: shortcutState().review,
        rev: useGraphStore.getState().rev,
        problems: next.problems,
      });
    } finally {
      refreshing = false;
    }
  });
  const refresh = () => {
    // Kernel notifications also occur while an activation is closing. Its children
    // must not be republished outside that activation's visible lifetime.
    if (
      uiKernelReader.provenance(ctx.name) !== undefined &&
      currentService(BrowserHostService) !== undefined
    )
      Effect.runSync(refreshEffect());
  };
  yield* Effect.acquireRelease(
    Effect.sync(() => [
      host.subscribe(refresh),
      useWorkspaceStore.subscribe(refresh),
      subscribeManifest(refresh),
      subscribeUiKernel(refresh),
    ]),
    (stops) =>
      Effect.sync(() => {
        open = false;
        for (const stop of stops) stop();
        publish({ rows: [], review: null, rev: 0, problems: [] });
      }),
  );
  yield* refreshEffect();
});

/** Scoped publication makes all keyboard consumers, hints included, use ordinary admission. */
export const storedShortcutsUiPlugin = definePlugin({
  name: STORED_KEY_OWNER,
  tags: familyTags(coreExtension, "ui"),
  namespace: "",
  inject: [BrowserHostService],
  apply: (ctx) =>
    Effect.gen(function* () {
      const host = yield* ctx.get(BrowserHostService);
      yield* ctx.contribute(ActionReviewPoint, {
        id: "shortcut-confirmation",
        value: {
          action: "sandbox.trust",
          read: (invocation) =>
            readShortcutApproval(sandboxTrustDef.inputSchema.parse(invocation.input).digest),
        },
      });
      yield* ctx.contribute(OverlayPoint, {
        id: "shortcut-review",
        value: { order: 50, Component: ShortcutReview },
      });
      yield* ctx.contribute(CommandPoint, {
        id: "shortcut.status",
        value: {
          id: "shortcut.status",
          menu: nodeMenu("mark", 39),
          when: ({ target }) =>
            currentRow(target.nodeId) !== undefined || shortcutProblem(target.nodeId) !== undefined,
          chrome: () => ({ label: "Shortcut status", icon: <KeyboardIcon /> }),
          run: ({ target, palette }) => {
            const row = currentRow(target.nodeId);
            toast(
              shortcutProblem(target.nodeId) ??
                row?.reason ??
                (row?.state === "pending"
                  ? "This override waits for your confirmation in Review shortcut override."
                  : `Shortcut ${row?.state ?? "unavailable"}`),
            );
            palette.close();
          },
        },
      });
      yield* ctx.contribute(CommandPoint, {
        id: "shortcut.review",
        value: {
          id: "shortcut.review",
          menu: nodeMenu("mark", 40),
          when: ({ target }) => currentRow(target.nodeId)?.state === "pending",
          chrome: () => ({ label: "Review shortcut override", icon: <KeyboardIcon /> }),
          run: ({ target, palette }) => {
            const row = currentRow(target.nodeId);
            if (row === undefined || row.digest === null)
              throw new Error("Connect to the root before reviewing this shortcut.");
            publish({ ...shortcutState(), review: row });
            palette.close();
          },
        },
      });
      yield* ctx.contribute(CommandPoint, {
        id: "shortcut.revoke",
        value: {
          id: "shortcut.revoke",
          menu: nodeMenu("mark", 41),
          when: ({ target }) => {
            const row = currentRow(target.nodeId);
            return (
              row?.state === "active" &&
              row.candidate.contributions.some(({ value }) => value.replaces !== undefined)
            );
          },
          chrome: () => ({ label: "Revoke shortcut confirmation", icon: <KeyboardIcon /> }),
          run: async ({ target, palette }) => {
            const row = currentRow(target.nodeId);
            if (row?.digest !== null && row?.digest !== undefined)
              await changeExtensions("sandbox.untrust", { digest: row.digest });
            palette.close();
          },
        },
      });
      yield* watchShortcuts(ctx, host);
    }),
});
