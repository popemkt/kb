/**
 * A paste of several lines into a many-valued field, as data (the pure half
 * of `FieldValueStack`'s paste): one value per line, read the way the field
 * reads a value typed or picked one at a time.
 */
import type { PickerCandidate, PropValue, ValueKindSpec } from "@kb/ui-sdk";

/** The lines a paste holds, each trimmed, the empty ones dropped. */
function pastedLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

/** One line of a paste: a value to add, or a target to make by that name first. */
export type PastedValue =
  | { readonly kind: "value"; readonly value: PropValue }
  | { readonly kind: "create"; readonly name: string };

/** What a field reads a pasted line against. */
export interface PasteReader {
  /** The field's kind: a typed one parses the line, a picked one names a target. */
  readonly spec: ValueKindSpec;
  /** The targets a picked field may hold, as its picker offers them; a disabled one is not taken. */
  readonly targets: readonly PickerCandidate[];
  /** The field may mint a target by name, as its picker's create row does. */
  readonly canCreate: boolean;
}

/**
 * What each line is to the field: a typed kind's value, read by the kind
 * (`spec.parse`); a picked kind's target, the one its picker offers by that
 * exact name, else a new one by that name where the field may make one. Null
 * when the paste is not a list of values — fewer than two lines, or a line
 * the field cannot read or name — so it stays the editor's, as typing is.
 */
export function pastedValues(text: string, reader: PasteReader): PastedValue[] | null {
  const lines = pastedLines(text);
  if (lines.length < 2) return null;
  const out: PastedValue[] = [];
  for (const line of lines) {
    const read = readLine(line, reader);
    if (read === null) return null;
    out.push(read);
  }
  return out;
}

function readLine(line: string, { spec, targets, canCreate }: PasteReader): PastedValue | null {
  if (spec.editor !== "picker") {
    const parsed = spec.parse(line);
    return parsed.ok ? { kind: "value", value: parsed.value } : null;
  }
  // A name a person typed resolves to an id once, here; two targets by one
  // name are not guessed between.
  const named = targets.filter((target) => target.label === line);
  const [only] = named;
  if (named.length > 1 || only?.disabled === true) return null;
  if (only !== undefined) return { kind: "value", value: { t: "ref", v: only.id } };
  return canCreate ? { kind: "create", name: line } : null;
}
