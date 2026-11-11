/** One startup boundary for source and packaged program loaders. */
import { kbLaunchError, UNSAFE_KB_LAUNCH } from "@kb/child-process";

interface Program {
  readonly main: (argv: string[]) => Promise<number>;
}

/** Validate before asking any loader to evaluate the application runtime. */
export function runProgram(
  load: () => Promise<Program>,
  argv: string[] = process.argv,
): Promise<number> {
  const error = kbLaunchError(process.execArgv);
  if (error !== null) {
    process.stderr.write(`${error}\n`);
    return Promise.resolve(UNSAFE_KB_LAUNCH);
  }
  return load().then((program) => program.main(argv));
}
