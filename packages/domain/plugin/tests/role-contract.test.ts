import { describe, expect, test } from "bun:test";
import { Effect, Exit, Result, Schema } from "effect";
import {
  bindPluginAuthority,
  roleCall,
  roleSession,
  type RoleSession,
  makeKernel,
  Point,
  Role,
  Service,
  type PluginError,
  type Kernel,
  type Plugin,
  type PluginContext,
  type PointKey,
  type RoleKey,
} from "../src/index.ts";

const run = Effect.runSync;
const spec = { kernel: "registry", tier: "T3", replaceable: true } as const;

interface Fixture {
  readonly kernel: Kernel;
  readonly role: RoleKey<string>;
  readonly give: (
    ctx: PluginContext,
    value: string,
    replacement?: boolean,
  ) => Effect.Effect<unknown, PluginError>;
  readonly point?: PointKey<string>;
}

function fixture(kind: "service" | "single" | "keyed", session?: RoleSession): Fixture {
  const kernel = makeKernel({ host: "registry", roleSession: session });
  if (kind === "service") {
    const key = Service<string>()("contract.role", spec);
    return { kernel, role: Role(key), give: (ctx, value) => ctx.provide(key, value) };
  }
  const point = Point<string>()("contract.role", {
    ...spec,
    cardinality: kind,
    combine: "elected provider",
  });
  const role = Role(point, kind === "keyed" ? "stable" : undefined);
  return {
    kernel,
    role,
    point,
    give: (ctx, value, replace = false) =>
      ctx.contribute(point, {
        id: replace ? "candidate" : "stable",
        aliases: replace ? [] : ["old-name"],
        value,
        ...(replace && kind === "keyed" ? { replaces: role.name } : {}),
      }),
  };
}

function owner(f: Fixture): Plugin {
  return bindPluginAuthority(
    { name: "owner", namespace: "", apply: (ctx) => f.give(ctx, "default").pipe(Effect.asVoid) },
    {
      pointNamespace: "owner",
      source: "bundled",
      replacements: [],
      defaults: [{ role: f.role.name, provider: "owner" }],
    },
  );
}

function replacement(f: Fixture, value = "replacement", priority?: number): Plugin {
  return bindPluginAuthority(
    {
      name: "replacement",
      namespace: "",
      apply: (ctx) => f.give(ctx, value, true).pipe(Effect.asVoid),
    },
    {
      pointNamespace: "replacement",
      source: "bundled",
      digest: value,
      replacements: [{ role: f.role.name, ...(priority === undefined ? {} : { priority }) }],
      defaults: [],
    },
  );
}

class DomainFailure extends Schema.TaggedError<DomainFailure>()("DomainFailure", {}) {}

for (const kind of ["service", "single", "keyed"] as const) {
  describe(`role contract: ${kind}`, () => {
    test("the default is a candidate; an unapproved provider is refused", () => {
      const f = fixture(kind);
      run(f.kernel.load(owner(f)));
      expect(f.kernel.role(f.role)?.value).toBe("default");
      const attempt = run(
        Effect.exit(
          f.kernel.load({
            name: "unapproved",
            namespace: "",
            apply: (ctx) => f.give(ctx, "takeover", true).pipe(Effect.asVoid),
          }),
        ),
      );
      expect(Exit.isFailure(attempt)).toBe(true);
      expect(f.kernel.roles()[0]?.candidates).toHaveLength(1);
      expect(f.kernel.roles()[0]?.candidates[0]).toMatchObject({
        provider: "owner",
        priority: 100,
        default: true,
      });
      expect(f.kernel.role(f.role)?.value).toBe("default");
      run(f.kernel.shutdown);
    });

    test("a stranger cannot squat on the role before its owner loads", () => {
      const f = fixture(kind);
      const attempt = run(
        Effect.exit(
          f.kernel.load({
            name: "stranger",
            namespace: "",
            apply: (ctx) => f.give(ctx, "takeover").pipe(Effect.asVoid),
          }),
        ),
      );
      expect(Exit.isFailure(attempt)).toBe(true);
      expect(f.kernel.roles()).toEqual([]);
      run(f.kernel.load(owner(f)));
      expect(f.kernel.role(f.role)?.value).toBe("default");
      run(f.kernel.shutdown);
    });

    test("a failed apply publishes no candidate and leaves the default intact", () => {
      const f = fixture(kind);
      run(f.kernel.load(owner(f)));
      const plugin = replacement(f);
      const failed = bindPluginAuthority(
        {
          ...plugin,
          apply: (ctx) =>
            Effect.gen(function* () {
              yield* f.give(ctx, "partial", true);
              expect(f.kernel.role(f.role)?.value).toBe("default");
              return yield* Effect.die("apply failed");
            }),
        },
        {
          pointNamespace: "replacement",
          source: "bundled",
          replacements: [{ role: f.role.name }],
          defaults: [],
        },
      );
      expect(Exit.isFailure(run(Effect.exit(f.kernel.load(failed))))).toBe(true);
      expect(f.kernel.roles()[0]?.candidates).toHaveLength(1);
      expect(f.kernel.role(f.role)?.value).toBe("default");
      run(f.kernel.shutdown);
    });

    test("approval inspection reads the exact claim held by the loaded family", () => {
      const f = fixture(kind);
      run(f.kernel.load(owner(f)));
      expect(f.kernel.replacementApproved("owner", f.role.name)).toBe(false);
      expect(f.kernel.replacementApproved("replacement", f.role.name)).toBe(false);
      run(f.kernel.load(replacement(f)));
      expect(f.kernel.replacementApproved("replacement", f.role.name)).toBe(true);
      expect(
        f.kernel.roles()[0]?.candidates.find((candidate) => candidate.provider === "replacement")
          ?.priority,
      ).toBe(50);
      expect(f.kernel.replacementApproved("replacement", "ui.host")).toBe(false);
      run(f.kernel.unload("replacement"));
      expect(f.kernel.replacementApproved("replacement", f.role.name)).toBe(false);
      run(f.kernel.shutdown);
    });

    test("a child's approval is its family's claim, and not another family's", () => {
      const f = fixture(kind);
      run(f.kernel.load(owner(f)));
      const parent = bindPluginAuthority(
        {
          name: "replacement",
          namespace: "",
          apply: (ctx) =>
            ctx
              .plugin({
                name: "keys",
                apply: (child) => f.give(child, "child", true).pipe(Effect.asVoid),
              })
              .pipe(Effect.asVoid),
        },
        {
          pointNamespace: "replacement",
          source: "extension",
          digest: "trusted-code",
          replacements: [{ role: f.role.name }],
          defaults: [],
        },
      );
      run(f.kernel.load(parent));
      expect(f.kernel.role(f.role)?.value).toBe("child");
      expect(f.kernel.replacementApproved("replacement/keys", f.role.name)).toBe(true);
      expect(f.kernel.replacementApproved("owner", f.role.name)).toBe(false);
      run(f.kernel.unload("replacement"));
      expect(f.kernel.replacementApproved("replacement/keys", f.role.name)).toBe(false);
      run(f.kernel.shutdown);
    });

    test("a default owner cannot relabel itself as a replacement", () => {
      const f = fixture(kind);
      const attempt = bindPluginAuthority(
        {
          name: "owner",
          namespace: "",
          apply: (ctx) => f.give(ctx, "self replacement").pipe(Effect.asVoid),
        },
        {
          pointNamespace: "owner",
          source: "bundled",
          defaults: [{ role: f.role.name, provider: "owner" }],
          replacements: [{ role: f.role.name }],
        },
      );
      expect(Exit.isFailure(run(Effect.exit(f.kernel.load(attempt))))).toBe(true);
      expect(f.kernel.replacementApproved("owner", f.role.name)).toBe(false);
      expect(f.kernel.roles()).toEqual([]);
      run(f.kernel.unload("owner"));
      run(f.kernel.load(owner(f)));
      expect(f.kernel.role(f.role)?.default).toBe(true);
      run(f.kernel.shutdown);
    });

    test("priority elects, and the store chooses only among approved candidates", () => {
      const f = fixture(kind);
      run(f.kernel.load(owner(f)));
      run(f.kernel.load(replacement(f)));
      expect(f.kernel.role(f.role)?.value).toBe("replacement");
      run(f.kernel.configureRoles(new Map([[f.role.name, "owner"]])));
      expect(f.kernel.role(f.role)?.value).toBe("default");
      run(f.kernel.configureRoles(new Map([[f.role.name, "unapproved"]])));
      expect(f.kernel.role(f.role)?.value).toBe("replacement");
      expect(f.kernel.roles()[0]?.owner).toBe("owner");
      run(f.kernel.shutdown);
    });

    test("a fault re-elects once, survives unload, and clears for new provider code", () => {
      const f = fixture(kind);
      run(f.kernel.load(owner(f)));
      const candidate = replacement(f);
      run(f.kernel.load(candidate));
      const bad = f.kernel.role(f.role);
      if (bad === undefined) throw new Error("provider present");
      expect(run(f.kernel.fault(f.role, bad, new Error("broken")))).toBe(true);
      expect(run(f.kernel.fault(f.role, bad, "again"))).toBe(false);
      expect(f.kernel.role(f.role)?.value).toBe("default");
      expect(
        f.kernel.roles()[0]?.candidates.find(({ provider }) => provider === "replacement")?.fault,
      ).toBe("broken");
      run(f.kernel.unload("replacement"));
      run(f.kernel.load(candidate));
      expect(f.kernel.role(f.role)?.value).toBe("default");
      run(f.kernel.unload("replacement"));
      run(f.kernel.load(replacement(f, "new code")));
      expect(f.kernel.role(f.role)?.value).toBe("new code");
      run(f.kernel.shutdown);
    });

    test("the default remains the floor when its own call fails", async () => {
      const f = fixture(kind);
      run(f.kernel.load(owner(f)));
      const floor = f.kernel.role(f.role);
      if (floor === undefined) throw new Error("default present");
      expect(run(f.kernel.fault(f.role, floor, "bad row"))).toBe(false);
      const outcome = await Effect.runPromise(
        Effect.exit(roleCall(f.kernel, f.role, () => Effect.die("default failure"), 50)),
      );
      expect(Exit.isFailure(outcome)).toBe(true);
      expect(f.kernel.role(f.role)?.value).toBe("default");
      expect(f.kernel.roles()[0]?.candidates[0]?.fault).toBeNull();
      run(f.kernel.shutdown);
    });

    test("a throwing provider falls back through the consuming call", async () => {
      const f = fixture(kind);
      run(f.kernel.load(owner(f)));
      run(f.kernel.load(replacement(f)));
      const result = await Effect.runPromise(
        roleCall(
          f.kernel,
          f.role,
          (value) =>
            value === "replacement"
              ? Effect.die(new Error("throwing provider"))
              : Effect.succeed(value),
          50,
        ),
      );
      expect(result).toBe("default");
      expect(f.kernel.roles()[0]?.elected).toBe("owner");
      run(f.kernel.shutdown);
    });

    test("an overrun falls back, while ordinary typed failures do not demote", async () => {
      const f = fixture(kind);
      run(f.kernel.load(owner(f)));
      run(f.kernel.load(replacement(f)));
      const typed = await Effect.runPromise(
        Effect.result(roleCall(f.kernel, f.role, () => Effect.fail(new DomainFailure()), 50)),
      );
      expect(Result.isFailure(typed)).toBe(true);
      expect(f.kernel.roles()[0]?.elected).toBe("replacement");
      const result = await Effect.runPromise(
        roleCall(
          f.kernel,
          f.role,
          (value) => (value === "replacement" ? Effect.never : Effect.succeed(value)),
          1,
        ),
      );
      expect(result).toBe("default");
      run(f.kernel.shutdown);
    });

    test("owner removal and return preserve the role and its approved candidate", () => {
      const f = fixture(kind);
      const initial = owner(f);
      run(f.kernel.load(initial));
      run(f.kernel.load(replacement(f)));
      run(f.kernel.unload("owner"));
      expect(f.kernel.role(f.role)?.value).toBe("replacement");
      if (f.point !== undefined)
        expect(f.kernel.lookup(f.point, "stable")).toMatchObject({
          id: "stable",
          value: "replacement",
        });
      run(f.kernel.load(initial));
      expect(f.kernel.roles()[0]?.candidates.some((candidate) => candidate.default)).toBe(true);
      if (f.point !== undefined)
        expect(f.kernel.lookup(f.point, "old-name")?.value).toBe("replacement");
      run(f.kernel.shutdown);
    });
  });
}

test("election changes reapply an injected service's consumers", () => {
  const f = fixture("service");
  let seen = "";
  let applied = 0;
  const key = f.role.key;
  if (key.kind !== "service") throw new Error("service fixture");
  run(f.kernel.load(owner(f)));
  run(
    f.kernel.load({
      name: "consumer",
      inject: [key],
      apply: (ctx) =>
        Effect.gen(function* () {
          seen = yield* ctx.get(key);
          applied++;
        }),
    }),
  );
  expect(seen).toBe("default");
  run(f.kernel.load(replacement(f)));
  expect(seen).toBe("replacement");
  run(f.kernel.configureRoles(new Map([[f.role.name, "owner"]])));
  expect(seen).toBe("default");
  expect(applied).toBe(3);
  run(f.kernel.shutdown);
});

test("fault identity survives kernel reconstruction and rejects stale failures", () => {
  const session = roleSession();
  const first = fixture("service", session);
  run(first.kernel.load(owner(first)));
  run(first.kernel.load(replacement(first)));
  const stale = first.kernel.role(first.role);
  if (stale === undefined) throw new Error("candidate present");
  run(first.kernel.fault(first.role, stale, "bad code"));
  run(first.kernel.shutdown);
  const next = fixture("service", session);
  run(next.kernel.load(owner(next)));
  run(next.kernel.load(replacement(next)));
  expect(next.kernel.role(next.role)?.value).toBe("default");
  run(next.kernel.unload("replacement"));
  run(next.kernel.load(replacement(next, "new code")));
  expect(run(next.kernel.fault(next.role, stale, "late failure"))).toBe(false);
  expect(next.kernel.role(next.role)?.value).toBe("new code");
  run(next.kernel.shutdown);
});

test("a fabricated service key cannot occupy a host role with its owner absent", () => {
  const f = fixture("service");
  const counterfeit = Service<string>()(f.role.name);
  const attempt = run(
    Effect.exit(
      f.kernel.load({ name: "stranger", apply: (ctx) => ctx.provide(counterfeit, "takeover") }),
    ),
  );
  expect(Exit.isFailure(attempt)).toBe(true);
  expect(f.kernel.service(counterfeit)).toBeUndefined();
  run(f.kernel.load(owner(f)));
  expect(f.kernel.role(f.role)?.value).toBe("default");
  run(f.kernel.shutdown);
});
