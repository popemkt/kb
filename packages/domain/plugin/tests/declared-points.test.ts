import { describe, expect, test } from "bun:test";
import { Effect, Exit, Schema } from "effect";
import {
  definePlugin,
  makeKernel,
  Point,
  PointName,
  Service,
  type PointKey,
  type PointSpec,
} from "../src/index.ts";

const spec: PointSpec = {
  cardinality: "list",
  combine: "all in order",
  kernel: "registry",
  tier: "T0",
};
const Sources = PointName<string>()("quotes.sources");
const ReadSources = Service<() => readonly string[]>()("test.read-sources");
const owner = definePlugin({
  name: "quotes",
  apply: (ctx) =>
    Effect.gen(function* () {
      const point = yield* ctx.declare<string>("sources", spec);
      yield* ctx.provide(ReadSources, () => ctx.contributions(point).map(({ value }) => value));
    }),
});
const contributor = definePlugin({
  name: "contributor",
  uses: [Sources.name],
  apply: (ctx) =>
    Effect.gen(function* () {
      const point = yield* ctx.point(Sources);
      yield* ctx.contribute(point, { id: "one", value: "one" });
    }),
});
const run = Effect.runSync;

describe("declared points", () => {
  test("a named contributor waits, activates, and returns to pending when the owner leaves", () => {
    const kernel = makeKernel({ host: "registry" });
    run(kernel.load(contributor));
    expect(kernel.plugins()[0]?.status).toBe("pending");
    expect(kernel.plugins()[0]?.missing).toEqual([Sources.name]);
    expect(kernel.plugins()[0]?.error).toBeNull();
    run(kernel.load(owner));
    expect(kernel.service(ReadSources)?.()).toEqual(["one"]);
    expect(kernel.contributions(Sources).map(({ value }) => value)).toEqual(["one"]);
    expect(kernel.points().find(({ key }) => key.name === Sources.name)?.owner).toBe("quotes");
    run(kernel.unload(owner.name));
    expect(kernel.plugins()[0]?.status).toBe("pending");
    expect(kernel.contributions(Sources)).toEqual([]);
    run(kernel.load(owner));
    expect(kernel.service(ReadSources)?.()).toEqual(["one"]);
    run(kernel.shutdown);
  });

  test("services and points share waiting and transitive invalidation", () => {
    const kernel = makeKernel({ host: "registry" });
    const Ready = Service<boolean>()("test.ready");
    let applications = 0;
    const dependent = definePlugin({
      name: "both",
      inject: [Ready],
      uses: [Sources.name],
      apply: (ctx) =>
        Effect.gen(function* () {
          yield* ctx.get(Ready);
          yield* ctx.point(Sources);
          applications++;
        }),
    });
    run(kernel.load(dependent));
    run(kernel.load({ name: "service", apply: (ctx) => ctx.provide(Ready, true) }));
    expect(applications).toBe(0);
    run(kernel.load(owner));
    expect(applications).toBe(1);
    run(kernel.unload("service"));
    expect(kernel.plugins().find(({ name }) => name === "both")?.status).toBe("pending");
    run(kernel.load({ name: "service", apply: (ctx) => ctx.provide(Ready, true) }));
    expect(applications).toBe(2);
    run(kernel.unload(owner.name));
    expect(kernel.plugins().find(({ name }) => name === "both")?.status).toBe("pending");
    run(kernel.load(owner));
    expect(applications).toBe(3);
    run(kernel.shutdown);
  });

  test("names cannot escape their owner, and a second declaration is refused", () => {
    const kernel = makeKernel({ host: "registry" });
    const escape = {
      name: "stranger",
      apply: (ctx: Parameters<typeof owner.apply>[0]) =>
        ctx.declare("quotes.sources", spec).pipe(Effect.asVoid),
    };
    expect(Exit.isFailure(Effect.runSyncExit(kernel.load(escape)))).toBe(true);
    expect(kernel.plugins()[0]?.error?.reason).toBe("invalid-point");
    run(kernel.load(owner));
    const duplicate = definePlugin({
      name: "duplicate",
      namespace: "quotes",
      apply: (ctx) => ctx.declare("sources", spec).pipe(Effect.asVoid),
    });
    expect(Exit.isFailure(Effect.runSyncExit(kernel.load(duplicate)))).toBe(true);
    expect(kernel.plugins().find(({ name }) => name === "duplicate")?.error?.reason).toBe(
      "point-conflict",
    );
    run(kernel.shutdown);
  });

  test("resolving another point requires uses", () => {
    const kernel = makeKernel({ host: "registry" });
    run(kernel.load(owner));
    expect(
      Exit.isFailure(
        Effect.runSyncExit(
          kernel.load({
            name: "undeclared",
            apply: (ctx) => ctx.point(Sources).pipe(Effect.asVoid),
          }),
        ),
      ),
    ).toBe(true);
    expect(kernel.plugins().find(({ name }) => name === "undeclared")?.error?.reason).toBe(
      "not-used",
    );
    run(kernel.shutdown);
  });

  test("a failed owner leaves no declaration and puts its dependents back to pending", () => {
    const kernel = makeKernel({ host: "registry" });
    run(kernel.load(contributor));
    const failed = definePlugin({
      name: "quotes",
      apply: (ctx) =>
        Effect.gen(function* () {
          yield* ctx.declare("sources", spec);
          yield* ctx.plugin({
            name: "child",
            uses: [Sources.name],
            apply: (child) => child.point(Sources).pipe(Effect.asVoid),
          });
          throw new Error("after declaration");
        }),
    });
    expect(Exit.isFailure(Effect.runSyncExit(kernel.load(failed)))).toBe(true);
    expect(kernel.points()).toEqual([]);
    expect(kernel.plugins().find(({ name }) => name === "contributor")?.status).toBe("pending");
    run(kernel.shutdown);
  });

  test("contracts refuse malformed contributions atomically", async () => {
    const kernel = makeKernel({ host: "registry" });
    await Effect.runPromise(
      kernel.load({
        name: "quotes",
        apply: (ctx) =>
          ctx
            .declare("sources", { ...spec, contract: Schema.toStandardSchemaV1(Schema.String) })
            .pipe(Effect.asVoid),
      }),
    );
    const failed = await Effect.runPromiseExit(
      kernel.load({
        name: "bad",
        uses: [Sources.name],
        apply: (ctx) =>
          Effect.gen(function* () {
            const point = yield* ctx.point<unknown>(Sources.name);
            yield* ctx.contribute(point, { id: "valid", value: "first" });
            yield* ctx.contribute(point, { id: "invalid", value: 42 });
          }),
      }),
    );
    expect(Exit.isFailure(failed)).toBe(true);
    expect(kernel.plugins().find(({ name }) => name === "bad")?.error?.reason).toBe(
      "invalid-contribution",
    );
    expect(kernel.contributions(Sources)).toEqual([]);
    await Effect.runPromise(kernel.shutdown);
  });

  test("an asynchronous contract's decoded value is what the reader and contributor receive", async () => {
    const kernel = makeKernel({ host: "registry" });
    await Effect.runPromise(
      kernel.load({
        name: "quotes",
        apply: (ctx) =>
          ctx
            .declare("sources", {
              ...spec,
              contract: {
                "~standard": {
                  version: 1,
                  vendor: "test",
                  validate: async (input) =>
                    typeof input === "string"
                      ? { value: input.toUpperCase() }
                      : { issues: [{ message: "text required" }] },
                },
              },
            })
            .pipe(Effect.asVoid),
      }),
    );
    let returned = "";
    await Effect.runPromise(
      kernel.load({
        ...contributor,
        apply: (ctx) =>
          Effect.gen(function* () {
            const point = yield* ctx.point(Sources);
            returned = (yield* ctx.contribute(point, { id: "one", value: "decoded" })).value;
          }),
      }),
    );
    expect(returned).toBe("DECODED");
    expect(kernel.contributions(Sources)[0]?.value).toBe("DECODED");
    await Effect.runPromise(kernel.shutdown);
  });
});

test("named readers ignore undeclared static slots", () => {
  const kernel = makeKernel({ host: "registry" });
  const staticPoint = Point<string>()("quotes.sources", spec);
  run(
    kernel.load({
      name: "static",
      apply: (ctx) =>
        ctx.contribute(staticPoint, { id: "one", value: "hidden" }).pipe(Effect.asVoid),
    }),
  );
  expect(kernel.contributions(staticPoint)).toHaveLength(1);
  expect(kernel.contributions(Sources)).toEqual([]);
  run(kernel.shutdown);
});

test("a forged static key cannot pre-empt a declaration", () => {
  const kernel = makeKernel({ host: "registry" });
  const counterfeit = { kind: "point" as const, name: "quotes.sources", spec, declarer: null };
  expect(
    Exit.isFailure(
      Effect.runSyncExit(
        kernel.load({
          name: "stranger",
          apply: (ctx) =>
            ctx.contribute(counterfeit, { id: "one", value: "forged" }).pipe(Effect.asVoid),
        }),
      ),
    ),
  ).toBe(true);
  expect(kernel.plugins()[0]?.error?.reason).toBe("invalid-point");
  run(kernel.load(owner));
  expect(kernel.points().map(({ key }) => key.name)).toEqual([Sources.name]);
  run(kernel.shutdown);
});

test("children cannot change their declaring family's namespace", () => {
  const kernel = makeKernel({ host: "registry" });
  run(
    kernel.load({
      name: "stranger",
      namespace: "ext.stranger",
      apply: (ctx) =>
        ctx
          .plugin({
            name: "child",
            namespace: "graph",
            apply: (child) => child.declare("themes", spec).pipe(Effect.asVoid),
          })
          .pipe(Effect.asVoid),
    }),
  );
  expect(kernel.points().map(({ key }) => key.name)).toEqual(["ext.stranger.themes"]);
  expect(kernel.contributions(PointName<string>()("graph.themes"))).toEqual([]);
  run(kernel.shutdown);
});

test("declare refuses a point for another host", () => {
  const kernel = makeKernel({ host: "page" });
  expect(Exit.isFailure(Effect.runSyncExit(kernel.load(owner)))).toBe(true);
  expect(kernel.plugins()[0]?.error?.reason).toBe("wrong-kernel");
  expect(kernel.points()).toEqual([]);
  run(kernel.shutdown);
});

test("retired keys cannot be revived by a later contributor", () => {
  const kernel = makeKernel({ host: "registry" });
  let key: PointKey<string> | undefined;
  run(
    kernel.load({
      ...owner,
      apply: (ctx) =>
        Effect.gen(function* () {
          key = yield* ctx.declare<string>("sources", spec);
        }),
    }),
  );
  run(kernel.unload(owner.name));
  const stale = key;
  if (stale === undefined) throw new Error("declaration did not run");
  expect(
    Exit.isFailure(
      Effect.runSyncExit(
        kernel.load({
          name: "late",
          apply: (ctx) => ctx.contribute(stale, { id: "one", value: "late" }).pipe(Effect.asVoid),
        }),
      ),
    ),
  ).toBe(true);
  expect(kernel.plugins()[0]?.error?.reason).toBe("not-loaded");
  expect(kernel.points()).toEqual([]);
  run(kernel.load(owner));
  expect(kernel.points()[0]?.key).not.toBe(stale);
  run(kernel.shutdown);
});

test("synchronous contracts keep synchronous page activation", () => {
  const kernel = makeKernel({ host: "page" });
  run(
    kernel.load({
      name: "page",
      apply: (ctx) =>
        Effect.gen(function* () {
          const point = yield* ctx.declare<string>("values", {
            ...spec,
            kernel: "page",
            contract: Schema.toStandardSchemaV1(Schema.String),
          });
          const found = yield* ctx.point<string>("page.values");
          expect(found).toBe(point);
          yield* ctx.contribute(found, { id: "one", value: "synchronous" });
        }),
    }),
  );
  expect(kernel.contributions(PointName<string>()("page.values"))[0]?.value).toBe("synchronous");
  run(kernel.shutdown);
});

test("plugin callbacks receive no host record as their receiver", () => {
  const kernel = makeKernel({ host: "registry" });
  run(
    kernel.load({
      name: "callback",
      apply: function (this: unknown) {
        expect(this).toBeUndefined();
        return Effect.void;
      },
    }),
  );
  run(kernel.shutdown);
});
