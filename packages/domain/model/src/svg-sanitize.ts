/**
 * An SVG made safe to keep as an asset (DESIGN.md → `asset.upload`): SVG is
 * markup, so it can carry script, event handlers, foreign HTML and links out.
 * `asset.upload` keeps an `.svg` only as this module writes it back: the
 * document is read token by token and written again from what it read, so
 * nothing passes through as it came. An element kb does not list is dropped
 * with all it holds; `a` alone is unwrapped, its drawing kept. An attribute
 * survives only with a plain name, no `on…` handler, no `xml:base`, and a value that leads
 * nowhere outside the document: a reference (`href` under any prefix) is `#fragment` (an `image` may
 * hold a raster `data:` picture), and CSS may name no `url()` but a fragment,
 * no `image()`, `image-set()` or `src()`, no `@import` and no `expression()`, read after its escapes
 * and, for a style element, over all its text at once (a style element whose
 * CSS does is kept empty; an element inside a style element is dropped). Comments, processing instructions and
 * DOCTYPEs (and the entities they declare) go. Markup that does not read as
 * XML tags is refused whole. The asset is then served as an image, never
 * inlined into a page, so this is the second wall, not the only one.
 */

/** The elements kept: drawing, text, paint servers, clipping, markers and filters. */
const ELEMENTS = new Set(
  [
    "svg",
    "g",
    "defs",
    "title",
    "desc",
    "metadata",
    "symbol",
    "use",
    "path",
    "rect",
    "circle",
    "ellipse",
    "line",
    "polyline",
    "polygon",
    "text",
    "tspan",
    "textPath",
    "image",
    "linearGradient",
    "radialGradient",
    "stop",
    "clipPath",
    "mask",
    "pattern",
    "marker",
    "style",
    "filter",
    "feBlend",
    "feColorMatrix",
    "feComponentTransfer",
    "feComposite",
    "feDropShadow",
    "feFlood",
    "feFuncA",
    "feFuncB",
    "feFuncG",
    "feFuncR",
    "feGaussianBlur",
    "feMerge",
    "feMergeNode",
    "feMorphology",
    "feOffset",
  ].map((name) => name.toLowerCase()),
);

/** Elements whose tags go but whose drawing stays: a link around shapes is the shapes. */
const UNWRAPPED = new Set(["a"]);

const NAME = /^[A-Za-z_][-\w.:]*$/;
const SVG_NS = "http://www.w3.org/2000/svg";
/** A raster picture an `image` may carry in itself: never a reference out, never SVG. */
const RASTER_DATA = /^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/=\s]*$/i;

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

/** Text with its character references read, an unknown named one left as written. */
function decode(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, ref: string) => {
    if (ref.startsWith("#")) {
      const code =
        ref[1] === "x" || ref[1] === "X"
          ? Number.parseInt(ref.slice(2), 16)
          : Number.parseInt(ref.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : "";
    }
    return NAMED_ENTITIES[ref.toLowerCase()] ?? whole;
  });
}

const escapeText = (text: string) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const escapeValue = (value: string) => escapeText(value).replaceAll('"', "&quot;");

/** CSS text with its escapes read as CSS reads them: `\\75` is `u`, `\\@` is `@`, an escaped newline is nothing. */
function decodeCss(css: string): string {
  return css.replace(
    /\\(?:([0-9a-f]{1,6})[ \t\n\f]?|\r\n|([\s\S])|$)/gi,
    (_, hex?: string, char?: string) => {
      if (hex !== undefined) {
        const code = Number.parseInt(hex, 16);
        return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "\uFFFD";
      }
      return char === undefined || /[\n\f\r]/.test(char) ? "" : char;
    },
  );
}

/** Whether CSS, read as written, names something outside the document or something that runs. */
function reachesOut(css: string): boolean {
  // `image()`, `image-set()` and `src()` fetch a bare string, with no `url(` to see.
  if (
    /@import|expression\s*\(|javascript:|behavior\s*:|-moz-binding|(?:image(?:-set)?|src)\s*\(/i.test(
      css,
    )
  )
    return true;
  // Unclosed, `url(` still fetches to the end of the CSS, so only what follows the paren counts.
  for (const match of css.matchAll(/url\s*\(\s*['"]?(.?)/gi)) if (match[1] !== "#") return true;
  return false;
}

/**
 * Whether CSS text reaches nothing outside the document and runs nothing,
 * however it is spelled: escapes are read first, and it is judged both with
 * its comments and without them, so neither reading hides a fetch.
 */
function safeCss(css: string): boolean {
  const read = decodeCss(css);
  return !reachesOut(read) && !reachesOut(read.replace(/\/\*[\s\S]*?(?:\*\/|$)/g, ""));
}

/** Whether a value reads as a scheme that runs or reaches out, however it is spelled. */
function runsScript(value: string): boolean {
  // oxlint-disable-next-line no-control-regex -- a scheme may be split by control characters
  const squeezed = value.replace(/[\u0000- ]/g, "").toLowerCase();
  return /(?:java|vb)script:|data:text\/html/.test(squeezed);
}

/** `value` as attribute `name` of element `element` may keep it, or null to drop it. */
function keptValue(element: string, name: string, value: string): string | null {
  const lower = name.toLowerCase();
  if (lower.startsWith("on") || !NAME.test(name)) return null;
  // A base would turn every relative reference into one out of the document.
  if (lower === "xml:base" || runsScript(value)) return null;
  // A reference is judged by its local name: any prefix may be bound to XLink's namespace.
  if (lower.split(":").at(-1) === "href") {
    const target = value.trim();
    if (target.startsWith("#")) return target;
    return element === "image" && RASTER_DATA.test(target) ? target : null;
  }
  // Every value is CSS to some reader (presentation attributes are), so every value is judged as CSS.
  return safeCss(value) ? value : null;
}

interface Token {
  readonly kind: "open" | "close" | "text";
  readonly name: string;
  readonly attrs: ReadonlyArray<readonly [string, string]>;
  readonly selfClosing: boolean;
  readonly text: string;
}

const ATTR = /\s*([^\s=/>"'<]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/y;

/** The attributes of a tag's inside, or null when it does not read as attributes. */
function readAttrs(inside: string): Array<readonly [string, string]> | null {
  const attrs: Array<readonly [string, string]> = [];
  ATTR.lastIndex = 0;
  while (ATTR.lastIndex < inside.length) {
    if (/^\s*$/.test(inside.slice(ATTR.lastIndex))) break;
    const match = ATTR.exec(inside);
    if (match === null) return null;
    attrs.push([match[1] ?? "", decode(match[2] ?? match[3] ?? match[4] ?? "")]);
  }
  return attrs;
}

/** Where markup that opens at `at` with `open` ends, past `close`; -1 when it never does. */
function endOf(text: string, at: number, close: string): number {
  const end = text.indexOf(close, at);
  return end === -1 ? -1 : end + close.length;
}

/** Skip a `<!…>` declaration starting at `at`, an internal subset included. */
function endOfDeclaration(text: string, at: number): number {
  const bracket = text.indexOf("[", at);
  const close = text.indexOf(">", at);
  if (close === -1) return -1;
  if (bracket !== -1 && bracket < close) return endOf(text, bracket, "]>");
  return close + 1;
}

/** The tag starting at `at` (just past `<`), and where it ends; null when it is no tag. */
function readTag(text: string, at: number): { token: Token; end: number } | null {
  const close = text.indexOf(">", at);
  if (close === -1) return null;
  let inside = text.slice(at, close);
  const closing = inside.startsWith("/");
  if (closing) inside = inside.slice(1);
  const selfClosing = inside.endsWith("/");
  if (selfClosing) inside = inside.slice(0, -1);
  const name = /^[A-Za-z_][-\w.:]*/.exec(inside)?.[0];
  if (name === undefined) return null;
  const attrs = readAttrs(inside.slice(name.length));
  if (attrs === null || (closing && attrs.length > 0)) return null;
  const kind = closing ? "close" : "open";
  return { token: { kind, name, attrs, selfClosing, text: "" }, end: close + 1 };
}

/** The document as tokens, or null when it does not read as XML tags. */
function tokenize(text: string): Token[] | null {
  const tokens: Token[] = [];
  let at = 0;
  const pushText = (raw: string) => {
    if (raw !== "")
      tokens.push({ kind: "text", name: "", attrs: [], selfClosing: false, text: raw });
  };
  while (at < text.length) {
    const lt = text.indexOf("<", at);
    if (lt === -1) {
      pushText(decode(text.slice(at)));
      break;
    }
    pushText(decode(text.slice(at, lt)));
    let end: number;
    if (text.startsWith("<!--", lt)) end = endOf(text, lt + 4, "-->");
    else if (text.startsWith("<![CDATA[", lt)) {
      end = endOf(text, lt + 9, "]]>");
      if (end !== -1) pushText(text.slice(lt + 9, end - 3));
    } else if (text.startsWith("<?", lt)) end = endOf(text, lt + 2, "?>");
    else if (text.startsWith("<!", lt)) end = endOfDeclaration(text, lt + 2);
    else {
      const tag = readTag(text, lt + 1);
      if (tag === null) return null;
      tokens.push(tag.token);
      end = tag.end;
    }
    if (end === -1) return null;
    at = end;
  }
  return tokens;
}

/** A start tag as kept: its name as written, its kept attributes; the root names SVG's namespace. */
function openTag(token: Token, root: boolean): string {
  const element = token.name.toLowerCase();
  const kept = token.attrs.flatMap(([name, value]) => {
    const safe = keptValue(element, name, value);
    return safe === null ? [] : [` ${name}="${escapeValue(safe)}"`];
  });
  if (root && !token.attrs.some(([name]) => name === "xmlns")) kept.unshift(` xmlns="${SVG_NS}"`);
  return `<${token.name}${kept.join("")}${token.selfClosing ? "/>" : ">"}`;
}

/**
 * The document written back as it is read, one token at a time: the root
 * `<svg>` and what it holds, kept elements as `openTag` writes them, a
 * dropped element skipped with all it holds.
 */
class SvgWriter {
  readonly out: string[] = [];
  /** The kept elements open now, by lowercase name, with the name each was opened with. */
  private readonly open: Array<{ readonly lower: string; readonly name: string }> = [];
  /** How deep inside a dropped element the reader is; 0 outside one. */
  private dropping = 0;
  /**
   * The text of the style element open now, kept until it closes: its CSS
   * is all of that text, however comments or CDATA cut it, so it is judged whole.
   */
  private css: string[] = [];
  started = false;
  done = false;

  private inStyle(): boolean {
    return this.open.at(-1)?.lower === "style";
  }

  take(token: Token): void {
    if (token.kind === "text") this.text(token.text);
    else if (this.dropping > 0) this.skip(token);
    else if (token.kind === "open") this.opening(token);
    else this.closing(token.name.toLowerCase());
  }

  private text(text: string): void {
    if (!this.started || this.dropping > 0) return;
    if (this.inStyle()) this.css.push(text);
    else this.out.push(escapeText(text));
  }

  private skip(token: Token): void {
    if (token.kind === "open" && !token.selfClosing) this.dropping += 1;
    if (token.kind === "close") this.dropping -= 1;
  }

  private opening(token: Token): void {
    const element = token.name.toLowerCase();
    // A style element holds CSS alone: an element inside it goes with all it holds.
    if (this.inStyle()) {
      if (!token.selfClosing) this.dropping = 1;
      return;
    }
    if (!this.started && element !== "svg") return;
    this.started = true;
    if (UNWRAPPED.has(element)) return;
    if (!ELEMENTS.has(element)) {
      if (!token.selfClosing) this.dropping = 1;
      return;
    }
    this.out.push(openTag(token, this.open.length === 0));
    if (!token.selfClosing) this.open.push({ lower: element, name: token.name });
    else if (this.open.length === 0) this.done = true;
  }

  /** A close tag ends the element it names and any left open inside it. */
  private closing(element: string): void {
    if (!this.started || UNWRAPPED.has(element)) return;
    const index = this.open.findLastIndex((entry) => entry.lower === element);
    if (index === -1) return;
    this.closeTo(index);
    if (this.open.length === 0) this.done = true;
  }

  closeTo(index: number): void {
    while (this.open.length > index) {
      const entry = this.open.pop();
      if (entry?.lower === "style") this.endStyle();
      this.out.push(`</${entry?.name ?? ""}>`);
    }
  }

  /** CSS kb cannot vouch for is left out: its style element stays, empty. */
  private endStyle(): void {
    const css = this.css.join("");
    this.css = [];
    if (safeCss(css)) this.out.push(escapeText(css));
  }
}

/**
 * `markup` written back as an SVG kb keeps, its root `<svg>` and what it
 * holds, or null when it holds no `<svg>` element or does not read as XML.
 */
export function sanitizeSvg(markup: string): string | null {
  const tokens = tokenize(markup.replace(/^\uFEFF/, ""));
  if (tokens === null) return null;
  const writer = new SvgWriter();
  for (const token of tokens) {
    if (writer.done) break;
    writer.take(token);
  }
  if (!writer.started) return null;
  writer.closeTo(0);
  return writer.out.join("");
}
