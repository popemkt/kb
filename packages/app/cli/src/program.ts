/** Importable program artifact; the packaged loader invokes this exact module's main. */

import type { CodeImagePort } from "@kb/contracts";

export function main(argv: string[], codeImage?: CodeImagePort): Promise<number> {
  return import("./cli.ts").then((program) => program.main(argv, codeImage));
}
