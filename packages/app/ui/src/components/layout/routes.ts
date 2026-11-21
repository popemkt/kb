import { outlineLocationOf, type NoParams } from "@kb/views";

/**
 * `/` and `/outline/<id>`: where the page stands, unscoped (`outlineLocationOf`),
 * the home's route. Which node the page stands at follows the path
 * (`followOutlineLocation`), so the view itself takes no params; a scoped
 * location is the ontology's (`/o/<id>/outline`).
 */
export function matchHome(path: string): NoParams | null {
  return outlineLocationOf(path)?.ontology === null ? {} : null;
}
