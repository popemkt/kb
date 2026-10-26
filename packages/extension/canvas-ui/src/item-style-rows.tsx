/**
 * The style panel's rows that set a look (`styleOf`), icon first: the
 * palette's swatches, which the item and the edge panels share, and how
 * opaque the item is drawn; one icon row per look an item draws — its fill
 * and outline when it draws a ground of its own, and the size, face and
 * alignment of its words when they are its own — and an edge's route,
 * bend, line and the head each end wears, each drawn at its end. Each pick is one change (one history step),
 * written through `withStyle`, `withRoute` or `withHead`.
 */
import { useState, type ReactNode } from "react";
import {
  AlignBottomIcon,
  AlignCenterVerticalIcon,
  AlignTopIcon,
  ProhibitIcon,
  SquareIcon,
  TextAlignCenterIcon,
  TextAlignLeftIcon,
  TextAlignRightIcon,
} from "@phosphor-icons/react";
import {
  CANVAS_ALIGNS,
  CANVAS_DASHES,
  CANVAS_FILLS,
  CANVAS_FONTS,
  CANVAS_HEADS,
  CANVAS_ROUTES,
  CANVAS_SIZES,
  CANVAS_VALIGNS,
  drawsGround,
  headOf,
  routeBends,
  ownsWords,
  styleOf,
  withHead,
  withRoute,
  withStyle,
  type CanvasEdge,
  type CanvasNode,
  type CanvasPaint,
  type EdgeEnd,
} from "@kb/canvas";
import { cn } from "@kb/ui-sdk";
import { CANVAS_SWATCHES } from "./canvas-color";
import { DockPick, DockSection, IconRow, type IconChoice } from "./canvas-dock";
import { NumberField } from "./number-field";

/** A swatch, ringed when it is the colour painted. */
const swatch = (on: boolean) =>
  cn(
    "h-6 w-6 justify-self-center rounded-full border border-border",
    on && "ring-2 ring-primary/60 ring-offset-1 ring-offset-popover",
  );

/** The swatches, five across: none, then each palette entry; the one `value` paints is marked. */
export function ColorSwatches({
  value,
  onChange,
}: {
  value: CanvasPaint | undefined;
  onChange: (color: string | undefined) => void;
}) {
  return (
    <div role="radiogroup" aria-label="Color" className="grid grid-cols-5 gap-y-1">
      <DockPick
        role="radio"
        aria-checked={value === undefined}
        aria-label="No color"
        title="None"
        className={cn(swatch(value === undefined), "border-foreground/20 bg-background")}
        onClick={() => onChange(undefined)}
      />
      {CANVAS_SWATCHES.map((p) => {
        const on = value?.kind === "palette" && value.id === p.id;
        return (
          <DockPick
            key={p.id}
            role="radio"
            aria-checked={on}
            aria-label={p.label}
            title={p.label}
            className={swatch(on)}
            style={{ backgroundColor: p.css }}
            onClick={() => onChange(p.id)}
          />
        );
      })}
    </div>
  );
}

/**
 * How opaque the item is drawn (its style's opacity), as a slider in
 * percent: dragged freely, committed once when let go, as one change. It
 * gives the keyboard back to the canvas then.
 */
function OpacitySlider({
  item,
  onChange,
}: {
  item: CanvasNode;
  onChange: (item: CanvasNode) => void;
}) {
  const percent = Math.round(styleOf(item).opacity * 100);
  // A new opacity from outside remounts the slider (its `key`), so the draft starts from it.
  const [draft, setDraft] = useState(percent);
  const commit = (input: HTMLInputElement) => {
    input.blur();
    if (draft !== percent) onChange(withStyle(item, { opacity: draft / 100 }));
  };
  return (
    <input
      type="range"
      min={0}
      max={100}
      step={5}
      aria-label="Opacity"
      title={`Opacity: ${draft}%`}
      className="h-3 w-full accent-foreground/70"
      value={draft}
      onChange={(e) => setDraft(Number(e.target.value))}
      onPointerUp={(e) => commit(e.currentTarget)}
      onKeyUp={(e) => commit(e.currentTarget)}
    />
  );
}

/** The colour section: the item's colour among the swatches (an item that draws a ground), and its opacity. */
export function ColorSection({
  item,
  onChange,
}: {
  item: CanvasNode;
  onChange: (item: CanvasNode) => void;
}) {
  const setColor = (color: string | undefined) => {
    const updated = { ...item };
    if (color === undefined) delete updated.color;
    else updated.color = color;
    onChange(updated);
  };
  const opacity = Math.round(styleOf(item).opacity * 100);
  return (
    <DockSection>
      {drawsGround(item) && <ColorSwatches value={styleOf(item).color} onChange={setColor} />}
      <OpacitySlider key={`opacity:${opacity}`} item={item} onChange={onChange} />
    </DockSection>
  );
}

/** A small mark drawn as a line would be: how a dash or a route looks. */
function LineMark({ d, dash }: { d: string; dash?: string }) {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" aria-hidden>
      <path
        d={d}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={dash}
      />
    </svg>
  );
}

type Fill = (typeof CANVAS_FILLS)[number];
type Dash = (typeof CANVAS_DASHES)[number];
type Size = (typeof CANVAS_SIZES)[number];
type Font = (typeof CANVAS_FONTS)[number];
type Align = (typeof CANVAS_ALIGNS)[number];
type VAlign = (typeof CANVAS_VALIGNS)[number];
type Route = (typeof CANVAS_ROUTES)[number];

/**
 * Each look's choices in its own order, named and drawn: tsc asks for one
 * per value, so a new value cannot go unnamed.
 */
const choices = <T extends string>(
  values: readonly T[],
  looks: { readonly [V in T]: { label: string; icon: ReactNode } },
): IconChoice<T>[] => values.map((value) => ({ value, ...looks[value] }));

const FILLS = choices<Fill>(CANVAS_FILLS, {
  none: { label: "None", icon: <SquareIcon size={16} /> },
  semi: { label: "Wash", icon: <SquareIcon size={16} weight="duotone" /> },
  solid: { label: "Solid", icon: <SquareIcon size={16} weight="fill" /> },
});
const DASH_LINE = "M2.5 8 H13.5";
const DASHES = choices<Dash>(CANVAS_DASHES, {
  solid: { label: "Solid", icon: <LineMark d={DASH_LINE} /> },
  dashed: { label: "Dashed", icon: <LineMark d={DASH_LINE} dash="3.5 2.5" /> },
  dotted: { label: "Dotted", icon: <LineMark d={DASH_LINE} dash="0.1 3" /> },
  none: { label: "None", icon: <ProhibitIcon size={14} /> },
});
const SIZE_MARK = "text-label font-semibold";
const SIZES = choices<Size>(CANVAS_SIZES, {
  s: { label: "Small", icon: <span className={SIZE_MARK}>S</span> },
  m: { label: "Medium", icon: <span className={SIZE_MARK}>M</span> },
  l: { label: "Large", icon: <span className={SIZE_MARK}>L</span> },
  xl: { label: "Extra large", icon: <span className={SIZE_MARK}>XL</span> },
});
const FONTS = choices<Font>(CANVAS_FONTS, {
  sans: { label: "Sans", icon: <span className="font-sans text-ui">Aa</span> },
  serif: { label: "Serif", icon: <span className="font-serif text-ui">Aa</span> },
  mono: { label: "Mono", icon: <span className="font-mono text-ui">Aa</span> },
});
const ALIGNS = choices<Align>(CANVAS_ALIGNS, {
  start: { label: "Left", icon: <TextAlignLeftIcon size={16} /> },
  middle: { label: "Centre", icon: <TextAlignCenterIcon size={16} /> },
  end: { label: "Right", icon: <TextAlignRightIcon size={16} /> },
});
const VALIGNS = choices<VAlign>(CANVAS_VALIGNS, {
  top: { label: "Top", icon: <AlignTopIcon size={16} /> },
  middle: { label: "Middle", icon: <AlignCenterVerticalIcon size={16} /> },
  bottom: { label: "Bottom", icon: <AlignBottomIcon size={16} /> },
});
const ROUTES = choices<Route>(CANVAS_ROUTES, {
  curve: { label: "Curve", icon: <LineMark d="M2.5 13 C7 13 9 3 13.5 3" /> },
  straight: { label: "Straight", icon: <LineMark d="M2.5 13 L13.5 3" /> },
  arc: { label: "Arc", icon: <LineMark d="M2.5 13 Q2.5 3 13.5 3" /> },
  elbow: { label: "Elbow", icon: <LineMark d="M2.5 13 H8 V3 H13.5" /> },
});

type Head = (typeof CANVAS_HEADS)[number] | "none";

/** A head as it is worn at the right end of a short line; `end` "from" mirrors it to the left. */
const HEAD_MARKS: { readonly [H in Head]: { label: string; mark: ReactNode } } = {
  arrow: { label: "Arrow", mark: <path d="M9 4.5 L13.5 8 L9 11.5 Z" fill="currentColor" /> },
  open: { label: "Open", mark: <path d="M9.5 4.5 L13.5 8 L9.5 11.5" fill="none" /> },
  dot: { label: "Dot", mark: <circle cx={11.5} cy={8} r={2.2} fill="currentColor" /> },
  diamond: {
    label: "Diamond",
    mark: <path d="M9 8 L11.5 5.5 L14 8 L11.5 10.5 Z" fill="currentColor" />,
  },
  bar: { label: "Bar", mark: <path d="M13 4.5 V11.5" /> },
  none: { label: "None", mark: null },
};

/** The heads one end may wear, each drawn at that end. */
const headChoices = (end: EdgeEnd): IconChoice<Head>[] =>
  ([...CANVAS_HEADS, "none"] as const).map((value) => ({
    value,
    label: HEAD_MARKS[value].label,
    icon: (
      <svg
        width={16}
        height={16}
        viewBox="0 0 16 16"
        aria-hidden
        stroke="currentColor"
        strokeWidth={1.4}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={end === "from" ? { transform: "scaleX(-1)" } : undefined}
      >
        <path d="M2.5 8 H12" />
        {HEAD_MARKS[value].mark}
      </svg>
    ),
  }));
const HEADS: { readonly [E in EdgeEnd]: IconChoice<Head>[] } = {
  from: headChoices("from"),
  to: headChoices("to"),
};

/**
 * How an edge runs and what it wears: its route, bent for an arc or an
 * elbow; how its line is drawn and how heavy; the head each end wears.
 */
export function EdgeLookRows({
  edge,
  onChange,
}: {
  edge: CanvasEdge;
  onChange: (edge: CanvasEdge) => void;
}) {
  const style = styleOf(edge);
  const route = edge.route ?? "curve";
  const head = (end: EdgeEnd) => headOf(edge, end) ?? "none";
  const wear = (end: EdgeEnd) => (next: Head) =>
    onChange(withHead(edge, end, next === "none" ? null : next));
  return (
    <>
      <DockSection>
        <IconRow
          label="Route"
          value={route}
          choices={ROUTES}
          onChange={(next) => onChange(withRoute(edge, { route: next }))}
        />
        {routeBends(route) && (
          <NumberField
            key={`bend:${edge.bend ?? ""}`}
            label="Bend"
            hint={
              route === "arc"
                ? "How far its middle bows off the straight line, left of its way; unset, a fifth of the way across"
                : "How far its middle run is moved off centre"
            }
            value={edge.bend ?? 0}
            unit="length"
            onCommit={(bend) => onChange(withRoute(edge, { bend }))}
          />
        )}
      </DockSection>
      <DockSection>
        <IconRow
          label="Line"
          value={style.dash}
          choices={DASHES}
          onChange={(dash) => onChange(withStyle(edge, { dash }))}
        />
        <IconRow
          label="Size"
          value={style.size}
          choices={SIZES}
          onChange={(size) => onChange(withStyle(edge, { size }))}
        />
      </DockSection>
      <DockSection>
        <IconRow label="Start" value={head("from")} choices={HEADS.from} onChange={wear("from")} />
        <IconRow label="End" value={head("to")} choices={HEADS.to} onChange={wear("to")} />
      </DockSection>
    </>
  );
}

/**
 * The look rows that apply to `item`: fill and outline for one that draws
 * its own ground, size for both, and the face and alignment of words that
 * are its own.
 */
export function LookRows({
  item,
  onChange,
}: {
  item: CanvasNode;
  onChange: (item: CanvasNode) => void;
}) {
  const style = styleOf(item);
  const ground = drawsGround(item);
  const words = ownsWords(item);
  if (!ground && !words) return null;
  return (
    <>
      <DockSection>
        {ground && (
          <IconRow
            label="Fill"
            value={style.fill}
            choices={FILLS}
            onChange={(fill) => onChange(withStyle(item, { fill }))}
          />
        )}
        {ground && (
          <IconRow
            label="Outline"
            value={style.dash}
            choices={DASHES}
            onChange={(dash) => onChange(withStyle(item, { dash }))}
          />
        )}
        <IconRow
          label="Size"
          value={style.size}
          choices={SIZES}
          onChange={(size) => onChange(withStyle(item, { size }))}
        />
      </DockSection>
      {words && (
        <DockSection>
          <IconRow
            label="Font"
            value={style.font}
            choices={FONTS}
            onChange={(font) => onChange(withStyle(item, { font }))}
          />
          <IconRow
            label="Align"
            value={style.align}
            choices={ALIGNS}
            onChange={(align) => onChange(withStyle(item, { align }))}
          />
          <IconRow
            label="Place"
            value={style.valign}
            choices={VALIGNS}
            onChange={(valign) => onChange(withStyle(item, { valign }))}
          />
        </DockSection>
      )}
    </>
  );
}
