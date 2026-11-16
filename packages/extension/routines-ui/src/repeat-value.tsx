/**
 * The value kind of routines' repeat type (DESIGN-UI.md → The routines
 * calendar, an event's repeat field): an event's rule reads as its line
 * words it, "Weekly on Tue", read by the one `describeRepeat` against
 * the event's start and end, and edits as the rule it stores. The words are
 * the surface at rest; the editor is the text kind's own, so the repeat's
 * caret is text's caret and no second one exists.
 */
import { describeRepeat, routineSettings } from "@kb/routines";
import { FIELD_TYPE_OPTION_IDS } from "@kb/model";
import {
  cn,
  KB_TEXT_CLASS,
  useContributions,
  useNode,
  ValueKindPoint,
  type ValueSurfaceProps,
} from "@kb/ui-sdk";

/**
 * An event's repeat: its words at rest, the rule as its title; the text
 * kind's surface while the slot edits, and for what the words cannot say
 * (no rule yet, or input the slot kept).
 */
export function RepeatSurface(props: ValueSurfaceProps) {
  const kinds = useContributions(ValueKindPoint);
  const event = useNode(props.field.holder ?? undefined);
  const Text = kinds.find(({ value }) => value.type === FIELD_TYPE_OPTION_IDS.text)?.value.Surface;
  const rule = props.spec.text(props.value);
  if (Text !== undefined && (props.editing || props.blank || props.rejected !== null))
    return <Text {...props} />;
  const settings = event === undefined ? null : routineSettings(event).settings;
  return (
    <div className="flex min-w-0 flex-1 items-start">
      <span
        className={cn(
          "min-w-0 flex-1 cursor-text rounded-sm px-1 text-foreground/70",
          KB_TEXT_CLASS,
        )}
        title={rule}
        data-repeat-value=""
      >
        {describeRepeat(rule, settings?.until ?? "", settings?.starts ?? "")}
      </span>
    </div>
  );
}
