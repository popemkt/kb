import { Schema } from "effect";
import { viewKey } from "./view-key.ts";

/** A procedure is addressed by its contributed identity, on every surface. */
export const ProcedureParams = Schema.Struct({ id: Schema.String }).annotate({
  description: "The registered procedure identity whose checked steps and actions this page shows.",
});
export type ProcedureParams = typeof ProcedureParams.Type;
export const ProcedureView = viewKey("procedure.page", "Procedure", ProcedureParams);
