/**
 * The gallery's masonry, as arithmetic: where each tile goes, and which
 * tiles a scrolled window shows. The grid renders only those, so a library
 * of fifty thousand visuals costs the page a few dozen elements, never one
 * per visual (research record §7).
 *
 * Tiles are placed in order, each into the shortest column, as Pinterest
 * lays out. Within a column tiles only go down, so the window's tiles are
 * found per column by binary search: the cost of a scroll frame grows with
 * what is shown, not with the library.
 */

export interface MasonryOptions {
  /** The narrowest a column may be; the width decides how many fit. */
  readonly minColumn: number;
  readonly gap: number;
  /** Height under each image, for its caption. */
  readonly caption: number;
}

export interface MasonryTile {
  readonly index: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  /** The image's height; the tile is `height + caption` tall. */
  readonly height: number;
}

export interface MasonryLayout {
  readonly tiles: readonly MasonryTile[];
  /** Each column's tiles, as indices into `tiles`, top to bottom. */
  readonly columns: readonly (readonly number[])[];
  readonly columnWidth: number;
  readonly height: number;
  readonly caption: number;
}

/** Height / width when a visual records no size: square. */
const UNKNOWN_ASPECT = 1;
/** The flattest and the tallest a tile is drawn, so one panorama cannot swallow a column. */
const ASPECT_RANGE = [0.4, 2.5] as const;

export function clampAspect(aspect: number | null): number {
  if (aspect === null || !Number.isFinite(aspect) || aspect <= 0) return UNKNOWN_ASPECT;
  return Math.min(ASPECT_RANGE[1], Math.max(ASPECT_RANGE[0], aspect));
}

/** How many columns fit `width`: at least one. */
export function columnCount(width: number, options: MasonryOptions): number {
  return Math.max(1, Math.floor((width + options.gap) / (options.minColumn + options.gap)));
}

/** Lay `aspects` (height / width, in order) out across `width`. */
export function layoutMasonry(
  aspects: readonly (number | null)[],
  width: number,
  options: MasonryOptions,
): MasonryLayout {
  const count = columnCount(width, options);
  const columnWidth = Math.max(0, (width - options.gap * (count - 1)) / count);
  const bottoms: number[] = Array.from({ length: count }, () => 0);
  const columns: number[][] = Array.from({ length: count }, () => []);
  const tiles: MasonryTile[] = [];
  for (let index = 0; index < aspects.length; index++) {
    let column = 0;
    for (let c = 1; c < count; c++) if ((bottoms[c] ?? 0) < (bottoms[column] ?? 0)) column = c;
    const height = Math.round(columnWidth * clampAspect(aspects[index] ?? null));
    const y = bottoms[column] ?? 0;
    tiles.push({ index, x: column * (columnWidth + options.gap), y, width: columnWidth, height });
    columns[column]?.push(index);
    bottoms[column] = y + height + options.caption + options.gap;
  }
  const height = Math.max(0, ...bottoms.map((b) => b - options.gap));
  return { tiles, columns, columnWidth, height, caption: options.caption };
}

/** The first position in `column` whose tile reaches below `top`. */
function firstReaching(layout: MasonryLayout, column: readonly number[], top: number): number {
  let lo = 0;
  let hi = column.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    const tile = layout.tiles[column[mid] ?? 0];
    if (tile !== undefined && tile.y + tile.height + layout.caption < top) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** The tiles any part of which lies within [top, bottom], in placement order. */
export function visibleTiles(
  layout: MasonryLayout,
  top: number,
  bottom: number,
): readonly MasonryTile[] {
  const shown: MasonryTile[] = [];
  for (const column of layout.columns) {
    for (let i = firstReaching(layout, column, top); i < column.length; i++) {
      const tile = layout.tiles[column[i] ?? 0];
      if (tile === undefined || tile.y > bottom) break;
      shown.push(tile);
    }
  }
  return shown.toSorted((a, b) => a.index - b.index);
}
