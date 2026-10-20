import { extensionNodeId, SYSTEM_IDS } from "@kb/model";
import {
  type EnumOption,
  EnumSelect,
  POPOVER_VALUE_CLASS,
  PopoverShell,
  PrefFieldRow,
  type PropValue,
  THEME_GLYPHS,
  type ThemePref,
  useFieldEditor,
  useGraphRead,
  usePageBackdrop,
  type WidthPref,
  useDismiss,
} from "@kb/ui-sdk";
import { useRef, type ReactNode } from "react";
import { ArrowsHorizontalIcon, GearSixIcon } from "@phosphor-icons/react";
import { usePrefsStore } from "@/stores/prefs.store";
import { useUiStore } from "@/stores/ui.store";

const THEME_OPTIONS: readonly EnumOption<ThemePref>[] = [
  { value: "system", label: "system" },
  { value: "light", label: "light" },
  { value: "dark", label: "dark" },
];
const WIDTH_OPTIONS: readonly EnumOption<WidthPref>[] = [
  { value: "centered", label: "centered" },
  { value: "full", label: "full" },
];

/** What marks Preferences' trigger, which the popover counts as its own. */
const TRIGGER = "data-preferences-trigger";

/**
 * The header's Preferences button: the popover's trigger, whose click opens
 * it and, while it is open, closes it. It wears a neutral gear: the theme is
 * one setting among the appearance it opens, not what the button is.
 */
export function PreferencesTrigger() {
  const open = useUiStore((s) => s.prefsOpen);
  const setOpen = useUiStore((s) => s.setPrefsOpen);
  return (
    <button
      type="button"
      className="flex h-6 w-6 items-center justify-center rounded-md text-foreground/40 transition-colors duration-100 hover:bg-foreground/5 hover:text-foreground/70"
      aria-label="Preferences"
      aria-expanded={open}
      title="Preferences"
      {...{ [TRIGGER]: "true" }}
      onClick={() => setOpen(!open)}
    >
      <GearSixIcon size={15} />
    </button>
  );
}

/**
 * Preferences: how the page looks, and nothing else. The device's theme and
 * width, and core's design system and backdrop. What the kb composes, and
 * each family's settings, are the Extensions panel's.
 */
export function PreferencesPopover() {
  const open = useUiStore((s) => s.prefsOpen);
  const setOpen = useUiStore((s) => s.setPrefsOpen);
  const panelRef = useRef<HTMLDivElement>(null);

  useDismiss(open, { inside: [panelRef], trigger: `[${TRIGGER}="true"]` }, () => setOpen(false));

  if (!open) return null;

  return (
    <PopoverShell panelRef={panelRef} title="Preferences" className="absolute right-4 top-11 mt-1">
      <ThemeRow />
      <DesignSystemRows />
      <WidthRow />
      <BackdropRows />
    </PopoverShell>
  );
}

function ThemeRow() {
  const theme = usePrefsStore((s) => s.theme);
  const setTheme = usePrefsStore((s) => s.setTheme);
  return (
    <PrefFieldRow icon={THEME_GLYPHS[theme]} label="theme">
      <EnumSelect
        className={POPOVER_VALUE_CLASS}
        value={theme}
        options={THEME_OPTIONS}
        onChange={setTheme}
      />
    </PrefFieldRow>
  );
}

function WidthRow() {
  const width = usePrefsStore((s) => s.width);
  const setWidth = usePrefsStore((s) => s.setWidth);
  return (
    <PrefFieldRow icon={ArrowsHorizontalIcon} label="width">
      <EnumSelect
        className={POPOVER_VALUE_CLASS}
        value={width}
        options={WIDTH_OPTIONS}
        onChange={setWidth}
      />
    </PrefFieldRow>
  );
}

const CORE_NODE = extensionNodeId("core");
const NONE: PropValue[] = [];

/**
 * Core's settings as Preferences draws them: each a field of core's node
 * (`sys.extension.core`), drawn with the page's field editor as any field
 * is drawn, under its label. Null until core's node has arrived.
 */
function useCoreSettings(): ((fieldId: string, label: string) => ReactNode) | null {
  const graph = useGraphRead();
  const Field = useFieldEditor();
  const core = graph.outline.get(CORE_NODE);
  if (core === undefined) return null;
  return (fieldId, label) => (
    <Field
      nodeId={CORE_NODE}
      fieldId={fieldId}
      label={label}
      values={core.props[fieldId] ?? NONE}
      context={graph}
      depth={-1}
    />
  );
}

/**
 * The design system the page is painted in, as core's setting (DESIGN-UI.md
 * → Design tokens → Design systems): its field, whose options are the
 * declared systems, each drawn with its live swatch (`OptionPreviewPoint`).
 */
function DesignSystemRows() {
  const setting = useCoreSettings();
  if (setting === null) return null;
  return <section aria-label="design">{setting(SYSTEM_IDS.designSystemField, "design")}</section>;
}

/**
 * The page-head backdrop, as core's settings (DESIGN-UI.md → Page-head
 * backdrops): which one, how strong and which way, each an option field
 * drawn with the page's field editor, as any field is drawn. The backdrops
 * are the backdrop field's options, one per declared backdrop, so the
 * field's own picker is the one list of them. The direction is drawn only
 * where the backdrop shown faces a way.
 */
function BackdropRows() {
  const { backdrop } = usePageBackdrop();
  const setting = useCoreSettings();
  if (backdrop === null || setting === null) return null;
  return (
    <section aria-label="backdrop">
      {setting(SYSTEM_IDS.backdropField, "backdrop")}
      {setting(SYSTEM_IDS.backdropStrengthField, "strength")}
      {backdrop.value.presentation.directions.length > 0
        ? setting(SYSTEM_IDS.backdropDirectionField, "direction")
        : null}
    </section>
  );
}
