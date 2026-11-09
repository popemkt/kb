# Writing a kb extension: what it says about itself

This is the one home of kb's extension guidelines. It says what an
extension's manifest holds, what each field means, and what a marketplace
listing needs. The plugin standards (KB-10) extend this file; they do not
start a second one. How an extension is loaded, bundled and trusted is
[DESIGN.md → Core boundary & extensions](../../DESIGN.md#core-boundary--extensions).
The schema is `ExtensionManifestSchema` in
`packages/contract/contracts/src/extension-manifest.ts`.

Start from [the template](template/README.md).

## Where the manifest lives

An extension is a folder with its server entry `<name>.ts`, and its page
half `<name>.page.tsx` if it has one. The manifest is `<name>.manifest.json`
beside them:

```
extensions/hello/
  hello.ts
  hello.manifest.json
```

The manifest is data, not code:
- kb reads and validates it without running anything. So Settings and the
  review sheet show it _before_ a person trusts the extension.
- An install from GitHub carries it into the store along with the code.
- Its bytes are part of what a person trusts (the extension's digest). If
  you edit the manifest, the extension has to be reviewed again, just as
  when you edit its code.
- A declaration that says these things in code (`description`, `manifest`
  in `defineExtension`) is refused. The file is the only place they live.

kb refuses an extension in three cases:
- its manifest is not JSON;
- the manifest has a field the schema does not know;
- the manifest's page tier contradicts the files: a `drawing`, `scene` or
  `full` tier without a page half, or `none` or `data` with one.

It also reports a `<name>.manifest.json` with no `<name>.ts` beside it as a
failure.

kb's own built-in families declare the same shape in their declaration, and
kb's build fills in their author, repository and licence.

## Not declared is not "none"

Every field is optional, and leaving one out means **not declared**. That
is different from declaring nothing:

| Manifest says | Settings shows |
| --- | --- |
| no `network` key | Network: _not declared_ |
| `"network": { "hosts": [] }` | Network: no network access |
| `"network": { "hosts": ["api.github.com"] }` | Network: reaches api.github.com |

Declare an empty list when the answer is "none". A person reads _not
declared_ as "the author did not say", and should.

Descriptive reach fields are the author's word. kb shows them; it does not enforce them. A
trusted extension with a page half still has the page's full power until
the isolation tiers land (GAP `01M6WVFMGB5PP2AANF0E5R921V`), and the review
sheet says so beside it.

## Fields

| Field | Means | Example |
| --- | --- | --- |
| `description` | One line on what it adds, as a person would say it. Settings shows it under the name. | `"Adds one action, Say hello, that greets whoever you name."` |
| `author` | Who wrote it and answers for it: a person or an organisation. | `"popemkt"` |
| `homepage` | Where to read about it. An `https:` URL. | `"https://github.com/owner/repo/tree/main/extensions/hello"` |
| `repository` | Where its source lives. An `https:` URL. | `"https://github.com/owner/repo"` |
| `license` | An SPDX licence id. | `"MIT"`, `"Apache-2.0"` |
| `capabilities` | What it reaches beyond what kb gives every extension. See below. | |
| `replaces` | [Provider role claims](#replacing-provider-roles). | |

kb works out two things itself, so a manifest never declares them:
- **origin**: built in, linked, the store's own folder, or installed;
- **source**: the marketplace, the GitHub path and the pinned commit.

## Capabilities

Each capability is one line on the review sheet and in the card's Details.

| Key | Shape | Declare | Reads as |
| --- | --- | --- | --- |
| `network` | `{ "hosts": string[] }` | Every host it calls, by name. | _reaches api.github.com_ |
| `storage` | `[{ "kind": "files" \| "database" \| "service", "what", "where" }]` | What it keeps outside kb's graph, and where. | _keeps its cache in its own files at ~/.cache/hello_ |
| `secrets` | `[{ "name", "why" }]` | Each secret by the name it reads it under, and why it needs it. | _needs GITHUB_TOKEN: to read private repositories_ |
| `data` | `{ "reads": string[], "writes": string[] }` | The kb data it reads and writes: tags, fields, node kinds, by name or id. | _reads #todo; writes status_ |
| `page` | `"none" \| "data" \| "drawing" \| "scene" \| "full"` | How much of the page its page half asks for. | _a canvas scene_ |
| `services` | `[{ "name", "what" }]` | What it runs in the background, without anyone asking. | _runs sync: pulls the calendar every 15 minutes_ |
| `approvals` | `string[]` | Its own actions that ask a person before they run. | _asks before hello.publish_ |

The page tiers come from the isolation research
([2026-11-08 §6](../research/2026-11-08-plugin-ui-isolation.md#6-recommendation-for-general-page-halves)):

| Tier | Means |
| --- | --- |
| `none` | It has no page half. |
| `data` | Declarations only: no code runs in the page. |
| `drawing` | It draws through kb's sandbox. |
| `scene` | A canvas scene, such as a backdrop. |
| `full` | Full page power: the page's DOM, storage and session. |

Declare the lowest tier the page half really needs. Today every page half
runs with `full` power whatever it declares (see above), so the tier is a
promise about what the code does, which a reviewer can check against it.

## What a marketplace listing needs

A listing needs:
- `description`, `author`, `license` and `repository`;
- **every** capability, declared, even when the answer is an empty list.

`homepage` is optional. `listingMissing` in the schema module is the one
statement of this list. Nothing checks a marketplace against it yet: that
check is KB-10's.

## Examples

An extension that calls one API with a token, and asks before it writes:

```json
{
  "description": "Files a GitHub issue from a node.",
  "author": "popemkt",
  "repository": "https://github.com/popemkt/kb-plugins-sample",
  "license": "MIT",
  "capabilities": {
    "network": { "hosts": ["api.github.com"] },
    "storage": [],
    "secrets": [{ "name": "GITHUB_TOKEN", "why": "to open issues as you" }],
    "data": { "reads": ["#todo"], "writes": ["issue"] },
    "page": "none",
    "services": [],
    "approvals": ["github-issue.file"]
  }
}
```

A backdrop, which is a page half and nothing else:

```json
{
  "description": "A slow tide behind the page head.",
  "author": "popemkt",
  "repository": "https://github.com/popemkt/kb-plugins-sample",
  "license": "MIT",
  "capabilities": {
    "network": { "hosts": [] },
    "storage": [],
    "secrets": [],
    "data": { "reads": [], "writes": [] },
    "page": "scene",
    "services": [],
    "approvals": []
  }
}
```

## Replacing provider roles

`replaces` is an optional manifest array. Each entry names a `role` and a
nonempty `why`, and may set a finite numeric `priority`. The [provider role contract](../../DESIGN.md#provider-roles)
owns admission, approval, election and recovery.

```json
{
  "replaces": [{"role": "ui.field-editor", "priority": 50, "why": "One-line field rows"}],
  "capabilities": {"page": "full"}
}
```

Put the claim in `<name>.manifest.json`, which kb reads before importing code;
it is not a property of the code's `declaration` export. A field-row provider
imports `provideFieldEditor` from `kb-ext-sdk/page` and calls it with its plugin
context and a React component. Its `FieldRowProps` carry the row's values, type
and writeability. Its `parse` callback uses kb's field-value parser; `update`
and `remove` use the host's normal checked write path. Reference values are
node ids; providers may resolve or edit them as their interface requires. The component runs with full page power.
