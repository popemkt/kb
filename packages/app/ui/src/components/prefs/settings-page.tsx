/**
 * The Settings page: this device's choices, then every extension node's
 * settings as `settingsOf` reads them, each drawn with the page's field
 * editor. What it shows and why is DESIGN-UI.md → Settings.
 */
import {
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
  type GraphRead,
  navigate,
  POPOVER_VALUE_CLASS,
  PrefFieldRow,
  type PropValue,
  THEME_GLYPHS,
  type ThemePref,
  useFieldEditor,
  useGraphRead,
  usePageBackdrop,
  useShownDesignSystem,
  type WidthPref,
} from "@kb/ui-sdk";
import { ArrowsHorizontalIcon } from "@phosphor-icons/react";
import { createElement, type ReactNode } from "react";
import { EXTENSIONS_PATH } from "@/lib/extension-report";
import { useMotionStore } from "@/stores/motion.store";
import { usePrefsStore } from "@/stores/prefs.store";

const CORE = extensionNodeId("core");
const NONE: PropValue[] = [];

const THEME_OPTIONS: readonly EnumOption<ThemePref>[] = [
  { value: "system", label: "system" },
  { value: "light", label: "light" },
  { value: "dark", label: "dark" },
];
const WIDTH_OPTIONS: readonly EnumOption<WidthPref>[] = [
  { value: "centered", label: "centered" },
  { value: "full", label: "full" },
];

/** A core setting as its group draws it: the field, and the word the row says. */
interface Row {
  readonly field: NodeId;
  readonly label: string;
}

/** "hoverLift" as a row says it. */
const words = (id: string): string => id.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();

/**
 * How core's section groups core's settings: the page's own arrangement of
 * core's node, as the shell is core's. A setting of core's no group names
 * is still drawn, under *other* (`CoreSection`).
 */
const CORE_GROUPS: readonly { readonly title: string; readonly rows: readonly Row[] }[] = [
  { title: "theme", rows: [{ field: SYSTEM_IDS.designSystemField, label: "theme" }] },
  {
    title: "page head",
    rows: [
      { field: SYSTEM_IDS.backdropField, label: "backdrop" },
      { field: SYSTEM_IDS.backdropStrengthField, label: "strength" },
      { field: SYSTEM_IDS.backdropDirectionField, label: "direction" },
    ],
  },
  {
    title: "motion",
    rows: MOTION_OPTION_SETTINGS.map((setting) => ({
      field: MOTION_FIELD_IDS[setting],
      label: setting,
    })),
  },
  {
    title: "effects",
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

export function SettingsPage() {
  const graph = useGraphRead();
  const sections = (graph.schema.get(SYSTEM_IDS.extensionsRoot)?.children ?? []).flatMap((id) => {
    const node = graph.schema.get(id);
    if (node === undefined) return [];
    const settings = settingsOf(graph.schema.values(), (other) => graph.schema.get(other), id);
    return settings.length === 0 ? [] : [{ id, label: node.text, settings }];
  });
  return (
    <div className="mx-auto max-w-3xl px-4 py-6" data-testid="settings-page">
      <h2 className="kb-display text-title font-medium text-foreground">Settings</h2>
      <p className="mt-1 mb-2 max-w-xl text-meta text-muted-foreground">
        Every choice this kb makes, and the few this device makes. Each kb setting is a field on the
        node it configures, so a choice here paints every tab, and{" "}
        <code className="font-mono">kb ext settings</code> lists the same.
      </p>
      <DeviceSection />
      {sections.map(({ id, label, settings }) =>
        id === CORE ? (
          <CoreSection key={id} label={label} settings={settings} />
        ) : (
          <ExtensionSection key={id} nodeId={id} label={label} settings={settings} />
        ),
      )}
    </div>
  );
}

function Section({
  id,
  title,
  caption,
  aside,
  children,
}: {
  readonly id: string;
  readonly title: string;
  readonly caption?: string;
  readonly aside?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <section
      aria-label={title}
      data-settings-section={id}
      className="border-t border-border py-4 first-of-type:border-t-0"
    >
      <div className="flex items-baseline gap-2">
        <h3 className="text-ui font-medium text-foreground">{title}</h3>
        {caption === undefined ? null : (
          <span className="text-caption text-faint-foreground">{caption}</span>
        )}
        <span className="flex-1" />
        {aside}
      </div>
      <div className="mt-1">{children}</div>
    </section>
  );
}

function Group({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <div role="group" aria-label={title}>
      <h4 className="kb-label pt-3 pb-1 text-caption text-faint-foreground">{title}</h4>
      {children}
    </div>
  );
}

/** Light, dark or system, and the width: this device's, kept in `kb-prefs`. */
function DeviceSection() {
  const theme = usePrefsStore((s) => s.theme);
  const setTheme = usePrefsStore((s) => s.setTheme);
  const width = usePrefsStore((s) => s.width);
  const setWidth = usePrefsStore((s) => s.setWidth);
  return (
    <Section id="device" title="This device" caption="this browser only, never the kb's">
      <PrefFieldRow icon={THEME_GLYPHS[theme]} label="light / dark">
        <EnumSelect
          className={POPOVER_VALUE_CLASS}
          value={theme}
          options={THEME_OPTIONS}
          onChange={setTheme}
          testId="pref-theme"
        />
      </PrefFieldRow>
      <PrefFieldRow icon={ArrowsHorizontalIcon} label="width">
        <EnumSelect
          className={POPOVER_VALUE_CLASS}
          value={width}
          options={WIDTH_OPTIONS}
          onChange={setWidth}
          testId="pref-width"
        />
      </PrefFieldRow>
    </Section>
  );
}

/** One setting of `nodeId`, drawn with the page's field editor, and a note under it. */
function SettingRow({
  graph,
  nodeId,
  field,
  label,
  note,
}: {
  readonly graph: GraphRead;
  readonly nodeId: NodeId;
  readonly field: NodeId;
  readonly label: string;
  readonly note?: ReactNode;
}) {
  const editor = createElement(useFieldEditor(), {
    nodeId,
    fieldId: field,
    label,
    values: graph.schema.get(nodeId)?.props[field] ?? NONE,
    context: graph,
    depth: -1,
  });
  return (
    <div data-setting={field}>
      {editor}
      {note}
    </div>
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

/** The value in force and its source, under a motion setting. */
function InForce({ value, source, theme }: { value: string; source: MotionSource; theme: string }) {
  return <Note source={source}>{inForceWords(value, source, theme)}</Note>;
}

/**
 * Core's settings, grouped as `CORE_GROUPS` says, each motion setting noted
 * with the value in force; any setting of core's no group names under
 * *other*; and a reset that clears every motion setting of core's, so the
 * shown theme's preset applies again.
 */
function CoreSection({
  label,
  settings,
}: {
  readonly label: string;
  readonly settings: readonly Setting[];
}) {
  const graph = useGraphRead();
  const choice = useMotionStore((s) => s.choice);
  const core = graph.schema.get(CORE);
  const theme = useShownDesignSystem()?.key.label ?? "the theme";
  const listed = new Set(settings.map((setting) => setting.field));
  const grouped = new Set(CORE_GROUPS.flatMap((group) => group.rows.map((row) => row.field)));
  const other = settings.filter((setting) => !grouped.has(setting.field));
  const inForce = choice === null ? null : inForceOf(choice);
  const head = usePageBackdrop();
  const facesNoWay =
    head.backdrop !== null && head.backdrop.value.presentation.directions.length === 0;
  // What the page head shows for a setting core's node leaves unset: the
  // theme's pairing or the default, as the head resolves it.
  const headInForce: ReadonlyMap<NodeId, string> = new Map([
    [SYSTEM_IDS.backdropField, head.backdrop?.value.key.label ?? "none"],
    [SYSTEM_IDS.backdropStrengthField, head.strength],
    [SYSTEM_IDS.backdropDirectionField, head.direction],
  ]);
  const unset = (field: NodeId) => (core?.props[field]?.length ?? 0) === 0;
  const motionSet = MOTION_FIELDS.some((field) => (core?.props[field]?.length ?? 0) > 0);
  const row = ({ field, label: word }: Row) => {
    if (!listed.has(field)) return null;
    const force = inForce?.get(field);
    const shown = headInForce.get(field);
    const note =
      force !== undefined ? (
        <InForce {...force} theme={theme} />
      ) : field === SYSTEM_IDS.backdropDirectionField && facesNoWay ? (
        <Note>the backdrop shown faces no way</Note>
      ) : shown !== undefined && unset(field) ? (
        <Note>unset here · {shown} in force</Note>
      ) : undefined;
    return (
      <SettingRow key={field} graph={graph} nodeId={CORE} field={field} label={word} note={note} />
    );
  };
  return (
    <Section id={CORE} title={label} caption="how every page of this kb looks and moves">
      {CORE_GROUPS.map((group) => (
        <Group key={group.title} title={group.title}>
          {group.title === "effects" ? (
            <div className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">{group.rows.map(row)}</div>
          ) : (
            group.rows.map(row)
          )}
        </Group>
      ))}
      {motionSet ? (
        <button
          type="button"
          className="mt-2 rounded-md px-2 py-1 text-meta text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
          onClick={() => void resetMotion(core?.props ?? {})}
        >
          Reset motion to {theme}
        </button>
      ) : null}
      {other.length === 0 ? null : (
        <Group title="other">
          {other.map((setting) => row({ field: setting.field, label: setting.label }))}
        </Group>
      )}
    </Section>
  );
}

/** Another extension's settings, as rows, and the way to where it is switched. */
function ExtensionSection({
  nodeId,
  label,
  settings,
}: {
  readonly nodeId: NodeId;
  readonly label: string;
  readonly settings: readonly Setting[];
}) {
  const graph = useGraphRead();
  return (
    <Section
      id={nodeId}
      title={label}
      aside={
        <button
          type="button"
          className="text-meta text-muted-foreground hover:text-foreground"
          onClick={() => navigate(EXTENSIONS_PATH)}
        >
          on or off in Extensions
        </button>
      }
    >
      {settings.map((setting) => (
        <SettingRow
          key={setting.field}
          graph={graph}
          nodeId={nodeId}
          field={setting.field}
          label={setting.label}
        />
      ))}
    </Section>
  );
}
