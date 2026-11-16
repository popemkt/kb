/**
 * What Count words counts (DESIGN-UI.md → Outline editor, "What rows hold,
 * read and copied"): the nodes some rows show and every node under them,
 * each once, read as plain words.
 */
import { plainWords, shownWalk, type ShownRow } from "@kb/model";
import type { OutlineNode, SchemaIndex } from "@kb/ui-sdk";

export interface WordCount {
  readonly words: number;
  readonly characters: number;
  readonly nodes: number;
}

/** How many words and characters `text` holds, as `Intl.Segmenter` splits it. */
function measure(text: string): { readonly words: number; readonly characters: number } {
  let words = 0;
  for (const segment of new Intl.Segmenter(undefined, { granularity: "word" }).segment(text)) {
    if (segment.isWordLike === true) words += 1;
  }
  const characters = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)]
    .length;
  return { words, characters };
}

/**
 * The words, characters and nodes of what rows `rowIds` show and every node
 * under them, in `schema`: the rows `shownWalk` meets, a row counting the
 * node it shows and a reference not followed below it; a node met twice
 * counts once.
 */
export function countWords(rowIds: readonly string[], schema: SchemaIndex): WordCount {
  const counted = new Set<string>();
  let words = 0;
  let characters = 0;
  const count = (rows: readonly ShownRow<OutlineNode>[]): void => {
    for (const { shown, children } of rows) {
      if (!counted.has(shown.id)) {
        counted.add(shown.id);
        const measured = measure(plainWords(shown.text, (other) => schema.get(other)));
        words += measured.words;
        characters += measured.characters;
      }
      count(children);
    }
  };
  count(shownWalk(rowIds, (id) => schema.get(id)));
  return { words, characters, nodes: counted.size };
}

/** `n` of `one` thing, read as a person says it: "1 word", "1,204 words". */
function amount(n: number, one: string): string {
  return `${n.toLocaleString()} ${one}${n === 1 ? "" : "s"}`;
}

/** A count as its toast says it: "120 words · 643 characters · 9 nodes". */
export function sayCount({ words, characters, nodes }: WordCount): string {
  return [amount(words, "word"), amount(characters, "character"), amount(nodes, "node")].join(
    " · ",
  );
}
