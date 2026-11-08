/**
 * The Settings page, in parts (DESIGN-UI.md → Settings): General,
 * Appearance, Extensions and Advanced, each a list of sections that fold.
 * Every extension node's settings are drawn as `settingsOf` reads them,
 * each with the page's field editor; each extension's card (its status,
 * its source, its actions and its details) is drawn in its section, the
 * installed ones before kb's own; a filter reads across every part.
 */
import { BUNDLED_DECLARATIONS } from "@kb/bundled";
import { ExtensionAdd, RetainedExtension } from "./extension-controls";
import { ExtensionDetails } from "./extension-card";
import {
  DEFAULT_BACKDROP_STRENGTH,
  MOTION_EFFECTS,
  MOTION_FIELD_IDS,
  MOTION_OPTION_SETTINGS,
  SYSTEM_IDS,
  extensionNodeId,
  motionEffectFieldId,
  settingsOf,
  type MotionChoice,
  type MotionSource,
  type NodeId,
  type Setting,
} from "@kb/model";
import {
  browserHost,
  type EnumOption,
  EnumSelect,
  getPath,
  type GraphRead,
  navigate,
  POPOVER_VALUE_CLASS,
  PrefFieldRow,
  replacePath,
  THEME_GLYPHS,
  type ThemePref,
  useGraphRead,
  usePageBackdrop,
  type PageBackdropChoice,
  useShownDesignSystem,
  type WidthPref,
} from "@kb/ui-sdk";
import { SETTINGS_PARTS, type SettingsPart } from "@kb/views";
import { ArrowsHorizontalIcon, SidebarSimpleIcon } from "@phosphor-icons/react";
import { useEffect, useState, type ReactNode } from "react";
import {
  extensionShelf,
  useExtensionReport,
  useMarketplaces,
  type MarketplaceReading,
  type PanelExtension,
  type PanelReport,
} from "@/lib/extension-report";
import { PART_WORDS, settingsPartOf, settingsPath } from "@/lib/settings-parts";
import { useMotionStore } from "@/stores/motion.store";
import { usePrefsStore } from "@/stores/prefs.store";
import {
  ExtensionAside,
  ExtensionCaption,
  ExtensionLede,
  PartLink,
  ReportStatus,
} from "./settings-extensions";
import {
  Fold,
  Groups,
  SettingRow,
  type Row,
  type Section,
  type SectionGroup,
} from "./settings-fold";

const CORE = extensionNodeId("core");

const THEME_OPTIONS: readonly EnumOption<ThemePref>[] = [
  { value: "system", label: "system" },
  { value: "light", label: "light" },
  { value: "dark", label: "dark" },
];
const WIDTH_OPTIONS: readonly EnumOption<WidthPref>[] = [
  { value: "centered", label: "centered" },
  { value: "full", label: "full" },
];
const SIDEBAR_OPTIONS: readonly EnumOption<"open" | "closed">[] = [
  { value: "open", label: "open" },
  { value: "closed", label: "closed" },
];
/** A core setting as its section draws it: the field, and the word the row says. */
interface CoreRow {
  readonly field: NodeId;
  readonly label: string;
}

/** "hoverLift" as a row says it. */
const words = (id: string): string => id.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();

/**
 * How Appearance groups core's settings: the page's own arrangement of
 * core's node, as the shell is core's. A setting of core's no group names
 * is drawn in General, under *Other settings*.
 */
const CORE_GROUPS: readonly {
  readonly id: string;
  readonly title: string;
  readonly caption?: string;
  readonly rows: readonly CoreRow[];
}[] = [
  {
    id: "theme",
    title: "Theme",
    caption: "this kb",
    rows: [{ field: SYSTEM_IDS.designSystemField, label: "theme" }],
  },
  {
    id: "page-head",
    title: "Page head",
    rows: [
      { field: SYSTEM_IDS.backdropField, label: "backdrop" },
      { field: SYSTEM_IDS.backdropStrengthField, label: "strength" },
      { field: SYSTEM_IDS.backdropDirectionField, label: "direction" },
      { field: SYSTEM_IDS.backdropArtField, label: "art" },
      { field: SYSTEM_IDS.backdropVariantField, label: "variants" },
    ],
  },
  {
    id: "motion",
    title: "Motion",
    caption: "each unset value follows the theme",
    rows: MOTION_OPTION_SETTINGS.map((setting) => ({
      field: MOTION_FIELD_IDS[setting],
      label: setting,
    })),
  },
  {
    id: "effects",
    title: "Effects",
    rows: MOTION_EFFECTS.map((effect) => ({
      field: motionEffectFieldId(effect),
      label: words(effect),
    })),
  },
];

/** Every motion field of core's: the four option settings and each effect. */
const MOTION_FIELDS: readonly NodeId[] = [
  ...MOTION_OPTION_SETTINGS.map((setting) => MOTION_FIELD_IDS[setting]),
  ...MOTION_EFFECTS.map(motionEffectFieldId),
];

/** A value in force, and where it comes from. */
interface InForceValue {
  readonly value: string;
  readonly source: MotionSource;
}

/** Clear every motion setting core's node holds, one after another, so the theme's preset applies. */
function resetMotion(props: Readonly<Record<NodeId, readonly unknown[]>>): Promise<void> {
  return MOTION_FIELDS.filter((field) => (props[field]?.length ?? 0) > 0).reduce<Promise<void>>(
    (previous, field) => previous.then(() => browserHost().writes.removeProp(CORE, field)),
    Promise.resolve(),
  );
}

/** The value in force for each motion field, and where it comes from. */
function inForceOf(choice: MotionChoice): ReadonlyMap<NodeId, InForceValue> {
  const options = MOTION_OPTION_SETTINGS.map((setting): [NodeId, InForceValue] => [
    MOTION_FIELD_IDS[setting],
    { value: choice.settings[setting], source: choice.sources[setting] },
  ]);
  const effects = MOTION_EFFECTS.map((effect): [NodeId, InForceValue] => [
    motionEffectFieldId(effect),
    {
      value: choice.settings.effects[effect] ? "on" : "off",
      source: choice.sources.effects[effect],
    },
  ]);
  return new Map([...options, ...effects]);
}

/**
 * A motion setting's value in force, in words, and where it came from. A
 * setting core's node does not hold says so first, since its row shows
 * nothing stored (an unset checkbox reads as off) while a value applies.
 */
function inForceWords(value: string, source: MotionSource, theme: string): string {
  switch (source) {
    case "explicit":
      return `${value} · set here`;
    case "theme":
      return `unset here · ${value} from ${theme}`;
    case "default":
      return `unset here · ${value} by default`;
    default:
      return source satisfies never;
  }
}

/** The settings of every extension node under `sys.extensions`, in that list's order. */
function useExtensionNodes(
  graph: GraphRead,
): readonly { id: NodeId; label: string; settings: readonly Setting[] }[] {
  return (graph.schema.get(SYSTEM_IDS.extensionsRoot)?.children ?? []).flatMap((id) => {
    const node = graph.schema.get(id);
    if (node === undefined) return [];
    const settings = settingsOf(graph.schema.values(), (other) => graph.schema.get(other), id);
    return [{ id, label: node.text, settings }];
  });
}

/**
 * Which part shows: the route's, else the first. Shown under a path the
 * page had before it was in parts (`/extensions`), it puts the part's own
 * path in the address bar instead.
 */
function usePart(part: SettingsPart | undefined): SettingsPart {
  const shown = part ?? SETTINGS_PARTS[0];
  useEffect(() => {
    const path = getPath();
    if (settingsPartOf(path) === shown && path !== settingsPath(shown)) {
      replacePath(settingsPath(shown));
    }
  }, [shown]);
  return shown;
}

export function SettingsPage({ part }: { readonly part?: SettingsPart }) {
  const shown = usePart(part);
  const [query, setQuery] = useState("");
  const graph = useGraphRead();
  const { report, reread } = useExtensionReport();
  const markets = useMarketplaces();
  const nodes = useExtensionNodes(graph);
  const coreSettings = nodes.find((node) => node.id === CORE)?.settings ?? [];
  const coreRow = useCoreRow(graph, coreSettings);
  const groups: Readonly<Record<SettingsPart, readonly SectionGroup[]>> = {
    general: [{ id: "general", sections: generalSections(graph, coreSettings, coreRow) }],
    appearance: [{ id: "appearance", sections: appearanceSections(graph, coreRow) }],
    extensions: extensionGroups(graph, nodes, report, markets),
    advanced: [{ id: "advanced", sections: advancedSections(report) }],
  };
  const flat = (of: SettingsPart) => groups[of].flatMap((group) => group.sections);
  const sections: Readonly<Record<SettingsPart, readonly Section[]>> = {
    general: flat("general"),
    appearance: flat("appearance"),
    extensions: flat("extensions"),
    advanced: flat("advanced"),
  };
  const read = typeof report === "object" && report !== null ? report : null;
  const needle = query.trim().toLowerCase();
  const status = <ReportStatus report={report} reread={reread} />;
  return (
    <div
      className="mx-auto grid max-w-5xl gap-x-8 px-4 py-6 md:grid-cols-[10rem_minmax(0,1fr)]"
      data-testid="settings-page"
    >
      <nav aria-label="Settings parts" className="mb-4 flex gap-1 md:mb-0 md:flex-col">
        {SETTINGS_PARTS.map((id) => (
          <button
            key={id}
            type="button"
            aria-current={id === shown && needle === "" ? "page" : undefined}
            data-settings-part-link={id}
            className="rounded-md px-2.5 py-1 text-left text-ui text-muted-foreground hover:bg-foreground/5 hover:text-foreground aria-[current=page]:bg-foreground/8 aria-[current=page]:text-foreground"
            onClick={() => {
              setQuery("");
              navigate(settingsPath(id));
            }}
          >
            {PART_WORDS[id].label}
          </button>
        ))}
      </nav>
      <div className="min-w-0">
        <h2 className="kb-display text-title font-medium text-foreground">
          {needle === "" ? PART_WORDS[shown].label : "Settings"}
        </h2>
        <p className="mt-1 mb-3 max-w-xl text-meta text-muted-foreground">
          {needle === ""
            ? PART_WORDS[shown].lede
            : "Every part's sections and rows that match, each part titled."}
        </p>
        <input
          type="search"
          aria-label="Filter settings"
          placeholder="Filter settings…"
          value={query}
          data-testid="settings-filter"
          className="mb-3 w-full rounded-md border border-border bg-transparent px-2.5 py-1 text-ui text-foreground placeholder:text-faint-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape" && query !== "") {
              event.stopPropagation();
              setQuery("");
            }
          }}
        />
        {shown === "extensions" && needle === "" && (
          <ExtensionAdd
            markets={markets}
            awaiting={(read?.groups ?? [])
              .filter((group) => group.effective?.row.trusted === false)
              .map((group) => group.name)}
            installed={(read?.groups ?? []).flatMap((group) =>
              group.effective !== undefined &&
              extensionShelf(group.effective.row.origin) === "installed"
                ? [group.name]
                : [],
            )}
          />
        )}
        {needle === "" ? (
          <Part
            id={shown}
            groups={groups[shown]}
            status={shown === "extensions" || shown === "advanced" ? status : null}
          />
        ) : (
          <Filtered needle={needle} sections={sections} />
        )}
      </div>
    </div>
  );
}

/** One part: its groups of sections, each section a fold. */
function Part({
  id,
  groups,
  status,
}: {
  readonly id: SettingsPart;
  readonly groups: readonly SectionGroup[];
  readonly status: ReactNode;
}) {
  return (
    <div data-settings-part={id}>
      {status}
      <Groups groups={groups} />
    </div>
  );
}

/** Every part's sections that match `needle`, each part titled, every match open. */
function Filtered({
  needle,
  sections,
}: {
  readonly needle: string;
  readonly sections: Readonly<Record<SettingsPart, readonly Section[]>>;
}) {
  const parts = SETTINGS_PARTS.flatMap((part) => {
    const matched = sections[part].flatMap((section) => {
      if (section.title.toLowerCase().includes(needle)) return [{ section, rows: section.rows }];
      const rows = section.rows.filter((row) => row.words.toLowerCase().includes(needle));
      return rows.length === 0 ? [] : [{ section, rows }];
    });
    return matched.length === 0 ? [] : [{ part, matched }];
  });
  if (parts.length === 0) {
    return <p className="py-3 text-ui text-muted-foreground">No setting matches.</p>;
  }
  return (
    <>
      {parts.map(({ part, matched }) => (
        <div key={part} data-settings-part={part}>
          <h3 className="kb-label pt-4 pb-1 text-caption text-faint-foreground">
            {PART_WORDS[part].label}
          </h3>
          {matched.map(({ section, rows }) => (
            <Fold
              key={section.id}
              section={section}
              rows={rows}
              whole={rows === section.rows}
              forced
            />
          ))}
        </div>
      ))}
    </>
  );
}

/** A line under a setting's row, in the row's text column. */
function Note({
  children,
  source,
}: {
  readonly children: ReactNode;
  readonly source?: MotionSource;
}) {
  return (
    <span
      className="block pb-1 pl-7 text-caption text-muted-foreground"
      data-motion-source={source}
    >
      {children}
    </span>
  );
}

/**
 * A row of core's: the setting drawn by the field editor, a motion setting
 * noted with the value in force and its source, a page-head setting core's
 * node leaves unset noted with what the head shows instead. Null for a
 * field the reader does not list.
 */
type CoreRowOf = (row: CoreRow) => Row | null;

/**
 * The strengths a head shows where no setting chooses one: the default, and
 * each variant of the shown backdrop that declares its own (`shownStrength`).
 */
function strengthsOwn(head: PageBackdropChoice): string {
  const own = (head.backdrop?.value.key.variants ?? []).flatMap(({ label, strength }) =>
    strength === undefined ? [] : [`${label} ${strength}`],
  );
  return own.length === 0
    ? DEFAULT_BACKDROP_STRENGTH
    : `${DEFAULT_BACKDROP_STRENGTH} (${own.join(", ")})`;
}

function useCoreRow(graph: GraphRead, settings: readonly Setting[]): CoreRowOf {
  const choice = useMotionStore((s) => s.choice);
  const core = graph.schema.get(CORE);
  const theme = useShownDesignSystem()?.key.label ?? "the theme";
  const head = usePageBackdrop();
  const listed = new Set(settings.map((setting) => setting.field));
  const inForce = choice === null ? null : inForceOf(choice);
  const facesNoWay =
    head.backdrop !== null && head.backdrop.value.presentation.directions.length === 0;
  // What the page head shows for a setting core's node leaves unset: the
  // theme's pairing or the default, as the head resolves it.
  const headInForce: ReadonlyMap<NodeId, string> = new Map([
    [SYSTEM_IDS.backdropField, head.backdrop?.value.key.label ?? "none"],
    [SYSTEM_IDS.backdropStrengthField, head.strength ?? strengthsOwn(head)],
    [SYSTEM_IDS.backdropDirectionField, head.direction],
    [SYSTEM_IDS.backdropArtField, head.art ?? "its own"],
    [SYSTEM_IDS.backdropVariantField, "any, one per load"],
  ]);
  const unset = (field: NodeId) => (core?.props[field]?.length ?? 0) === 0;
  return ({ field, label }) => {
    if (!listed.has(field)) return null;
    const force = inForce?.get(field);
    const shown = headInForce.get(field);
    const note =
      force !== undefined ? (
        <Note source={force.source}>{inForceWords(force.value, force.source, theme)}</Note>
      ) : field === SYSTEM_IDS.backdropDirectionField && facesNoWay ? (
        <Note>the backdrop shown faces no way</Note>
      ) : shown !== undefined && unset(field) ? (
        <Note>unset here · {shown} in force</Note>
      ) : undefined;
    return {
      key: field,
      words: label,
      node: <SettingRow graph={graph} nodeId={CORE} field={field} label={label} note={note} />,
    };
  };
}

/** A device row: a control kept in `kb-prefs`, never the graph. */
function DeviceRow({
  icon,
  label,
  children,
}: {
  readonly icon: Parameters<typeof PrefFieldRow>[0]["icon"];
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <PrefFieldRow icon={icon} label={label}>
      {children}
    </PrefFieldRow>
  );
}

function LightDark() {
  const theme = usePrefsStore((s) => s.theme);
  const setTheme = usePrefsStore((s) => s.setTheme);
  return (
    <DeviceRow icon={THEME_GLYPHS[theme]} label="light / dark">
      <EnumSelect
        className={POPOVER_VALUE_CLASS}
        value={theme}
        options={THEME_OPTIONS}
        onChange={setTheme}
        testId="pref-theme"
      />
    </DeviceRow>
  );
}

function Width() {
  const width = usePrefsStore((s) => s.width);
  const setWidth = usePrefsStore((s) => s.setWidth);
  return (
    <DeviceRow icon={ArrowsHorizontalIcon} label="width">
      <EnumSelect
        className={POPOVER_VALUE_CLASS}
        value={width}
        options={WIDTH_OPTIONS}
        onChange={setWidth}
        testId="pref-width"
      />
    </DeviceRow>
  );
}

function Sidebar() {
  const open = usePrefsStore((s) => s.sidebarOpen);
  const setOpen = usePrefsStore((s) => s.setSidebarOpen);
  return (
    <DeviceRow icon={SidebarSimpleIcon} label="sidebar">
      <EnumSelect
        className={POPOVER_VALUE_CLASS}
        value={open ? "open" : "closed"}
        options={SIDEBAR_OPTIONS}
        onChange={(next) => setOpen(next === "open")}
        testId="pref-sidebar"
      />
    </DeviceRow>
  );
}

const THIS_DEVICE = "this browser only, never the kb's";

/** General: this device's layout, and any setting of core's Appearance does not group. */
function generalSections(
  _graph: GraphRead,
  coreSettings: readonly Setting[],
  coreRow: CoreRowOf,
): readonly Section[] {
  const grouped = new Set(CORE_GROUPS.flatMap((group) => group.rows.map((row) => row.field)));
  const other = coreSettings
    .filter((setting) => !grouped.has(setting.field))
    .flatMap((setting) => coreRow({ field: setting.field, label: setting.label }) ?? []);
  return [
    {
      id: "device",
      title: "This device",
      caption: THIS_DEVICE,
      rows: [
        { key: "width", words: "width layout", node: <Width /> },
        { key: "sidebar", words: "sidebar", node: <Sidebar /> },
      ],
    },
    ...(other.length === 0
      ? []
      : [{ id: "core-other", title: "Other settings", caption: "this kb", rows: other }]),
  ];
}

/** Appearance: light and dark (this device's), then core's settings as `CORE_GROUPS` arranges them. */
function appearanceSections(graph: GraphRead, coreRow: CoreRowOf): readonly Section[] {
  const core = graph.schema.get(CORE);
  const motionSet = MOTION_FIELDS.some((field) => (core?.props[field]?.length ?? 0) > 0);
  return [
    {
      id: "light-dark",
      title: "Light and dark",
      caption: THIS_DEVICE,
      rows: [{ key: "theme", words: "light dark system", node: <LightDark /> }],
    },
    ...CORE_GROUPS.map(
      (group): Section => ({
        id: group.id,
        title: group.title,
        caption: group.caption,
        grid: group.id === "effects",
        rows: group.rows.flatMap((row) => coreRow(row) ?? []),
        after: group.id === "motion" && motionSet ? <ResetMotion /> : undefined,
      }),
    ),
  ];
}

function ResetMotion() {
  const graph = useGraphRead();
  const theme = useShownDesignSystem()?.key.label ?? "the theme";
  return (
    <button
      type="button"
      className="mt-2 rounded-md px-2 py-1 text-meta text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
      onClick={() => void resetMotion(graph.schema.get(CORE)?.props ?? {})}
    >
      Reset motion to {theme}
    </button>
  );
}

/** Each bundled declaration by name: core's and every family kb's build carries. */
const BUNDLED_BY_NAME = new Map(
  BUNDLED_DECLARATIONS.map((declaration) => [declaration.name, declaration]),
);

/** An extension node's name: its id without `sys.extension.`. */
const nameOf = (nodeId: NodeId): string => nodeId.replace(/^sys\.extension\./, "");

/** What an extension's card reads beside its catalog group: its node, and the page's readings. */
interface ExtensionNode {
  readonly id: NodeId;
  readonly label: string;
  readonly settings: readonly Setting[];
}

/** Core's section points to the parts that draw its settings. */
const CORE_ROWS: readonly Row[] = [
  {
    key: "core",
    words: "core appearance general",
    node: (
      <p className="py-1 text-meta text-muted-foreground">
        Its settings are in <PartLink part="appearance">Appearance</PartLink> and{" "}
        <PartLink part="general">General</PartLink>.
      </p>
    ),
  },
];

/**
 * What an extension's card says under its heading: its own line, else its
 * bundled declaration's (core's, or a family the server did not report),
 * else a marketplace's; and why it is required, from the same sources.
 */
function cardWords(
  name: string,
  row: PanelExtension["row"] | undefined,
  markets: MarketplaceReading,
): { readonly description: string | undefined; readonly required: string | undefined } {
  const bundled = BUNDLED_BY_NAME.get(name);
  const offered = markets.markets
    .flatMap((market) => market.entries)
    .find((entry) => entry.name === name)?.description;
  return {
    description: row?.description ?? bundled?.description ?? offered,
    required: row?.required ?? bundled?.required,
  };
}

/**
 * One extension's card, and its shelf: installed by its origin, or, for a
 * node the server reports nothing for, whether kb's build declares it (a
 * removed extension's node is installed, and says its nodes remain).
 */
function extensionSection(
  graph: GraphRead,
  { id, label, settings }: ExtensionNode,
  catalog: PanelReport | null,
  markets: MarketplaceReading,
): { readonly section: Section; readonly installed: boolean } {
  const group = catalog?.groups.find((item) => extensionNodeId(item.name) === id);
  const name = group?.name ?? nameOf(id);
  const row = group?.effective?.row;
  const bundled = BUNDLED_BY_NAME.get(name);
  const installed =
    row === undefined ? bundled === undefined : extensionShelf(row.origin) === "installed";
  const after =
    group !== undefined ? (
      <ExtensionDetails nodeId={id} group={group} textOf={(of) => graph.schema.get(of)?.text} />
    ) : catalog !== null && installed ? (
      <RetainedExtension name={name} markets={markets} />
    ) : null;
  const said = cardWords(name, row, markets);
  const section: Section = {
    id,
    title: label,
    caption: <ExtensionCaption name={name} label={label} extension={group?.effective} />,
    testId: `extension-${name}`,
    anchor: `extension-review-${name}`,
    aside: (
      <ExtensionAside extension={group?.effective} installed={installed} required={said.required} />
    ),
    lede: <ExtensionLede extension={group?.effective} installed={installed} {...said} />,
    rows:
      id === CORE
        ? CORE_ROWS
        : settings.map((setting) => ({
            key: setting.field,
            words: `${label} ${name} ${setting.label}`,
            node: (
              <SettingRow graph={graph} nodeId={id} field={setting.field} label={setting.label} />
            ),
          })),
    after,
  };
  return { section, installed };
}

/**
 * Extensions: one section per extension, in `sys.extensions`' order, then
 * any the server reports with no node, on two shelves by origin: Installed
 * (the store's own, linked and installed extensions, and the nodes a
 * removed one left) first, then Built-in (kb's build and the `kb ui`
 * host), which folds. A card leads with its status and its one line, and
 * carries its control in its heading, its settings as rows, then its
 * details. Core's settings are Appearance's and General's, so its section
 * points there.
 */
function extensionGroups(
  graph: GraphRead,
  nodes: readonly ExtensionNode[],
  report: PanelReport | string | null,
  markets: MarketplaceReading,
): readonly SectionGroup[] {
  const catalog = typeof report === "object" && report !== null ? report : null;
  const rows = catalog?.groups ?? [];
  const known = new Set(nodes.map((node) => node.id));
  const all = [
    ...nodes,
    ...rows
      .filter((extension) => !known.has(extensionNodeId(extension.name)))
      .map((extension) => ({
        id: extensionNodeId(extension.name),
        label: extension.effective?.row.label ?? extension.name,
        settings: [] as readonly Setting[],
      })),
  ];
  const sections = all.map((node) => extensionSection(graph, node, catalog, markets));
  const installed = sections.filter((entry) => entry.installed).map((entry) => entry.section);
  const builtin = sections.filter((entry) => !entry.installed).map((entry) => entry.section);
  return [
    {
      id: "installed",
      title: "Installed",
      caption: catalog === null ? undefined : `${installed.length}`,
      cards: true,
      sections: catalog === null ? [] : installed,
      empty:
        catalog === null ? null : (
          <p
            className="rounded-md border border-dashed border-border px-3 py-4 text-meta text-muted-foreground"
            data-testid="extensions-empty"
          >
            Nothing installed yet. Choose <span className="text-foreground">Add extension</span> to
            browse a marketplace or paste a GitHub source.
          </p>
        ),
    },
    {
      id: "builtin",
      title: "Built-in",
      caption: `${builtin.length} · part of kb`,
      cards: true,
      sections: builtin,
    },
  ];
}

/** Advanced: the listeners asked in turn, the repository extensions refused, and the CLI. */
function advancedSections(report: PanelReport | string | null): readonly Section[] {
  const read = typeof report === "object" && report !== null ? report : null;
  return [
    ...(read === null || read.points.length === 0
      ? []
      : [
          {
            id: "asked-in-turn",
            title: "Asked in turn",
            caption: "each point's listeners, in the order they are asked",
            rows: read.points.map(({ point, source, listeners }) => ({
              key: `${source} ${point}`,
              words: `${point} ${listeners.map(({ id, owner }) => `${id} ${owner}`).join(" ")}`,
              node: (
                <div className="py-1" data-testid={`point-${source}-${point}`}>
                  <div className="text-meta text-muted-foreground">
                    <span className="font-mono">{point}</span>
                    <span className="text-faint-foreground"> · {source}</span>
                  </div>
                  <ol className="list-decimal pl-6 text-meta text-muted-foreground">
                    {listeners.map(({ owner, id, match }) => (
                      <li key={`${owner} ${id}`}>
                        <span className="font-mono">{id}</span>
                        <span className="text-faint-foreground">
                          {" "}
                          ({owner}){match === undefined ? "" : ` on ${match}`}
                        </span>
                      </li>
                    ))}
                  </ol>
                </div>
              ),
            })),
          },
        ]),
    ...(read === null || read.failures.length === 0
      ? []
      : [
          {
            id: "refused",
            title: "Refused",
            caption: "repository extensions this kb would not load",
            rows: read.failures.map(({ file, error }) => ({
              key: file,
              words: `${file} ${error}`,
              node: (
                <p className="py-1 text-meta text-destructive" data-testid={`refused-${file}`}>
                  <span className="font-mono">{file}</span>: {error}
                </p>
              ),
            })),
          },
        ]),
    {
      id: "cli",
      title: "From the CLI",
      rows: [
        {
          key: "cli",
          words: "cli kb ext settings set mcp agent",
          node: (
            <p className="py-1 text-meta text-muted-foreground">
              Each kb setting is a field on the node it configures, so{" "}
              <code className="font-mono">kb ext settings</code> lists what this page draws, MCP and
              the agent read the same list, and <code className="font-mono">kb set</code> writes
              one. Each extension is switched with{" "}
              <code className="font-mono">extension.switch</code>.
            </p>
          ),
        },
      ],
    },
  ];
}
