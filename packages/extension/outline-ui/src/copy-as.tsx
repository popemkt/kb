/**
 * The Copy as… dialog's host, drawn once for the page (DESIGN-UI.md →
 * Outline editor, "Copy, cut and Copy as…"). The dialog's code loads when
 * it first opens.
 */
import { lazy, Suspense } from "react";
import { closeCopyAs, useCopyAs } from "./copy-as-state";

const CopyAsDialog = lazy(() => import("./copy-as-dialog"));

/** The dialog, while it is open. */
export function CopyAsHost() {
  const rows = useCopyAs((s) => s.rows);
  if (rows === null) return null;
  return (
    <Suspense fallback={null}>
      <CopyAsDialog rows={rows} onClose={closeCopyAs} />
    </Suspense>
  );
}
