# hello — the extension template

Copy this folder to `extensions/<name>/` in your repository, rename both
files to `<name>.ts` and `<name>.manifest.json`, and change `name` in the
declaration to match. What each manifest field means, and which ones a
marketplace listing needs, is [docs/extensions](../README.md).

- `hello.ts` is the server entry: its declaration and its plugin.
- `hello.manifest.json` is what it says about itself. Every field is
  declared, so a marketplace can list it as it is.

A page half would be `hello.page.tsx` beside it, and its manifest would
then declare a page tier of `drawing`, `scene` or `full`.
