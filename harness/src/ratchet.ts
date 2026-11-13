/**
 * The deterministic-debt ratchet, as pure functions over the committed ledger.
 *
 * Three parts of the canonical two-mechanism rule (AGENTS.md, Drift markers):
 * the ledger equals reality exactly (`ratchetMismatches`); the ledger never
 * rises against the base the change started from (`ratchetRises`), so a
 * regenerated snapshot cannot quietly hold new debt; and a `warn` rule whose
 * debt reached zero is promoted to `error` rather than left as a silent lane
 * (`unpromotedWarnRules`). The tests in `lint-warn-ratchet.test.ts` bind them
 * to the live collectors, the base's ledger and `.oxlintrc.json`.
 */

/** Every identity whose ledger count differs from the collector's, either way. */
export function ratchetMismatches(
  baseline: Record<string, number>,
  current: Record<string, number>,
  lane: string,
): string[] {
  const mismatches: string[] = [];
  for (const [identity, baselineCount] of Object.entries(baseline)) {
    const currentCount = current[identity] ?? 0;
    if (currentCount !== baselineCount) {
      mismatches.push(
        `${lane} ${identity} count changed from ${baselineCount} to ${currentCount}; run bun run harness:snapshot`,
      );
    }
  }
  for (const [identity, currentCount] of Object.entries(current)) {
    if (!(identity in baseline) && currentCount > 0) {
      mismatches.push(
        `${lane} ${identity} appeared with count ${currentCount}; run bun run harness:snapshot`,
      );
    }
  }
  return mismatches.toSorted();
}

/**
 * Every identity whose count is higher than at the base, or that the base did
 * not hold at all. A fall is not a rise: draining debt lowers the ledger.
 */
export function ratchetRises(
  base: Record<string, number>,
  current: Record<string, number>,
  lane: string,
): string[] {
  const rises: string[] = [];
  for (const [identity, count] of Object.entries(current)) {
    const was = base[identity] ?? 0;
    if (count > was) {
      rises.push(
        `${lane} ${identity} rose from ${was} to ${count} against the base; drain it instead of raising the baseline`,
      );
    }
  }
  return rises.toSorted();
}

/** Oxlint rule severities as `.oxlintrc.json` writes them: a string or `[severity, options]`. */
export type OxlintRuleSetting = string | readonly [string, ...unknown[]];

function severityOf(setting: OxlintRuleSetting): string {
  return typeof setting === "string" ? setting : setting[0];
}

/**
 * `warn` rules with no debt left. A rule sits at `warn` only while the ledger
 * holds its count; at zero it is promoted to `error` in `.oxlintrc.json`, and
 * a rule that is `warn` yet absent from the ledger is a lane nothing checks.
 */
export function unpromotedWarnRules(
  rules: Record<string, OxlintRuleSetting>,
  ledger: Record<string, number>,
): string[] {
  const unpromoted: string[] = [];
  for (const [rule, setting] of Object.entries(rules)) {
    if (severityOf(setting) !== "warn") continue;
    if ((ledger[rule] ?? 0) > 0) continue;
    unpromoted.push(
      `${rule} is "warn" with no debt in the ledger; promote it to "error" in .oxlintrc.json`,
    );
  }
  return unpromoted.toSorted();
}

/** Carry path-keyed debt with Git-detected renames; other identities stay unchanged. */
export function renamedBaseLanes<Lanes extends { [Key in keyof Lanes]: Record<string, number> }>(
  lanes: Lanes,
  nameStatus: string,
): { [Key in keyof Lanes]: Record<string, number> } {
  const paths = new Map<string, string>();
  const fields = nameStatus.split("\0");
  for (let index = 0; index < fields.length; index++) {
    const status = fields[index];
    if (status === undefined || !status.startsWith("R")) continue;
    const from = fields[++index];
    const to = fields[++index];
    if (from === undefined || to === undefined) throw new Error("incomplete Git rename record");
    paths.set(from, to);
    if (from.startsWith("packages/") && to.startsWith("packages/")) {
      paths.set(from.slice("packages/".length), to.slice("packages/".length));
    }
  }
  return Object.fromEntries(
    Object.entries<Record<string, number>>(lanes).map(([lane, counts]) => {
      const moved: Record<string, number> = {};
      for (const [identity, count] of Object.entries(counts)) {
        const key = identity
          .split(/(:| imports )/)
          .map((part) => paths.get(part) ?? part)
          .join("");
        moved[key] = (moved[key] ?? 0) + count;
      }
      return [lane, moved];
    }),
  ) as { [Key in keyof Lanes]: Record<string, number> };
}
