import { describe, expect, test } from "bun:test";
import { computedImports } from "../src/computed-imports.ts";

/**
 * Which `import(` calls of a bundle the closure check refuses: those whose
 * argument is not one string literal, read past strings, templates,
 * comments and regular expressions, so text inside one is never code.
 */
describe("computed imports in a bundle", () => {
  test.each([
    ["a literal", `var a=import("x");`, 0],
    ["a literal with space", `import ( "fs" )`, 0],
    ["a name", `var a=import(n);`, 1],
    ["a literal joined to a name", `import("a" + b)`, 1],
    ["text in strings", `var s="import(n)";var t='import(y)';`, 0],
    ["text in a template", "var t=`import(${'x'}) ${ {a:1}.a } import(z)`;", 0],
    ["a call inside a template's expression", "var t=`${import(q)}`;", 1],
    [
      "text in a regular expression, beside a division",
      "var r=/import(x)/g;var d=a/b/c;import(m)",
      1,
    ],
    ["a quote inside a regular expression after return", `return /"/.test(x);import(m)`, 1],
    ["text in comments", "// import(m)\n/* import(n) */ var x=1;", 0],
    ["a method named import", "x.import(m)", 0],
    ["import.meta", "import.meta.url", 0],
  ])("%s", (_what, code, found) => {
    expect(computedImports(code).length).toBe(found);
  });
});
