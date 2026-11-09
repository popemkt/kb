import { expect, test } from "bun:test";
import {
  CORE_POINT_DEFINITIONS,
  CORE_POINT_NAMESPACES,
  ExtensionManifestSchema,
  capabilityLines,
  extensionAdmissionIssue,
  hostCapabilities,
  waitingForPoint,
  type ExtensionManifest,
} from "../src/index.ts";

const catalog = hostCapabilities([
  {
    name: "owner",
    label: "Owner",
    points: [
      {
        name: "owner.widgets",
        declared: true,
        spec: { cardinality: "list", combine: "all", kernel: "page", tier: "T3" },
      },
    ],
  },
]);
const request = (point: string, kernel: "registry" | "page" = "registry"): ExtensionManifest => ({
  uses: [{ point, kernel }],
  capabilities: { page: "full" },
});

test("native missing points are refused; absent third-party owners may arrive later", () => {
  for (const point of ["kb.future", "ui.future", "owner.future", "action/future", "tx/future"])
    expect(extensionAdmissionIssue("consumer", request(point), catalog)).toContain(
      "no point declared",
    );
  expect(extensionAdmissionIssue("consumer", request("ext.quotes.sources"), catalog)).toBeNull();
  expect(extensionAdmissionIssue("consumer", request("stranger.sources"), catalog)).toContain(
    "ext.<extension>",
  );
  expect(waitingForPoint("ext.a.dotted-family.sources")).toBe(
    "waiting for ext.a.dotted-family.sources from a.dotted-family",
  );
  expect(waitingForPoint("owner.widgets")).toBe("waiting for owner.widgets from owner");
});

test("point admission checks the requested kernel and tier before code runs", () => {
  expect(extensionAdmissionIssue("consumer", request("owner.widgets", "page"), catalog)).toBeNull();
  expect(extensionAdmissionIssue("consumer", request("owner.widgets"), catalog)).toContain(
    "requires page host",
  );
  expect(
    extensionAdmissionIssue("consumer", request("owner.widgets", "page"), catalog, ["registry"]),
  ).toContain("unsupported page");
  expect(
    extensionAdmissionIssue(
      "consumer",
      { ...request("owner.widgets", "page"), capabilities: { page: "drawing" } },
      catalog,
    ),
  ).toContain("capabilities.page: full");
  expect(extensionAdmissionIssue("consumer", request("ui.views", "page"), catalog)).toContain(
    "static SDK point",
  );
  expect(
    extensionAdmissionIssue(
      "consumer",
      { replaces: [{ role: "ui.views", why: "hijack" }] },
      catalog,
    ),
  ).toContain("no replaceable role");
});

test("manifest names and transaction matches decode without running code", () => {
  for (const point of [
    "",
    "ext.quotes",
    "ext.quotes.",
    "ext.quotes.sources/extra",
    "ui.bad name",
    "ui.bad:role",
  ])
    expect(ExtensionManifestSchema.safeParse(request(point)).success, point).toBe(false);
  expect(ExtensionManifestSchema.safeParse(request("ext.quotes.sources")).success).toBe(true);
  expect(ExtensionManifestSchema.safeParse(request("action/guard")).success).toBe(true);
  expect(
    ExtensionManifestSchema.safeParse({ replaces: [{ role: "ui.bad role", why: "bad" }] }).success,
  ).toBe(false);
  expect(
    ExtensionManifestSchema.safeParse({
      uses: [
        ...(request("ext.quotes.sources").uses ?? []),
        ...(request("ext.quotes.sources").uses ?? []),
      ],
    }).success,
  ).toBe(false);
  for (const match of [
    { unexpected: true },
    { tagged: [""] },
    { fields: "not a list" },
    { created: "yes" },
  ])
    expect(ExtensionManifestSchema.safeParse({ reacts: [match] }).success).toBe(false);
  expect(ExtensionManifestSchema.parse({ reacts: [{ tagged: ["tag.inbox"] }] }).reacts).toEqual([
    { tagged: ["tag.inbox"] },
  ]);
});

test("reacts requires the registry's after-commit point", () => {
  const manifest: ExtensionManifest = { reacts: [{ tagged: ["tag.inbox"] }] };
  expect(extensionAdmissionIssue("router", manifest, catalog, ["registry"])).toBeNull();
  expect(extensionAdmissionIssue("router", manifest, catalog, ["page"])).toContain(
    "requires registry",
  );
  expect(
    extensionAdmissionIssue("router", manifest, {
      ...catalog,
      points: catalog.points.filter(({ name }) => name !== CORE_POINT_DEFINITIONS.txAfter.name),
    }),
  ).toContain("tx/after is not supported");
});

test("manifest requirements describe the same data the host admits", () => {
  const lines = capabilityLines({
    ...request("ext.quotes.sources"),
    reacts: [{ tagged: ["tag.inbox"] }],
  });
  expect(lines.find(({ label }) => label === "Uses")?.text).toBe("ext.quotes.sources (registry)");
  expect(lines.find(({ label }) => label === "Reacts when")?.text).toBe("tagged tag.inbox");
});

test("every core point belongs to an explicitly reserved native namespace", () => {
  for (const { name } of Object.values(CORE_POINT_DEFINITIONS))
    expect(
      CORE_POINT_NAMESPACES.some(
        (namespace) => name.startsWith(`${namespace}.`) || name.startsWith(`${namespace}/`),
      ),
      name,
    ).toBe(true);
});
