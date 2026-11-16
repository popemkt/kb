# Commands as nodes: should a person be able to make a command out of nodes?

Research for the owner, 2026-11-17. The question as asked: _"maybe do a plan if
we want to adopt command as nodes like tana. Not sure how useful it is, but can
be a case for everything is a node, and a kb is holistic on its own, and easy
making a UI out of it. But the complexity might not be worth it."_

This is a record, not a spec. Where it describes what kb does today it points
at the canonical home (DESIGN.md, DESIGN-UI.md, code) rather than restating
it; where it proposes, nothing here is decided until the owner says so.

**Verdict, up front.** kb is closer than the question assumes: the command
_node_, the one-step stored _call_, the runner catalog, data-form commands,
an ordered-steps primitive and an approval core all exist. What is missing is
small and specific: a person-made command node that holds an ordered list of
calls and runs from ⌘K, a key, a button or an agent. Phases 0–2 below are
worth doing because they mostly close seams kb already has (one is a dead seam
today). Phases 3–4 (buttons, parameters beyond the existing two
placeholders, triggers) should wait for evidence of use.

## 1. Problem

kb's rule is that everything is a node (AGENTS.md → Rule 1, corollary). Today
a command is _named_ by a node but _is_ code: what ⌘K runs, what a key runs and
what the node menu offers are registered contributions. A person who wants
"mark this done, move it under Archive, stamp today's date" as one gesture has
three options, none good: do the three steps by hand each time, write a
`#script` (code, a trust gesture, a grant), or write an extension
(`.kb/extensions/*.ts`, trusted closure). Tana's answer is a node holding the
steps. The question is whether kb should have the same, how far it already is,
and whether the extra concept pays for itself.

Sub-questions the owner asked about:

1. user-defined commands as nodes: a node holding a sequence of actions with
   parameters;
2. buttons / UI made from them;
3. binding them to keys;
4. running them from ⌘K and from agents;
5. permissions via the approval guard;
6. core or extension;
7. whether it is worth it.

## 2. How the others do it

| Tool | Is a user command data in the graph? | Steps | Triggers | Parameters | Permission model |
| --- | --- | --- | --- | --- | --- |
| Tana | **Yes, a node** | child nodes, top to bottom; the same command at most once per node, nest to repeat | Cmd+K, node buttons, supertag "AI and Commands" menus, events (child/tag added/removed) | fields under each step; `${sys:context}`, `${sys:nodeId}`, `${field}` | none documented; a 60 s loop breaker disables events |
| Notion | No: configuration on a button block / database | ordered actions (insert blocks, add/edit pages, notify, webhook, open page, confirm, variables) | click; database automations: page added, property edited, recurring | formulas and mentions in actions only | page access + editor access on target database; automations cannot trigger automations |
| Logseq | No: `config.edn` `:commands` / plugin code | vector of fixed editor steps | slash menu; plugins: palette, shortcuts, toolbar, `{{renderer}}` slots | macros `$1 $2` | plugin trust only |
| Capacities | No user commands | – | one palette for search + built-in actions | – | – |
| Anytype | No user commands; local API (0.46) for outside automation | – | slash menu (built-in) | – | API key per app, revocable |

Sources:

- Tana command nodes, triggers, scoping (Node filter / Node context; a command
  disappears from Cmd+K and its button where it does not match), `IS COMMAND`
  searches, one-command-per-node rule:
  <https://outliner.tana.inc/learn/features/command-nodes>,
  <https://outliner.tana.inc/learn/tutorials/three-levels-of-tana-commands>.
- Tana parameters and the 60-second loop breaker for events:
  <https://outliner.tana.inc/learn/features/ai-command-nodes>. Event trigger
  "On added": <https://tana.inc/faq/move-node-to-library-when-a-supertag-is-used>.
  Users asking for more triggers and for running commands programmatically:
  <https://ideas.tana.inc/posts/171-command-triggers>.
- Notion buttons and their permissions: <https://www.notion.com/help/buttons>,
  <https://www.notion.com/help/database-buttons>. Automations (triggers,
  "can't trigger other automations", silent pauses on failure):
  <https://www.notion.com/help/database-automations>.
- Logseq `:commands`, macros:
  <https://discuss.logseq.com/t/macros-and-commands-lets-share/9565>; plugin
  API `registerSlashCommand`, `registerCommandPalette`,
  `registerCommandShortcut`, `onMacroRendererSlotted`:
  <https://logseq.github.io/plugins/interfaces/IEditorProxy.html>,
  <https://logseq.github.io/plugins/interfaces/IAppProxy.html>.
- Capacities palette ("actions always appear at the top"; no user commands):
  <https://capacities.io/whats-new/release-20>.
- Anytype local API: <https://doc.anytype.io/anytype/features/local-api>;
  community requests for buttons / custom commands (unanswered by design):
  <https://community.anytype.io/t/custom-buttons/11909>,
  <https://community.anytype.io/t/custom-commands/9748>.

What to take from them:

- **Only Tana makes a command a node**, and that is what makes it queryable,
  attachable to a supertag, and renderable as a button by reference. Everyone
  else treats a command as configuration of something else.
- **Scoping by query is the useful part of Tana's model.** "Offer this on
  nodes matching X" is exactly kb's T0 `when` (below).
- **The recurring pain is opacity**: Tana documents almost no debugging,
  Notion's automations "may go unreported" when they fail, and both bolt on a
  blunt loop breaker once events exist. Events are where complexity explodes;
  a command a person presses is cheap by comparison.
- **Permission is either absent (Tana) or page access (Notion).** kb's guard
  core is already stronger than either; a command adds no new authority
  question if it only ever runs actions through it.

## 3. What kb already has

Mapped on `main` at `e4383f17`. Paths are repo-relative.

**Command nodes, as names.**
`seededCommand(id, text, at)` (`packages/domain/model/src/seed-builders.ts`)
makes a `sys.command`-typed node with no fields. Core seeds its own
(`packages/domain/seed/src/seed.ts`, ids in `packages/domain/model/src/model.ts`),
families seed theirs: `sys.cmd.outline.copy-as`
(`packages/extension/outline/src/ids.ts`), `sys.cmd.days.today`,
`sys.cmd.location.open`. The node is the command's identity and label; it
holds no behaviour.

**One runner catalog, code only.** `packages/app/ui/src/lib/commands.tsx` is
"the one command registry": `GLOBAL_COMMANDS` and `NODE_COMMANDS` plus every
`CommandPoint` contribution (`packages/kit/ui-sdk/src/lib/command-point.ts`),
merged by `commandsFor`, run by `runCommand(id, ctx)`. Canonical home:
DESIGN-UI.md → [The node menu](../../DESIGN-UI.md#the-node-menu).

**Data-form commands, contributed by code.** The T0 forms in
`packages/kit/ui-sdk/src/lib/command-forms.tsx`: `provideCommand(id, {label,
icon, group, order, when, run})` and `providePaletteStep(id, {candidates,
commit})`. `when` is a query node (the command is offered on rows its query
answers: Tana's Node filter); `run` is an `ActionCall` (`lib/action-call.ts`,
`{action, input}`) or a picker step; a step's `commit` fills `PICKED`. The
page interprets them, so no author code runs on a pick. They are data, but
they live in a plugin's code, not in the graph.

**One stored call, as a node.** `#call` (`sys.call`, which extends
`sys.command`) with `sys.f.call.action` and `sys.f.call.input` (canonical JSON
object), in `packages/domain/keybindings/src/nodes.ts` (`callNode`,
`callOfNode`, `normalizedCall`). It was introduced as a shortcut target
(DESIGN-UI.md → [Outline editor](../../DESIGN-UI.md#outline-editor-i1),
"An action target is an ordinary `#call` recipe"). It is the closest thing to
a Tana command node kb has: one step, no sequence.

**Shortcuts as nodes, shipped.** `#shortcut` with `keys`, `runs` (a
`sys.command` node: a registered command, a context intent, or a `#call`),
`where`, `enabled`, `replaces`. Read by `storedKeybindings`
(`packages/domain/keybindings/src/stored.ts`, `resolvedTarget`) into
`admitKeymaps`; reviewed in `packages/app/ui/src/lib/stored-shortcuts.tsx`.
Decision record: [2026-11-11-shortcuts-as-nodes](2026-11-11-shortcuts-as-nodes.md).
So "bind a command node to a key" is already solved for any command
`resolvedTarget` accepts.

**The ⌘K palette.** `packages/app/ui/src/components/palette/command-palette.tsx`
over `buildPaletteIndex` (`packages/app/ui/src/lib/palette-index.ts`): every
node, with nodes typed `sys.command` ranked as commands; a selected command
runs through `runCommand`.

**A dead seam today.** `isCommandNode` in `palette-index.ts` checks the type
`sys.command` directly. So:

- a node a person tags `#command` is listed in ⌘K _as a command_ and, when
  picked, toasts `Unknown command: <id>` (`runCommand`, `commands.tsx`),
  because the catalog only knows registered code;
- a `#call` node, which _can_ run (through a shortcut), is typed `sys.call`
  and listed as a plain node, so picking it navigates instead of running.

Both are what Rule 1 calls a declared abstraction that no path honours. Phase
0 below closes it whatever else is decided.

**Ordered steps over actions.** Procedures (`ProcedurePoint`,
`packages/contract/contracts/src/procedure.ts`,
`packages/application/operations/src/procedure.ts`; DESIGN.md →
[Procedures](../../DESIGN.md#procedures)): steps that offer actions, each
step's done-ness read by a `check`, walked by `procedure.step` through
`CoreInvoke` with the caller's approval lent by `callWithin`. Code-contributed,
resumable, decision-aware. Heavier than a command needs (checks), but its
_invoke path_ is exactly right.

**One transaction of node writes.** `node.batch`
(`packages/application/operations/src/node-batch.ts`; DESIGN.md →
[Batches of writes](../../DESIGN.md#batches-of-writes--nodebatch)):
`node.add` / `node.update` / `node.delete` calls planned in order over one
working copy, one guard decision, one undo step.

**Approval.** Every call passes guards and interceptors
(`packages/application/operations/src/interception.ts`; DESIGN.md →
[Action registry](../../DESIGN.md#action-registry)); `approval: "required"` is
enforced by core in every deployment; actors are `human | agent | cli |
script | reaction` (`packages/domain/model/src/actor.ts`); MCP and WebMCP carry
no approval (GAPs 01M3R2KD6V1AZ9WS62ZVG9T4G2, 01M3S5DDJ7MP2VZ4WJB007RRR5).
The governance family seeds `#approval-policy` nodes but contributes no guard
yet (`packages/extension/governance/src/`, GAP 01M5E2DAVRH5CWKM27BVDYW19T).

**Code that runs from a node.** `#script` (`sys.tag.script`, DESIGN.md →
[Scripts](../../DESIGN.md#scripts)): trusted by digest, run once by
`ext.code.script.run` (approval required), calling actions as the `script`
actor within its grant. This is kb's escape hatch for anything a sequence of
calls cannot say.

**Things that look related but are not.** Routines
(`packages/extension/routines*`) are calendar events, not a scheduler of
actions. Jobs (`#job`, `every`, `runs`) are designed only
(`docs/research/2026-11-11-cli-host-modes.md` §6, GAP
01M6EKEE8P040W6592ZZ3HDVGC). Transaction reactions (DESIGN.md →
[Transaction reactions](../../DESIGN.md#transaction-reactions)) are code. There
is no button node, field type or render anywhere (`routines-ui/src/buttons.ts`
is CSS only), and no macro concept.

**Scorecard against the owner's list.**

| Asked for | Today |
| --- | --- |
| command as a node | named yes (`sys.command`); runnable only if code registers its id, or if it is a one-step `#call` reached by a key |
| sequence of actions with params | code only: procedures, `node.batch`, T0 forms; params are `id` (the row) and `PICKED` |
| button | none |
| bind to a key | yes, `#shortcut.runs` → command / intent / `#call` |
| ⌘K | lists `sys.command` nodes; runs only registered ones (dead seam above) |
| agents | any action over MCP; no "run this command node" |
| approval | per action, in core; nothing new needed if commands only call actions |

## 4. Designs

All three share one rule that is not up for debate: **a command node holds
data, never code, and confers no authority.** Every step is an ordinary
action call decided by the guards as itself; the node, its label and who
wrote it grant nothing. This is the shortcuts decision restated for commands
(DESIGN-UI.md → Outline editor), and `#script` stays the home of code.

### A. `#command` holds ordered `#call` children; one core runner

- A person-made command is a `sys.command` node whose `#call` children, in
  sibling order, are its steps. Other children are notes and are ignored, so
  a person can annotate a command as any node. Tana's shape, kb's existing
  pieces: no new tag beyond what is seeded, one optional field `when` (a
  query node, the T0 `when`, Tana's Node filter).
- A one-step command is simply a `#call` node, as today.
- One core action, `command.run {command, id?}`, is the only runner:
  - it reads the steps (one reader, shared with `resolvedTarget`);
  - fills the existing placeholders only: the target node into `input.id`
    (as a key's call does) and nothing else in phase 2;
  - if every step is `node.add` / `node.update` / `node.delete`, it lowers
    them to one `node.batch`: one transaction, one guard decision over all of
    it, one undo step;
  - otherwise it runs the steps in order through `CoreInvoke` with
    `callWithin`, as `procedure.step` does, stopping at the first failure and
    reporting `step N:` the way `node.batch` reports `call N:`.
- Surfaces all reach the one runner: `runCommand` falls back to `command.run`
  for an id the code catalog lacks (closing the dead seam); `resolvedTarget`
  accepts a stored command; the node menu offers a command whose `when`
  answers the row; MCP gets `command_run` from the manifest like every action;
  `kb action-invoke` reaches it (no new verb; note `kb run` already means saved
  queries).
- **Trade-offs.** + Every surface already exists and gains one fallback; + an
  agent can both _write_ a command (it is nodes) and _run_ one; + one undo
  for the common node-only case. − A mixed sequence is not atomic (a later
  step can fail after an earlier one committed); that must be said in the
  receipt, not hidden. − It is a new action on the wire (fingerprint change).

### B. Lower stored commands into T0 contributions, page only

- A reader in the page, like `storedKeybindings`, turns each `#command` node
  into a `provideCommand` contribution (`run` = its first `#call`, or a
  sequence the page walks).
- **Trade-offs.** + Smallest change, reuses `command-forms.tsx` as is. − Page
  only: an agent, the CLI and MCP cannot run a command, so "a kb is holistic
  on its own" is not met. − The sequence semantics (atomicity, failure)
  would live in the page and need re-stating for any second surface: a mirror,
  not a bridge (AGENTS.md → Rule 1). Rejected as the end state; it is a
  possible phase-1 shortcut only if A's runner were too big, and it is not.

### C. Procedures become nodes; a command is a procedure without checks

- Generalise `ProcedurePoint` to read `#procedure` nodes; a command is a
  procedure whose steps have no `check`, walked to the end in one go.
- **Trade-offs.** + One sequence concept for wizards and commands. − A
  procedure's essence is resumable, read-done-ness steps and decisions; a
  command is a one-shot gesture. Forcing one into the other adds a mode
  ("walk to the end without stopping") to the procedure walker: the boolean
  that forks a function, Rule 1's first symptom. − Procedures are also an
  owner-trusted surface for migrations; making them person-writable data
  widens what a migration walker reads. Rejected; A borrows procedures'
  invoke path (`callWithin`) without merging the concepts.

### (Not a design) D. Do nothing; point people at `#script`

- A script already runs a sequence of `kb.invoke` calls from a node.
- **Trade-off.** Code, a trust gesture per digest, a grant, and a Worker, for
  "tag it done and move it". The fair reading is that `#script` is the
  expressive ceiling and commands-as-nodes is the floor below it. If phase 2
  is never used, D is the answer, and it costs nothing.

## 5. Recommendation and phased plan

**A, in phases, with an explicit stop after phase 2 unless use shows up.**
Core owns it, not an extension: the command node, the `#call` recipe, the
palette, the keymap and the invoke core are all core already, so a family
would be a wrapper around core's own concept (Rule 1's "wrapper that exists
only to avoid touching the thing it wraps"). Buttons (phase 3) are the
outline's render and belong to the outline family.

**Phase 0: restructure, behaviour-preserving (one commit).**
- Move the `#call` codec (`callNode`, `callOfNode`, `normalizedCall`, the ids)
  out of `@kb/keybindings` to the home of the command concept (the `sys.command`
  ids already live in `@kb/model`; a small `@kb/commands` domain package if the
  codec does not belong in `@kb/model`). Today a keybinding package owns a
  concept that palette and runner also need; that is the shape that resists
  the change.

**Phase 1: a `#call` runs from ⌘K and from agents (one commit).**
- `command.run {command, id?}` for a single `#call`; `runCommand`'s fallback;
  ⌘K lists `#call` nodes as commands, because `isCommandNode` reads the type
  with inheritance through the one is-a reader the model already has (`isA`,
  `packages/domain/model/src/tag-kinds.ts`), not a second check. (This moves
  here from phase 0: listing a `#call` before it can run would widen the dead
  seam.) Closes the dead seam for `#call`; a bare
  `#command` with no steps is refused by the runner with a message that says so
  ("this command has no steps"), not "Unknown command".
- Proved by: a person-made `#call` runs from ⌘K, from a `#shortcut`, and over
  MCP, each through the guards (contract test over the invoke core, as
  `procedure-contract.test.ts` does).

**Phase 2: sequences (one spec commit, one code commit).**
- `#call` children of a `#command` are its steps; the node-only batch lowering;
  the mixed sequential path with `step N:` failures; `when` offers it in the
  node menu. Spec home: DESIGN.md → Action registry (runner) and DESIGN-UI.md →
  The node menu (where it is offered).
- **Confirmation for a command someone else wrote.** A command is a gesture
  the person makes, but its content may have been written by an agent, so a
  person can be fooled into pressing "Tidy" that deletes. Reuse the shortcut
  confirmation as is: machine-local, keyed by canonical content (normalized
  steps), required before a stored command's first run and again when its
  content changes; the writer from `KbTx.actor` shown as information only.
  One authority mechanism for "stored data that runs actions", not a second.
- **Stop here and measure** (see §7).

**Phase 3 (only on evidence): buttons.**
- A button is not a new node kind: it is a reference to a command node, drawn
  pressable. The outline draws an inline ref whose target is a command as a
  button (label = the command's text) that runs it about the row it sits on.
  A tag's template can hold that ref, so every `#task` row carries "Done →
  Archive": Tana's supertag buttons, as a ref in a template.
- Script overlay buttons stay blocked on GAP 01M54DFMDJFYRDM8ZZXQB749PQ;
  unrelated.

**Phase 4 (probably never): parameters and triggers.**
- Parameters beyond `id` and `PICKED` (step outputs, dates, fields of the
  row) are the start of an expression language. Each one added should be a
  named placeholder with a schema, never string interpolation; past three,
  send people to `#script`.
- Event triggers ("when tagged #done, run…") are transaction reactions bound
  from data, which is the Tana/Notion loop-breaker problem. If wanted, they
  are a `#job`/reaction design (GAP 01M6EKEE8P040W6592ZZ3HDVGC), not part of
  commands.

## 6. Cost

| Phase | Packages touched | New contracts | Data / migrations |
| --- | --- | --- | --- |
| 0 | `@kb/keybindings`, `@kb/model` (or new `@kb/commands`) | none (behaviour-preserving; surface budgets re-measured) | none: `sys.call` ids unchanged |
| 1 | `@kb/operations` (`command.run`), `app/ui` (`commands.tsx`, `palette-index.ts`), `@kb/keybindings` (`stored.ts` reader shared) | one action; wire fingerprint; MCP tool `command_run` | none |
| 2 | `@kb/operations` (lowering to `node.batch`, sequential path), `ui-sdk` (node-menu offer by `when`), `app/ui` (confirmation reuse) | `command.run` output gains per-step receipts; one seeded field `when` on `sys.command` | seed change only: seed-golden fixture |
| 3 | `outline-ui` (render a ref to a command as a button) | none | none |

No plugin migration in any phase: existing `#call` and `#shortcut` rows keep
their shape. Estimated size: phases 0–2 are on the order of the
shortcuts-as-nodes stack's reader and review commits, not its chord codec.

## 7. What would make us say no

- **No use after phase 1–2.** If, a few weeks after phase 2 ships, the repo's
  own kb (the first user) holds no person-made `#command` and no person-made
  `#call` outside shortcuts, stop. Do not build buttons for a feature no one
  writes. The `#call`-in-⌘K part of phase 1 is still worth keeping: it closes
  a dead seam.
- **The sequence wants control flow.** If the first real commands people
  write need conditionals, loops, or one step's output feeding the next, the
  answer is `#script`, not a growing command grammar. Two languages for
  "steps that call actions" would be a mirror.
- **Atomicity cannot be made honest.** If the mixed (non-node) path's partial
  failures cannot be reported clearly enough that a person knows what
  happened, restrict commands to the node-only batch lowering and refuse
  other actions in a step.
- **The confirmation reads as friction.** If confirming each new or changed
  command annoys more than it protects in a single-owner checkout, revisit it
  with the owner. Do not drop it silently: it is the only thing between an
  agent-written command and a person's press.
- **A second runner appears.** If any surface needs its own way to run a
  command (the page walking steps itself, a CLI verb with its own loop), the
  model is wrong; `command.run` must be the only one.
