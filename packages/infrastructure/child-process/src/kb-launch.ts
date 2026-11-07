import text from "./kb-launch-flags.txt" with { type: "text" };
/** Startup arguments have one home, shared by source, release and Nix adapters. */
export const KB_LAUNCH_FLAGS: readonly string[] = Object.freeze(
  text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== ""),
);
