---
name: kb
description: Use when reading or writing a kb knowledge base (a graph of nodes, fields and tags) through kb's MCP tools or the `kb` CLI. Covers looking things up, capturing and editing nodes, defining tags and fields, queries, views, extensions and a person's open kb tab. It also says which store you are acting on and which writes are not yours to make.
---

# kb

kb is a graph, and everything in it is a node. A tag is a node tagged as a tag. A field is a node, and a field's allowed values are nodes too. A node has:

- text and children;
- tags;
- values, keyed by field id (a value may reference another node by id).

Outlines, tables, boards and canvases are views of that one graph.

## Which store you are on

- **`kb mcp` serves one store**, fixed when it starts: its `--root`, else the nearest `.kb/` above its working directory. Every tool acts on that store, and no argument switches it. The host's MCP registration says which store that is.
- **The CLI chooses per command**, the same way: `--root <path>`, else the nearest `.kb/`.
- **In bb**, the kb plugin's `kb_call`, `kb_screen` and `kb_manifest` act on a kb tab and take an optional store name. bb's own kb skill covers them.
- `ext.locations.list` lists the stores this machine has opened. If you can't tell which store a write would land in, ask before writing.

## Tools

An MCP tool's name is its action id with `.` as `_`: `node.add` is `node_add`. `tools/list` gives every tool's inputs, so this file does not repeat them. `kb.manifest` lists every action, including those that need a person's approval, which MCP does not offer as tools. Any action also runs from a shell: `kb action-invoke '{"id":"node.get","input":{"id":"<id>"}}'`.

| Job | Actions | CLI |
| --- | --- | --- |
| Find | `graph.search`, `node.get`, `graph.query`, `ontology.members`, `ext.graph.edges`, `ext.graph.trace`, `ext.graph.suggest` | `kb search`, `kb get`, `kb children`, `kb backlinks`, `kb query`, `kb run`, `kb trace`, `kb suggest` |
| Write nodes | `node.add`, `node.addTree`, `node.update`, `node.batch`, `node.merge`, `node.delete` | `kb add` (`--outline` for a tree), `kb set`, `kb unset`, `kb mv`, `kb rm` |
| Tags and fields | `tag.define`, `field.define`, `ext.graph.relation.type` | `kb tag`, `kb field`, `kb relate` |
| Views and docs | `render.views`, `render.view`, `view.propose`, `ext.docs.materialize`, `ext.docs.check` | `kb docs` |
| A person's open tab | `ui.screen`, `ui.navigate`, `ui.select`, `ui.capture` | none |
| Extensions | `extension.list`, `extension.settings`, `extension.install`, `extension.update`, `extension.marketplace.list` | `kb ext` |
| Store care | `store.backup`, `store.backups`, `migration.list`, `migration.plan` | `kb store`, `kb migrate` |

## Working rules

- **Find before you add.** Search first. Reuse an existing tag or field rather than minting a near-duplicate.
- **Refer by id.** Queries, references and filters name nodes by id (`[?t :node/id "<id>"]`), never by text, because text is a label the person may rename. Resolve a name to an id once, by search, then use the id.
- **Values are multi-valued.** Setting a value adds one. To replace a value, put the old one in `unsetProps` and the new one in `setProps` of a single `node.update` (unset runs first), so the change is one transaction. From a shell, send that same `node.update` through `kb action-invoke`. `kb unset` followed by `kb set` is two transactions.
- **Related writes go in one transaction.** Use `node.batch`, or `node.addTree` for an outline. They then land together and undo together.
- **`sys.*` nodes belong to kb and its families.** You may change a `sys.*` node's text, add your own children or template fields, and set its settings. Anything else is refused with a reason. Report the reason; don't retry with `force`, which is the owner's.
- **Approval is the person's.** An action that `kb.manifest` marks `ask` is not yours to run: for example `migration.apply`, `migration.rollback`, `store.restore`, trusting code, or running a script. Tell the person what to approve, and where.
- **Migrations wait for the owner.** You may list and plan them. Preview, apply, keep or roll back only when the owner asks. A preview needs a `store.backup` first.
- **Extensions install untrusted.** Nothing an extension ships runs until the person trusts it. Never trust code for them.
- **Tests and experiments use a scratch store.** Set `KB_HOME` and `KB_DATA` to fresh temporary directories, and pass `--root` to a temporary store. Never point a test at a person's store.
