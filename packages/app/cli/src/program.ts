/** Importable program artifact; the packaged loader invokes this exact module's main. */

export function main(argv: string[]): Promise<number> {
  return import("./cli.ts").then((program) => program.main(argv));
}
