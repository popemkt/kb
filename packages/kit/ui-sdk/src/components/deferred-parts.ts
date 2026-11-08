/**
 * The kit's parts that only some surfaces draw, each exported deferred
 * (`deferred`): the kit's barrel is the page's host module, so a part
 * exported whole is in the page's eager bundle on every visit, drawn or not
 * (DESIGN-UI.md → Delivery).
 */
import { deferred } from "./deferred";

/** The one knob control (`knob-control.tsx`): a lab study's info card and a backdrop's knobs draw it. */
export const KnobControl = deferred(() => import("./knob-control").then((m) => m.KnobControl));
