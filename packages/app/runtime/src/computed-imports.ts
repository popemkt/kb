/**
 * The `import(` calls of a bundled module whose argument is not a string
 * literal: what an extension's closure check refuses as code the bundle
 * cannot see (`extension-closure.ts`). It reads the bundler's output
 * token by token, so a string, a template, a comment or a regular
 * expression is skipped whole and no text inside one is taken for code.
 */

/** Where the reading is, and what it has found. */
interface Lexer {
  readonly code: string;
  at: number;
  /** The last token, as far as a `/` after it reads: a word's last character, punctuation, or `value`. */
  previous: string;
  /** The templates open around `at`, each with the depth of braces inside its current `${`. */
  readonly templates: number[];
  readonly found: number[];
}

const WORD = /[\w$]/;
const SPACE = /\s/;
/** After one of these a `/` divides; after anything else it starts a regular expression. */
const DIVIDES_AFTER = /^([\w$)\]}]|value)$/;
/** The words after which a `/` starts a regular expression, as an operator's does. */
const OPERATOR_WORDS = new Set([
  "return",
  "typeof",
  "instanceof",
  "in",
  "of",
  "new",
  "delete",
  "void",
  "throw",
  "case",
  "do",
  "else",
  "yield",
  "await",
]);

const charAt = (lexer: Lexer, offset = 0) => lexer.code[lexer.at + offset] ?? "";

function skipWhile(lexer: Lexer, pattern: RegExp): void {
  while (lexer.at < lexer.code.length && pattern.test(charAt(lexer))) lexer.at++;
}

function skipString(lexer: Lexer, quote: string): void {
  for (lexer.at++; lexer.at < lexer.code.length && charAt(lexer) !== quote; lexer.at++) {
    if (charAt(lexer) === "\\") lexer.at++;
  }
  lexer.at++;
  lexer.previous = "value";
}

function skipComment(lexer: Lexer): void {
  if (charAt(lexer, 1) === "/") {
    const end = lexer.code.indexOf("\n", lexer.at);
    lexer.at = end === -1 ? lexer.code.length : end;
  } else {
    const end = lexer.code.indexOf("*/", lexer.at + 2);
    lexer.at = end === -1 ? lexer.code.length : end + 2;
  }
}

/** Read a template's text up to its end, which closes it, or its next `${`. */
function readTemplateText(lexer: Lexer): void {
  for (; lexer.at < lexer.code.length; lexer.at++) {
    const char = charAt(lexer);
    if (char === "\\") {
      lexer.at++;
    } else if (char === "`") {
      lexer.templates.pop();
      lexer.at++;
      break;
    } else if (char === "$" && charAt(lexer, 1) === "{") {
      lexer.at += 2;
      break;
    }
  }
  lexer.previous = "value";
}

/** Skip a regular expression, whose class may hold a `/`, and its flags. */
function skipRegex(lexer: Lexer): void {
  let inClass = false;
  for (lexer.at++; lexer.at < lexer.code.length; lexer.at++) {
    const char = charAt(lexer);
    if (char === "\\") lexer.at++;
    else if (char === "[") inClass = true;
    else if (char === "]") inClass = false;
    else if (char === "/" && !inClass) break;
  }
  lexer.at++;
  skipWhile(lexer, WORD);
  lexer.previous = "value";
}

/** Whether the call whose `(` is at `open` passes one string literal and nothing else. */
function literalCall(code: string, open: number): boolean {
  const argument = code.slice(open + 1).trimStart();
  const quote = argument[0];
  if (quote !== '"' && quote !== "'") return false;
  for (let i = 1; i < argument.length; i++) {
    if (argument[i] === "\\") i++;
    else if (argument[i] === quote) return /^\s*\)/.test(argument.slice(i + 1));
  }
  return false;
}

function readWord(lexer: Lexer): void {
  const start = lexer.at;
  skipWhile(lexer, WORD);
  const word = lexer.code.slice(start, lexer.at);
  if (word === "import" && lexer.previous !== ".") {
    const rest = lexer.code.slice(lexer.at);
    const open = lexer.at + rest.length - rest.trimStart().length;
    if (lexer.code[open] === "(" && !literalCall(lexer.code, open)) lexer.found.push(start);
  }
  lexer.previous = OPERATOR_WORDS.has(word) ? "(" : word.slice(-1);
}

function readPunctuation(lexer: Lexer): void {
  const char = charAt(lexer);
  const depth = lexer.templates.length - 1;
  if (depth >= 0 && char === "}" && lexer.templates[depth] === 0) {
    // The end of a template's `${…}`: its text goes on.
    lexer.at++;
    readTemplateText(lexer);
    return;
  }
  if (depth >= 0 && char === "{") lexer.templates[depth] = (lexer.templates[depth] ?? 0) + 1;
  if (depth >= 0 && char === "}") lexer.templates[depth] = (lexer.templates[depth] ?? 1) - 1;
  lexer.previous = char;
  lexer.at++;
}

/** Read the token at the lexer's place. */
function step(lexer: Lexer): void {
  const char = charAt(lexer);
  const next = charAt(lexer, 1);
  if (SPACE.test(char)) lexer.at++;
  else if (char === "/" && (next === "/" || next === "*")) skipComment(lexer);
  else if (char === '"' || char === "'") skipString(lexer, char);
  else if (char === "`") {
    lexer.templates.push(0);
    lexer.at++;
    readTemplateText(lexer);
  } else if (char === "/" && !DIVIDES_AFTER.test(lexer.previous)) skipRegex(lexer);
  else if (WORD.test(char)) readWord(lexer);
  else readPunctuation(lexer);
}

/** The offset of each `import(` in `code` whose argument is not a string literal. */
export function computedImports(code: string): readonly number[] {
  const lexer: Lexer = { code, at: 0, previous: "(", templates: [], found: [] };
  while (lexer.at < code.length) step(lexer);
  return lexer.found;
}
