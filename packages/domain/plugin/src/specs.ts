import { Effect } from "effect";
import type { KernelSpec, PointSpec, KernelHost } from "./keys.ts";
import { refusal } from "./state.ts";

export const checkHost = Effect.fnUntraced(function* (
  owner: string,
  spec: KernelSpec,
  host: KernelHost,
) {
  const hosts = typeof spec.kernel === "string" ? [spec.kernel] : spec.kernel;
  if (!hosts.includes(host)) {
    return yield* refusal(
      owner,
      "wrong-kernel",
      `key requires ${hosts.join(" or ")}; this kernel is ${host}`,
    );
  }
  return undefined;
});

export const checkPointSpec = Effect.fnUntraced(function* (
  owner: string,
  spec: PointSpec,
  host: KernelHost,
) {
  yield* checkHost(owner, spec, host);
  if (spec.replaceable === true && spec.cardinality !== "single" && spec.cardinality !== "keyed")
    return yield* refusal(owner, "invalid-point", "only single or keyed points define roles");
  return undefined;
});
