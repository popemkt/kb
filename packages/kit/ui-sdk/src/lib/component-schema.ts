/**
 * What a point's contract reads as a component: the one check every page
 * point that holds something React draws (a backdrop's scene, a value
 * kind's surface and glyph) holds it to.
 */
import { Predicate, Schema } from "effect";
import type { ComponentType } from "react";

/** React's own tags for the components that are objects: `memo`, `forwardRef` and `lazy`. */
const EXOTIC: ReadonlySet<unknown> = new Set([
  Symbol.for("react.memo"),
  Symbol.for("react.forward_ref"),
  Symbol.for("react.lazy"),
]);

/** Anything React draws as a component: a function, or one of its exotic wrappers. */
export function componentSchema<P>() {
  return Schema.declare(
    (value: unknown): value is ComponentType<P> =>
      Predicate.isFunction(value) ||
      (Predicate.hasProperty(value, "$$typeof") && EXOTIC.has(value.$$typeof)),
    { expected: "a component (a function, memo or forwardRef)" },
  );
}
