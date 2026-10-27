/**
 * Composing a prompt from a subject and styles: AUTOMATIC1111's `{prompt}`
 * rule, adopted exactly (research record §2). A style template that holds
 * `{prompt}` has every occurrence replaced by the prompt so far; one that
 * does not is appended after it, joined with ", ", empty parts dropped.
 * Styles apply in order, each wrapping the result so far, and the positive
 * and negative are merged separately by the same rule. The rule is total: no
 * input loses text.
 *
 * The composition is then tidied as a person pastes it: an empty subject
 * leaves no dangling comma, and a part several styles add ("highly
 * detailed") is kept once, where it first appears.
 */

const PLACEHOLDER = "{prompt}";

/** One style template applied to the prompt so far. */
export function mergePrompt(template: string, prompt: string): string {
  // A replacer function, so a `$&` in the prompt is text, not a pattern.
  if (template.includes(PLACEHOLDER)) return template.replaceAll(PLACEHOLDER, () => prompt);
  return [prompt.trim(), template.trim()].filter((part) => part !== "").join(", ");
}

/** What a style gives a composition. */
export interface StyleTemplate {
  readonly prompt: string;
  readonly negative: string;
}

/**
 * The model families a composition is for, and whether each reads a
 * negative prompt: FLUX.2 and Veo do not (research record §2), so a
 * composition for them carries none rather than one they would ignore.
 */
export const COMPOSE_TARGETS = [
  { id: "sd", label: "Stable Diffusion", negatives: true },
  { id: "flux", label: "FLUX", negatives: false },
  { id: "video", label: "Video (Veo, Sora)", negatives: false },
] as const;
export type ComposeTarget = (typeof COMPOSE_TARGETS)[number]["id"];

export interface Composition {
  readonly positive: string;
  readonly negative: string;
}

/** `text` without empty or repeated comma-separated parts, the first of each kept. */
function tidy(text: string): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const raw of text.split(",")) {
    const part = raw.trim();
    const key = part.toLowerCase();
    if (part === "" || seen.has(key)) continue;
    seen.add(key);
    parts.push(part);
  }
  return parts.join(", ");
}

/** The subject (and its negative) with `styles` applied in order, for `target`. */
export function composePrompt(
  subject: string,
  subjectNegative: string,
  styles: readonly StyleTemplate[],
  target: ComposeTarget = "sd",
): Composition {
  const positive = tidy(styles.reduce((so, style) => mergePrompt(style.prompt, so), subject));
  const reads = COMPOSE_TARGETS.find((t) => t.id === target)?.negatives ?? true;
  if (!reads) return { positive, negative: "" };
  const negative = tidy(
    styles.reduce((so, style) => mergePrompt(style.negative, so), subjectNegative),
  );
  return { positive, negative };
}
