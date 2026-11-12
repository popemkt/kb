/** GAP [[01M787F34W9DSYPD544DRS5S4H]]: small concept groups can remain below the threshold.
 * Calibrated cohesion sensor over the production symbol-consumer graph. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  COHESION_MIN_LINES,
  COHESION_MIN_IMPORTERS,
  COHESION_IMPORTER_FRACTION,
} from "./constraints.ts";
import { symbolConsumers, type ConsumedSymbol } from "./symbol-consumers.ts";
import { PACKAGES_ROOT } from "./workspace.ts";

/** Count meaningful connected components of overlapping importer sets.
 * Small satellite groups are ignored by the one calibrated threshold.
 */
export function cohesionGroups(symbols: readonly ConsumedSymbol[]): number {
  const groups: Array<Set<string>> = [];
  for (const symbol of symbols) {
    if (symbol.importers.size === 0) continue;
    const touching = groups.filter((group) =>
      [...symbol.importers].some((file) => group.has(file)),
    );
    const combined = new Set([...symbol.importers, ...touching.flatMap((group) => [...group])]);
    for (const group of touching) groups.splice(groups.indexOf(group), 1);
    groups.push(combined);
  }
  const total = new Set(groups.flatMap((group) => [...group])).size;
  const threshold = Math.max(COHESION_MIN_IMPORTERS, Math.ceil(total * COHESION_IMPORTER_FRACTION));
  return groups.filter((group) => group.size >= threshold).length;
}

/** Excess importer groups in files above the concept-size sensor threshold. */
export function collectCohesion(packagesRoot: string = PACKAGES_ROOT): Record<string, number> {
  const byFile = new Map<string, ConsumedSymbol[]>();
  for (const symbol of symbolConsumers(packagesRoot)) {
    const symbols = byFile.get(symbol.file) ?? [];
    symbols.push(symbol);
    byFile.set(symbol.file, symbols);
  }
  const findings: Record<string, number> = {};
  for (const [file, symbols] of byFile) {
    const source = readFileSync(join(packagesRoot, file), "utf8");
    const lines = source.split("\n").length - (source.endsWith("\n") ? 1 : 0);
    if (lines <= COHESION_MIN_LINES) continue;
    const groups = cohesionGroups(symbols);
    if (groups > 1) findings[file] = groups - 1;
  }
  return findings;
}
