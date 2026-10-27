/**
 * An SVG kept as an asset is written back from what kb read of it: drawing
 * kept, and nothing that runs, reaches out of the document or embeds HTML,
 * however it is spelled. Markup that does not read as XML tags is refused.
 */
import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { sanitizeSvg } from "../src/svg-sanitize.ts";

const NS = 'xmlns="http://www.w3.org/2000/svg"';
const svg = (inner: string, attrs = "") => `<svg ${NS}${attrs}>${inner}</svg>`;

/** What no kept SVG holds: script, handlers, foreign HTML, a scheme that runs, a reference out. */
function holdsNothingThatRuns(out: string): void {
  expect(out).not.toMatch(/<\s*script/i);
  expect(out).not.toMatch(/<\s*foreignObject/i);
  expect(out).not.toMatch(/<\s*(iframe|object|embed|animate|set)\b/i);
  expect(out).not.toMatch(/\son[a-z]+\s*=/i);
  expect(out).not.toMatch(/javascript:/i);
  expect(out).not.toMatch(/href="(?!#|data:image\/(png|jpeg|gif|webp);base64,)/i);
  expect(out).not.toMatch(/url\(\s*['"]?(?!#)/i);
  expect(out).not.toMatch(/@import/i);
}

/** What may end a CSS hex escape: any one whitespace, a CRLF counted as one. */
const TERMINATORS = [" ", "\t", "\n", "\r", "\f", "\r\n"] as const;

/**
 * `css` with each character `escape` picks written as a CSS hex escape,
 * each ended by the terminator `ends` picks; the vectors are ASCII, so a
 * character is one unit.
 */
const escaped = (
  css: string,
  escape: readonly boolean[],
  ends: readonly (typeof TERMINATORS)[number][],
) =>
  css
    .split("")
    .map((char, at) =>
      escape[at % escape.length] === true
        ? `\\${char.codePointAt(0)?.toString(16)}${ends[at % ends.length] ?? " "}`
        : char,
    )
    .join("");

describe("sanitizeSvg", () => {
  test("keeps a drawing as it was", () => {
    const drawing = svg(
      '<defs><linearGradient id="g"><stop offset="0" stop-color="#f00"/></linearGradient></defs>' +
        '<g transform="translate(1 2)"><rect width="10" height="5" fill="url(#g)"/>' +
        '<path d="M0 0L10 10"/><text x="1" y="2">a &amp; b</text></g><use href="#g"/>',
      ' viewBox="0 0 10 10"',
    );
    expect(sanitizeSvg(drawing)).toBe(drawing);
  });

  test("names SVG's namespace on a root that leaves it out, as an image needs", () => {
    expect(sanitizeSvg('<svg viewBox="0 0 1 1"><circle r="1"/></svg>')).toBe(
      `<svg ${NS} viewBox="0 0 1 1"><circle r="1"/></svg>`,
    );
  });

  test("drops script and foreign HTML with everything they hold", () => {
    const out = sanitizeSvg(
      svg(
        '<script>alert(1)</script><SCRIPT type="x">alert(2)</SCRIPT><rect width="1"/>' +
          '<foreignObject><div onclick="x"><p>hi</p></div></foreignObject>' +
          '<animate attributeName="href" to="javascript:alert(3)"/><set attributeName="onload"/>',
      ),
    );
    expect(out).toBe(svg('<rect width="1"/>'));
  });

  test("drops handlers and references out, however they are spelled", () => {
    const out = sanitizeSvg(
      svg(
        '<rect width="1" onload="alert(1)" OnMouseOver="x"/>' +
          '<use href="https://evil.example/x.svg#a"/><use xlink:href="jav&#x09;ascript:alert(1)"/>' +
          '<image href="data:image/svg+xml;base64,PHN2Zz4="/><image href="data:image/png;base64,AAAA"/>' +
          '<rect style="fill:url(http://evil.example/p)"/><rect fill="url(&#39;https://x&#39;)"/>',
      ),
    );
    expect(out).toBe(
      svg(
        '<rect width="1"/><use/><use/><image/><image href="data:image/png;base64,AAAA"/><rect/><rect/>',
      ),
    );
  });

  test("keeps CSS that stays in the document, and empties CSS that reaches out", () => {
    expect(sanitizeSvg(svg("<style>.a{fill:url(#g)}</style>"))).toBe(
      svg("<style>.a{fill:url(#g)}</style>"),
    );
    expect(sanitizeSvg(svg('<style>@import "https://x";.a{}</style><rect/>'))).toBe(
      svg("<style></style><rect/>"),
    );
    expect(sanitizeSvg(svg("<style><![CDATA[.a{background:url(//x)}]]></style>"))).toBe(
      svg("<style></style>"),
    );
  });

  test("empties CSS that reaches out however it is spelled: escaped, or split across tokens", () => {
    // A CSS escape is read before the filter looks: `\75` is `u`, `\69` is `i`.
    expect(sanitizeSvg(svg('<rect style="fill:\\75 rl(https://x/p)"/>'))).toBe(svg("<rect/>"));
    expect(sanitizeSvg(svg("<rect fill='\\75 rl(https://x/p)'/>"))).toBe(svg("<rect/>"));
    expect(sanitizeSvg(svg("<style>.a{fill:\\75 rl(https://x/p)}</style>"))).toBe(
      svg("<style></style>"),
    );
    expect(sanitizeSvg(svg('<style>@\\69mport "https://x";</style>'))).toBe(svg("<style></style>"));
    // A style element's CSS is all of its text, however the markup cuts it.
    expect(sanitizeSvg(svg('<style>@im<![CDATA[port "https://x";]]></style>'))).toBe(
      svg("<style></style>"),
    );
    expect(sanitizeSvg(svg('<style>@im<!-- -->port "https://x";</style>'))).toBe(
      svg("<style></style>"),
    );
    // An unclosed url() still fetches, and image-set() fetches a bare string.
    expect(sanitizeSvg(svg("<style>.a{fill:url(https://x/p</style>"))).toBe(svg("<style></style>"));
    expect(sanitizeSvg(svg('<style>.a{background:image-set("https://x/p" 1x)}</style>'))).toBe(
      svg("<style></style>"),
    );
    // CSS that stays home is kept whole, escapes and all.
    expect(sanitizeSvg(svg("<style>.a{fill:url(#g)}.b\\:c{}</style>"))).toBe(
      svg("<style>.a{fill:url(#g)}.b\\:c{}</style>"),
    );
  });

  test("a carriage return ends a CSS escape, alone or before a line feed", () => {
    expect(sanitizeSvg(svg('<rect style="fill:\\75&#13;rl(https://x/p)"/>'))).toBe(svg("<rect/>"));
    for (const end of ["&#13;", "\r", "\r\n"]) {
      expect(sanitizeSvg(svg(`<style>.a{fill:\\75${end}rl(https://x/p)}</style>`))).toBe(
        svg("<style></style>"),
      );
    }
  });

  test("empties CSS that fetches a bare string through image() or src()", () => {
    expect(sanitizeSvg(svg('<style>.a{background:image("https://x/a.png")}</style>'))).toBe(
      svg("<style></style>"),
    );
    expect(sanitizeSvg(svg('<style>.a{background:src("https://x/a.png")}</style>'))).toBe(
      svg("<style></style>"),
    );
    expect(sanitizeSvg(svg(`<rect style='background:image("https://x/a.png")'/>`))).toBe(
      svg("<rect/>"),
    );
    expect(sanitizeSvg(svg(`<rect style='background:src("https://x/a.png")'/>`))).toBe(
      svg("<rect/>"),
    );
  });

  test("judges a reference by its local name, whatever prefix spells it, and drops xml:base", () => {
    const xlink = ' xmlns:x="http://www.w3.org/1999/xlink"';
    expect(
      sanitizeSvg(
        svg(
          '<image x:href="https://attacker.example/t.png"/><use x:href="https://attacker.example/u.svg#a"/>' +
            '<use x:href="#a"/>',
          xlink,
        ),
      ),
    ).toBe(svg('<image/><use/><use x:href="#a"/>', xlink));
    expect(sanitizeSvg(svg("<rect/>", ' xml:base="https://attacker.example/"'))).toBe(
      svg("<rect/>"),
    );
  });

  test("a style element holds CSS alone: an element inside it goes with all it holds", () => {
    expect(sanitizeSvg(svg('<style><rect>@import "https://x/a";</rect></style>'))).toBe(
      svg("<style></style>"),
    );
    expect(sanitizeSvg(svg("<style>.a{fill:red}<g/></style>"))).toBe(
      svg("<style>.a{fill:red}</style>"),
    );
  });

  test("however a fetch is spelled in CSS escapes, the CSS that holds it is not kept", () => {
    const fetches = [
      '@import "https://x/a";',
      ".a{fill:url(https://x/p)}",
      '.a{background:image("https://x/a.png")}',
      '.a{background:image-set("https://x/a.png" 1x)}',
    ];
    fc.assert(
      fc.property(
        fc.constantFrom(...fetches),
        fc.array(fc.boolean(), { minLength: 1, maxLength: 16 }),
        fc.array(fc.constantFrom(...TERMINATORS), { minLength: 1, maxLength: 8 }),
        (css, escape, ends) => {
          const written = escaped(css, escape, ends);
          expect(sanitizeSvg(svg(`<style>${written}</style>`))).toBe(svg("<style></style>"));
          // In an attribute, whitespace is written as a character reference, as XML keeps it.
          const attr = written
            .replaceAll("&", "&amp;")
            .replaceAll('"', "&quot;")
            .replaceAll(/[\t\n\r\f]/g, (ws) => `&#${ws.codePointAt(0)};`);
          expect(sanitizeSvg(svg(`<rect style="${attr}"/>`))).toBe(svg("<rect/>"));
        },
      ),
    );
  });

  test("unwraps a link: its drawing stays, the link goes", () => {
    expect(sanitizeSvg(svg('<a href="javascript:alert(1)"><circle r="2"/></a>'))).toBe(
      svg('<circle r="2"/>'),
    );
  });

  test("leaves comments, instructions, declarations and their entities out", () => {
    const markup =
      '<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x "<script>alert(1)</script>">]>' +
      `<!-- <script>alert(2)</script> -->${svg("<text>&x;</text>")}`;
    expect(sanitizeSvg(markup)).toBe(svg("<text>&amp;x;</text>"));
  });

  test("refuses what holds no svg element, or does not read as tags", () => {
    expect(sanitizeSvg("hello")).toBeNull();
    expect(sanitizeSvg("<html><body/></html>")).toBeNull();
    expect(sanitizeSvg("<svg/onload=alert(1)>")).toBeNull();
    expect(sanitizeSvg(`<svg ${NS}><rect`)).toBeNull();
  });

  test("whatever is mixed into a drawing, what is kept runs nothing, and keeping it again changes nothing", () => {
    const parts = fc.constantFrom(
      '<rect width="1"/>',
      "<script>alert(1)</script>",
      '<g onload="x"><circle r="1"/></g>',
      '<use href="http://evil.example/#a"/>',
      '<image xlink:href="javascript:alert(1)"/>',
      "<foreignObject><iframe src=x></iframe></foreignObject>",
      '<style>.a{fill:url("https://x")}</style>',
      '<a href="#b"><path d="M0 0"/></a>',
      "<!-- <script> -->",
      "<![CDATA[<script>alert(1)</script>]]>",
      "text & more",
      '<text x="1">&lt;script&gt;</text>',
      "</g>",
      "<g>",
      "<style>@im",
      'port "https://x";</style>',
      "<!-- -->",
      '<rect style="fill:\\75 rl(https://x)"/>',
      '<image x:href="https://attacker.example/t.png"/>',
      '<use x:href="https://attacker.example/u.svg#a"/>',
      '<style><rect>@import "https://x/a";</rect></style>',
    );
    fc.assert(
      fc.property(fc.array(parts, { maxLength: 12 }), (inner) => {
        const out = sanitizeSvg(svg(inner.join("")));
        if (out === null) return;
        holdsNothingThatRuns(out);
        expect(sanitizeSvg(out)).toBe(out);
      }),
    );
  });
});
