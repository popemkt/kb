import { createElement, useSyncExternalStore, type ComponentType } from "react";
import { Effect } from "effect";
import { asKeyType, type Kernel, type RoleKey, type RoleCandidate } from "@kb/plugin";
import { ViewErrorBoundary } from "../components/view-error-boundary";
import { toast } from "./toast";

const renderers = new WeakMap<Kernel, WeakMap<object, Map<string, unknown>>>();
const generations = new WeakMap<object, number>();
let sequence = 0;

function generation(identity: object): number {
  let number = generations.get(identity);
  if (number === undefined) {
    number = ++sequence;
    generations.set(identity, number);
  }
  return number;
}

function roleReader<C>(kernel: Kernel, role: RoleKey<C>): () => RoleCandidate<C> | undefined {
  let version = -1;
  let snapshot: RoleCandidate<C> | undefined;
  return () => {
    if (kernel.version() !== version) {
      version = kernel.version();
      const next = kernel.role(role);
      if (
        next?.identity !== snapshot?.identity ||
        next?.value !== snapshot?.value ||
        next?.provider !== snapshot?.provider ||
        next?.owner !== snapshot?.owner
      )
        snapshot = next;
    }
    return snapshot;
  };
}

/** One stable component per role; the elected implementation stays inside the shared boundary. */
export function roleComponent<P extends object>(
  kernel: Kernel,
  role: RoleKey<ComponentType<P>>,
): ComponentType<P> {
  let cache = renderers.get(kernel);
  if (cache === undefined) {
    cache = new WeakMap();
    renderers.set(kernel, cache);
  }
  let forKey = cache.get(role.key);
  if (forKey === undefined) {
    forKey = new Map();
    cache.set(role.key, forKey);
  }
  const known = forKey.get(role.name);
  if (known !== undefined) return asKeyType(role, known);
  const read = roleReader(kernel, role);
  function RoleComponent(props: P) {
    const candidate = useSyncExternalStore(kernel.subscribe, read, read);
    if (candidate === undefined) return null;
    return (
      <ViewErrorBoundary
        resetKey={String(generation(candidate.identity))}
        fallback={candidate.default ? undefined : null}
        onError={(cause) => {
          void Effect.runPromise(kernel.fault(role, candidate, cause)).then((faulted) => {
            if (faulted) toast(`${candidate.provider} failed to render.`);
          });
        }}
      >
        {createElement(candidate.value, props)}
      </ViewErrorBoundary>
    );
  }
  forKey.set(role.name, RoleComponent);
  return RoleComponent;
}
