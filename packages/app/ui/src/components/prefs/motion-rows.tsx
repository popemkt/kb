import {
  extensionNodeId,
  MOTION_EFFECTS,
  MOTION_FIELD_IDS,
  MOTION_OPTION_SETTINGS,
  motionEffectFieldId,
  type MotionSource,
} from "@kb/model";
import { browserHost, useNode, useShownDesignSystem } from "@kb/ui-sdk";
import { CaretRightIcon } from "@phosphor-icons/react";
import { useMotionStore } from "@/stores/motion.store";
import { useCoreSettings } from "./core-settings";

const CORE = extensionNodeId("core");

/** Every motion field of core's node: the four option settings and each effect. */
const MOTION_FIELDS = [
  ...MOTION_OPTION_SETTINGS.map((setting) => MOTION_FIELD_IDS[setting]),
  ...MOTION_EFFECTS.map(motionEffectFieldId),
];

/** Where a value in force came from, in words. */
function from(source: MotionSource, theme: string): string {
  switch (source) {
    case "explicit":
      return "set here";
    case "theme":
      return `from ${theme}`;
    case "default":
      return "default";
    default:
      return source satisfies never;
  }
}

/** The value in force and its source, beside a setting. */
function InForce({ value, source, theme }: { value: string; source: MotionSource; theme: string }) {
  return (
    <span
      className="block pl-7 pb-1 text-caption text-muted-foreground"
      data-motion-source={source}
    >
      {value} · {from(source, theme)}
    </span>
  );
}

/**
 * The motion options (DESIGN-UI.md → Motion options), as core's settings:
 * each drawn with the page's field editor, as any field is, and under it the
 * value in force and where it comes from (set here, the shown theme's
 * preset, or the default). Unset is "from the theme"; the reset clears
 * every one, so the theme's preset applies again.
 */
export function MotionRows() {
  const setting = useCoreSettings();
  const choice = useMotionStore((s) => s.choice);
  const theme = useShownDesignSystem()?.key.label ?? "the theme";
  const core = useNode(CORE);
  if (setting === null || choice === null) return null;
  const set = MOTION_FIELDS.some((field) => (core?.props[field]?.length ?? 0) > 0);
  return (
    <section aria-label="motion">
      {MOTION_OPTION_SETTINGS.map((name) => (
        <div key={name}>
          {setting(MOTION_FIELD_IDS[name], name)}
          <InForce value={choice.settings[name]} source={choice.sources[name]} theme={theme} />
        </div>
      ))}
      <details className="group">
        {/* The disclosure's own caret, in the row's glyph column, not the browser's triangle. */}
        <summary className="flex h-7 cursor-pointer list-none items-center text-meta text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center text-foreground/35">
            <CaretRightIcon
              size={11}
              weight="bold"
              aria-hidden
              className="transition-transform group-open:rotate-90"
            />
          </span>
          <span className="pl-1">effects</span>
        </summary>
        {MOTION_EFFECTS.map((effect) => (
          <div key={effect}>
            {setting(motionEffectFieldId(effect), effect)}
            <InForce
              value={choice.settings.effects[effect] ? "on" : "off"}
              source={choice.sources.effects[effect]}
              theme={theme}
            />
          </div>
        ))}
      </details>
      {set ? (
        <button
          type="button"
          className="mt-1 rounded-md px-2 py-1 text-meta text-foreground/60 hover:bg-foreground/5 hover:text-foreground/80"
          onClick={() => {
            for (const field of MOTION_FIELDS) {
              if ((core?.props[field]?.length ?? 0) > 0) {
                void browserHost().writes.removeProp(CORE, field);
              }
            }
          }}
        >
          Reset motion to {theme}
        </button>
      ) : null}
    </section>
  );
}
