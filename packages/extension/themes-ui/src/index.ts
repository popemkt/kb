/**
 * `@kb/themes-ui`: the themes family's browser half (DESIGN-UI.md → Design
 * tokens → Design systems): Paper and Terminal, each a sheet over layer 1,
 * contributed through `@kb/ui-sdk`. A whole theme is a family of its own
 * (`@kb/zzz-ui`, `@kb/transistor-ui`, `@kb/yorha-ui`). The page loads this
 * entry, `themesUiPlugin`, through `BROWSER_EXTENSIONS` under the family's
 * declared name.
 */
export { themesUiPlugin } from "./plugin";
