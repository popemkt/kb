/**
 * What an extension says about itself (docs/extensions/README.md, the one
 * home of what each field means): one line on what it adds, who wrote it,
 * where it lives, its licence, and what it reaches beyond the graph. A
 * repository extension keeps it in `<name>.manifest.json` beside its entry,
 * data kb reads without running anything, so a person sees it before they
 * trust the code, and its bytes are in the digest they trust; a bundled
 * family declares the same shape in its declaration. A field left out is
 * not declared, which is not the same as declaring none: an empty list says
 * "nothing", an absent one says nothing at all.
 */
import { z } from "zod";
import { KERNEL_HOSTS } from "@kb/plugin";
import { PointNameSchema, RoleNameSchema } from "./point-names.ts";
import { TxMatchSchema, describeTxMatch } from "./tx-match.ts";
export { MANIFEST_SUFFIX } from "@kb/extension-source";

const Words = z.string().trim().min(1);

/** How much of the page an extension's page half asks for, by the isolation tiers (docs/research/2026-11-08-plugin-ui-isolation.md §6). */
export const PAGE_TIERS = ["none", "data", "drawing", "scene", "full"] as const;
export type PageTier = (typeof PAGE_TIERS)[number];

/** The tiers that run code in the page: an extension with a page half declares one of them. */
export const PAGE_CODE_TIERS: readonly PageTier[] = ["drawing", "scene", "full"];

export const ExtensionCapabilitiesSchema = z.strictObject({
  /** The hosts it reaches over the network; empty for none. */
  network: z.strictObject({ hosts: z.array(Words) }).optional(),
  /** What it keeps outside kb's graph, and where: its own files, a database, a service. */
  storage: z
    .array(
      z.strictObject({ kind: z.enum(["files", "database", "service"]), what: Words, where: Words }),
    )
    .optional(),
  /** The secrets it needs, each by the name it reads it under, and why. */
  secrets: z.array(z.strictObject({ name: Words, why: Words })).optional(),
  /** The kb data it reads and writes: tags, fields, node kinds, by name or id. */
  data: z.strictObject({ reads: z.array(Words), writes: z.array(Words) }).optional(),
  /** How much of the page its page half asks for. */
  page: z.enum(PAGE_TIERS).optional(),
  /** What it runs in the background, unasked: a sync, a watcher, a timer. */
  services: z.array(z.strictObject({ name: Words, what: Words })).optional(),
  /** The actions of its own that ask a person before they run. */
  approvals: z.array(Words).optional(),
});

const RoleReplacementSchema = z.strictObject({
  role: RoleNameSchema,
  priority: z.number().optional(),
  why: Words,
});

const RoleReplacementsSchema = z
  .array(RoleReplacementSchema)
  .refine((claims) => new Set(claims.map(({ role }) => role)).size === claims.length, {
    message: "a replacement role may not be declared more than once",
  });

const PointUseSchema = z.strictObject({
  point: PointNameSchema,
  kernel: z.enum(KERNEL_HOSTS),
});
export type PointUse = z.infer<typeof PointUseSchema>;

const PointUsesSchema = z
  .array(PointUseSchema)
  .refine(
    (uses) => new Set(uses.map(({ point, kernel }) => `${kernel}:${point}`)).size === uses.length,
    { message: "a point use may be declared once per kernel" },
  );

const HttpsUrl = z.url({ protocol: /^https$/ });

export const ExtensionManifestSchema = z.strictObject({
  description: Words.optional(),
  author: Words.optional(),
  homepage: HttpsUrl.optional(),
  repository: HttpsUrl.optional(),
  /** An SPDX licence id: `MIT`, `Apache-2.0`. */
  license: Words.optional(),
  capabilities: ExtensionCapabilitiesSchema.optional(),
  /** The roles this digest asks to replace, checked before its code is imported. */
  replaces: RoleReplacementsSchema.optional(),
  /** Named point dependencies, scoped to the half that needs them. */
  uses: PointUsesSchema.optional(),
  /** Local transaction matches; requires the registry after-commit capability. */
  reacts: z.array(TxMatchSchema).optional(),
});
export type ExtensionManifest = z.infer<typeof ExtensionManifestSchema>;

/** What a marketplace listing needs declared, as docs/extensions/README.md → Listing says. */
const LISTED = ["description", "author", "license", "repository"] as const;
/** Every capability, in the schema's order: the schema is their one list. */
const CAPABILITIES = ExtensionCapabilitiesSchema.keyof().options;

/** The fields a manifest leaves undeclared that a marketplace listing needs, in reading order. */
export function listingMissing(manifest: ExtensionManifest | undefined): readonly string[] {
  return [
    ...LISTED.filter((field) => manifest?.[field] === undefined),
    ...CAPABILITIES.filter((field) => manifest?.capabilities?.[field] === undefined).map(
      (field) => `capabilities.${field}`,
    ),
  ];
}

/** One capability in plain words; `said` is false where the manifest does not declare it. */
export interface CapabilityLine {
  readonly label: string;
  readonly text: string;
  readonly said: boolean;
}

const NOT_DECLARED = "not declared";

function listed(items: readonly string[], none: string, some: (all: string) => string): string {
  return items.length === 0 ? none : some(items.join(", "));
}

const STORAGE_KIND: Readonly<Record<"files" | "database" | "service", string>> = {
  files: "its own files",
  database: "a database",
  service: "a service",
};

const PAGE_WORDS: Readonly<Record<PageTier, string>> = {
  none: "no page half",
  data: "declarations only: no code in the page",
  drawing: "draws through kb's sandbox",
  scene: "a canvas scene",
  full: "full page power: the page's DOM, storage and session",
};

/**
 * Each capability of `manifest` as a line a person reads, in the manifest's
 * order: what it reaches, keeps, needs, reads and writes, asks of the page,
 * runs, and asks approval for; "not declared" where it says nothing.
 */
export function capabilityLines(
  manifest: ExtensionManifest | undefined,
): readonly CapabilityLine[] {
  const said = manifest?.capabilities ?? {};
  const line = <T>(label: string, value: T | undefined, words: (value: T) => string) =>
    value === undefined
      ? { label, text: NOT_DECLARED, said: false }
      : { label, text: words(value), said: true };
  return [
    line("Network", said.network, ({ hosts }) =>
      listed(hosts, "no network access", (all) => `reaches ${all}`),
    ),
    line("Storage", said.storage, (stores) =>
      stores.length === 0
        ? "keeps nothing outside kb's graph"
        : stores
            .map(({ kind, what, where }) => `keeps ${what} in ${STORAGE_KIND[kind]} at ${where}`)
            .join("; "),
    ),
    line("Secrets", said.secrets, (secrets) =>
      secrets.length === 0
        ? "needs no secrets"
        : secrets.map(({ name, why }) => `needs ${name}: ${why}`).join("; "),
    ),
    line("kb data", said.data, ({ reads, writes }) =>
      reads.length === 0 && writes.length === 0
        ? "reads and writes no kb data"
        : [
            listed(reads, "reads nothing", (all) => `reads ${all}`),
            listed(writes, "writes nothing", (all) => `writes ${all}`),
          ].join("; "),
    ),
    line("Page", said.page, (tier) => PAGE_WORDS[tier]),
    line("Background", said.services, (services) =>
      services.length === 0
        ? "runs nothing in the background"
        : services.map(({ name, what }) => `runs ${name}: ${what}`).join("; "),
    ),
    line("Approvals", said.approvals, (actions) =>
      listed(actions, "asks before none of its actions", (all) => `asks before ${all}`),
    ),
    ...(manifest?.uses === undefined
      ? []
      : [
          line("Uses", manifest.uses, (uses) =>
            uses.length === 0
              ? "no declared points"
              : uses.map(({ point, kernel }) => `${point} (${kernel})`).join("; "),
          ),
        ]),
    ...(manifest?.reacts === undefined
      ? []
      : [
          line("Reacts when", manifest.reacts, (matches) =>
            matches.length === 0
              ? "no local transaction changes"
              : matches.map(describeTxMatch).join("; "),
          ),
        ]),
  ];
}
