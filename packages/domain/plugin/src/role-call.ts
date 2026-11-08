import { Cause, Effect, Exit } from "effect";
import type { Kernel } from "./kernel.ts";
import type { RoleKey } from "./keys.ts";
import { refusal } from "./state.ts";

function faultsProvider<E>(cause: Cause.Cause<E>): boolean {
  return Cause.hasDies(cause) || Cause.isTimeoutError(Cause.squash(cause));
}

/** Call the current provider; a defect or budget overrun retries once after demotion. */
export const roleCall = Effect.fn("plugin.roleCall")(function* <C, A, E, R>(
  kernel: Kernel,
  role: RoleKey<C>,
  invoke: (provider: C) => Effect.Effect<A, E, R>,
  budgetMs: number,
) {
  let remaining = 1;
  for (;;) {
    const provider = kernel.role(role);
    if (provider === undefined)
      return yield* refusal(role.name, "not-loaded", `role ${role.name} has no usable provider`);
    const result = yield* Effect.exit(
      Effect.suspend(() => invoke(provider.value)).pipe(Effect.timeout(budgetMs)),
    );
    if (Exit.isSuccess(result)) return result.value;
    if (!faultsProvider(result.cause)) return yield* Effect.failCause(result.cause);
    if (provider.default) return yield* Effect.failCause(result.cause);
    yield* kernel.fault(role, provider, Cause.squash(result.cause));
    if (remaining-- === 0 || kernel.role(role) === undefined)
      return yield* Effect.failCause(result.cause);
  }
});
