import { lazy, Suspense } from "react";
import type { ViewProps } from "@kb/ui-sdk";
import type { ProcedureParams } from "@kb/views";
const Body = lazy(() =>
  import("./procedure-page").then((module) => ({ default: module.ProcedurePage })),
);
export function ProcedureSurface(props: ViewProps<ProcedureParams>) {
  return (
    <Suspense fallback={null}>
      <Body {...props} />
    </Suspense>
  );
}
