/**
 * `@kb/themes-ui`: the themes family's browser half (DESIGN-UI.md → Design
 * tokens → Design systems, Themes): Paper and Terminal, each a sheet over
 * layer 1, and ZZZ and Transistor, each a sheet with its faces, its art and
 * its paired page head, contributed through `@kb/ui-sdk`. The page loads its entry, `themesUiPlugin`,
 * through `BROWSER_EXTENSIONS` under the family's declared name.
 */
export { themesUiPlugin } from "./plugin";
