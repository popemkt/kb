import { FAR_CITY, NEAR_CITY, SKYLINE_H, SKYLINE_W } from "./skyline";

/**
 * Cloudbank's skyline: the far city and the near one, their lit windows,
 * as one SVG that keeps its ground on the bottom edge of whatever holds it.
 * Colours are classes (art.css), so each design system's tokens paint it.
 */
export function SkylineSvg({ className }: { readonly className?: string }) {
  return (
    <svg
      className={className}
      viewBox={`0 0 ${SKYLINE_W} ${SKYLINE_H}`}
      preserveAspectRatio="xMidYMax slice"
      aria-hidden="true"
      focusable="false"
    >
      <path className="kb-cloudbank-far" d={FAR_CITY.d} fillRule="evenodd" />
      <path className="kb-cloudbank-near" d={NEAR_CITY.d} fillRule="evenodd" />
      <g className="kb-cloudbank-windows">
        {NEAR_CITY.windows.map(({ x, y, w, h, twinkle }, i) => (
          <rect
            // oxlint-disable-next-line react/no-array-index-key -- a fixed drawing: its windows never reorder
            key={i}
            x={x}
            y={y}
            width={w}
            height={h}
            className={twinkle ? "kb-cloudbank-twinkle" : undefined}
            style={twinkle ? { animationDelay: `${(i * 1.7) % 16}s` } : undefined}
          />
        ))}
      </g>
    </svg>
  );
}
