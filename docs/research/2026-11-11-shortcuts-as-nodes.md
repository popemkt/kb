# Shortcuts as nodes — implementation plan

The owner approved this work on 2026-11-11. It is stacked on #181, which is
stacked on #176. This is a design record; implemented behavior will have its
canonical home in DESIGN-UI.md → Keybindings.

A shortcut is an ordinary node typed `#shortcut`. Its template exposes `keys`,
`runs`, `where`, and `enabled`. A person adds one, labels it, finds it, and edits
its fields through the ordinary graph surfaces. An optional `replaces` reference
names a shipped binding or another shortcut explicitly when it takes a held key.
Disabling a user shortcut withdraws that contribution, revealing its holder again.
Labels never select a command, context, target, or binding.

Shipped definitions have stable identities and become nodes from one declaration,
not a second list manually copied from UI constants. The declaration produces
both the default graph rows and the binding data consumed by the existing point.
Family defaults retain their provenance; a person's override is a separate node
and cannot acquire the family's ownership just by naming its binding. Runtime
callbacks stay code, referenced through their registered identity, never stored
as executable text in a shortcut.

`keys` must preserve the chord model, including physical positions, character
sets, optional modifier constraints and the outline's printable-key matcher.
Human chord text is a convenient entry form, not a replacement for those semantics.
First establish a lossless data representation for the shipped chords and bridge
it into the existing matcher. Arbitrary callbacks must not be stringified.

`where` references a context node derived from the context declaration. `runs`
references a target with a stable command, action or context-intent identity;
resolving it produces the existing KeyRun form. Any action still crosses the
normal invoke and approval path. Context intents remain limited to those the
owning context declares. The exact target-node and chord-field schemas must be
proved against every shipped binding before the node reader is connected.

The node reader uses the unscoped graph/schema, so an ontology projection cannot
silently switch off shortcuts. Graph and kernel generations both invalidate its
reading. It lowers enabled, valid rows into the same contribution model used by
`admitKeymaps`. Reservations, page/surface shadowing, explicit replacement chains,
replacement approval, and physical-key precedence continue to be decided there.
An invalid or refused override stays visible as data and is reported through the
existing refusal mechanism; it does not remove its valid holder. Hints and the
shortcut sheet read the same elected bindings as dispatch.

Implement in separate commits: (1) behavior-preserving chord/declaration data
refactor, proven by the current keymap suites; (2) shortcut schema, default nodes
and unscoped node-to-contribution reader; (3) integration and ordinary-node UI
coverage. Tests must cover round trips of all shipped definitions, inherited
shortcut tags, enable/disable, graph edits without reload, scope exclusion,
reserved typing/Escape/palette, unauthorized replacements, replacement chains
across physical/character forms, and hint agreement. Record seed fixtures, wire
fingerprints and measured page budgets with the commits that change them.

## Admission authority and lifecycle

Every ordinary stored shortcut has a fixed storage-provider contribution owner.
Writable owner/family fields and `where`, `runs`, or `replaces` references never
lend it the referenced family's identity or reserved-key rights. This applies
equally to person-created, agent-created and plugin-written rows. Free chords
remain subject to normal admission. Replacements require machine-local approval
of their exact canonical content through the existing person-approval boundary;
no writable graph field is an authority grant. Actions invoked by a shortcut
still need their own normal approval.

The approval payload has a domain/format version and covers normalized chord
constraints (including absent versus false modifiers), registered matcher
identity and trusted implementation identity, the context, the resolved run
(including action inputs and trusted registered target semantics), and the
replacement identity. A writable target cannot silently change the approved
call by retaining its id. Context-intent targets belong to that context, rather
than merely sharing an intent string. Delayed approval checks the current
canonical content again and refuses a changed binding. Enable/disable is an
eligibility switch and may retain authority for otherwise unchanged content.

Approval state is a third live invalidation source beside graph and kernel
state. Granting or revoking authority must rebuild the admitted map without a
node or plugin change; a keymap cached solely by contribution arrays is not
sufficient. This must be wired through the authority service's observable state,
not inferred from a possibly unchanged extension registry object.

The loaded declaration/point is the sole runtime source of shipped defaults.
Their protected graph rows describe those defaults and do not emit bindings.
Ordinary override nodes are separate candidates. Unloading a family removes its
runtime default even though its graph description remains; reloading creates
only that one default. User overrides are sorted after defaults, topologically
by replacement dependency with stable-id ties. Deterministic cyclic leftovers
are passed to the existing admission rule, which refuses missing held targets;
cycles and their dependents stay inert. Missing contexts, targets and holders
stay inert and are reconsidered on reload. Incremental and fresh reads must
agree, including reversed graph enumeration and intermediate holder unloads.


## Scope decision, 2026-11-12

The current authority policy is [DESIGN-UI.md](../../DESIGN-UI.md#outline-editor-i1).
It supersedes the code-identity and authorship approval proposals above: the
single-owner checkout uses one explicit canonical-content confirmation for any
override, whoever wrote it; writer information is informational only.
The held-image work is preserved unchanged on `bb/kb-held-image`; its parked
status is recorded by [[01M76AZFNNGRS5P55CSCG93YJM]].
